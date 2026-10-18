import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';

const extensionPath = path.resolve('dist');
const fixturePath = path.resolve('tests/fixtures/youtube.html');

export async function launchExtension(profile: string, useFixture = true): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  // Bound Windows Chromium shutdown; only the test's headless profile and
  // extension path may be terminated when normal close stops responding.
  if (process.platform === 'win32') {
    const browser = context.browser(), close = context.close.bind(context);
    let closing: Promise<void> | undefined;
    context.close = (options) => closing ??= (async () => {
      const closeRequestedAt = Date.now();
      let forced = false, timer: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          forced = true; process.stderr.write('Test-only Chromium shutdown exceeded 10s; checking its owned process tree.\n');
          execFile(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-File', path.resolve('scripts/close-test-browser.ps1'), '-OwnedProfile', path.resolve(profile), '-ExtensionPath', extensionPath, '-CloseRequestedAtUnixMs', String(closeRequestedAt)],
            { windowsHide: true, timeout: 10_000 }, (error) => error ? reject(error) : resolve());
        }, 10_000); timer.unref();
      });
      try { await Promise.race([close(options).catch((error: unknown) => { if (!forced || browser?.isConnected()) throw error; }), stopped]); }
      finally { clearTimeout(timer); if (forced) await stopped; }
    })();
  }
  if (!useFixture) return context;
  const html = await readFile(fixturePath, 'utf8');
  // Route only test pages; the extension still uses real Chrome APIs and its MV3 manifest.
  await context.route('https://www.youtube.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else {
      // Fixtures are fully local: never fetch tracking, images, or media from YouTube.
      await route.abort();
    }
  });
  await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  return context;
}

export const test = base.extend<{ profile: string; extensionId: string; popup: Page; youtube: Page }>({
  profile: async ({}, use) => {
    const work = path.resolve(process.env.WW_TEST_PROFILE_ROOT ?? '.work');
    await mkdir(work, { recursive: true });
    // Chrome Storage's LevelDB can fail on Windows when test-title paths exceed MAX_PATH.
    await use(await mkdtemp(path.join(work, 'p-')));
  },
  context: async ({ profile }, use) => {
    const context = await launchExtension(profile);
    try { await use(context); }
    finally { await context.close(); }
  },
  extensionId: async ({ context }, use) => {
    // No production background worker is needed just to expose an ID for testing.
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((element) => {
      const data = (element as HTMLElement & { data?: { id: string } }).data;
      return data?.id ?? element.id;
    });
    if (!/^[a-p]{32}$/.test(id)) throw new Error('Extension failed to load.');
    await manager.close();
    await use(id);
  },
  popup: async ({ context, extensionId }, use) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).waitFor();
    await use(popup);
  },
  youtube: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/');
    await use(page);
  },
});

export { expect } from '@playwright/test';

