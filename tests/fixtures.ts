import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';

const extensionPath = path.resolve('dist');
const fixturePath = path.resolve('tests/fixtures/youtube.html');

export async function launchExtension(profile: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const html = await readFile(fixturePath, 'utf8');
  // Route only test pages; the extension still uses real Chrome APIs and its MV3 manifest.
  await context.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  return context;
}

export const test = base.extend<{ profile: string; extensionId: string; popup: Page; youtube: Page }>({
  profile: async ({}, use) => {
    const work = path.resolve('.work');
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
