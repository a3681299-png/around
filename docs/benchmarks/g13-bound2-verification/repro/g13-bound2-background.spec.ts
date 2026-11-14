// A separate owned Chrome avoids Playwright's default focus override. The public noDefaults
// option is required for a real visibilitychange, rather than a synthetic hidden getter/event.
import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

test('real hidden tab and return with no Playwright focus emulation', async ({}, info) => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(path.resolve('.work/bg-real-'));
  const extension = path.resolve('.work/bound2-build');
  const child = spawn(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--window-size=1100,760',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    let port = '';
    for (let i = 0; i < 100 && !port; i++) {
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]!;
      if (!port) await new Promise((r) => setTimeout(r, 100));
    }
    if (!port) throw new Error('Owned Chrome did not open its CDP endpoint');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0]!;
    const html = await readFile('tests/fixtures/youtube.html', 'utf8');
    await context.route('https://www.youtube.com/**', (route) =>
      route.request().resourceType() === 'document'
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.abort(),
    );
    const page = context.pages()[0]!;
    await page.goto('https://www.youtube.com/');
    const bundle = await build({
      stdin: {
        contents: "export {youtubeOperations} from './src/sites/youtube-operations';",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'Bound2',
      dropLabels: ['AROUND_GUARD_TRACE', 'AROUND_TEST_PAGE_CHANGE'],
    });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    const before = await page.evaluate(async () => {
      const source = (window as any).Bound2.youtubeOperations(document);
      await new Promise((r) => setTimeout(r, 450));
      const target = document.querySelector('.brand')!;
      const r = target.getBoundingClientRect();
      const snap = source.capture({ fresh: true });
      const surface = snap.surfaces.find(
        (s: any) =>
          Math.abs(s.shape.left - r.left) < 0.1 &&
          Math.abs(s.shape.top - r.top) < 0.1 &&
          Math.abs(s.shape.width - r.width) < 0.1,
      )!;
      const w: any = ((window as any).__tab = {
        source,
        target,
        id: surface.id,
        at: performance.now(),
        visibility: [],
      });
      document.addEventListener('visibilitychange', () =>
        w.visibility.push({ at: performance.now(), hidden: document.hidden }),
      );
      return { at: w.at, left: r.left, hidden: document.hidden };
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const original = await worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]!);
    const other = await worker.evaluate(
      async ({ windowId }) => chrome.tabs.create({ windowId, url: 'about:blank', active: true }),
      { windowId: original.windowId },
    );
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    const background = await page.evaluate(() => {
      const w = (window as any).__tab;
      const a = w.target.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(150px)' }], {
        duration: 1,
        fill: 'forwards',
      });
      a.pause();
      a.currentTime = 1;
      return { hidden: document.hidden, at: performance.now() };
    });
    await page.waitForTimeout(900);
    await worker.evaluate(async ({ id }) => chrome.tabs.update(id!, { active: true }), { id: original.id });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    const after = await page.evaluate(() => {
      const w = (window as any).__tab;
      const snap = w.source.capture({ coalesce: true });
      const s = snap.surfaces.find((s: any) => s.id === w.id);
      const result = {
        at: performance.now(),
        age: performance.now() - w.at,
        hidden: document.hidden,
        actual: w.target.getBoundingClientRect().left,
        snapshot: s?.shape.left,
        pending: w.source.pending(),
        visibility: w.visibility,
      };
      w.source.destroy();
      return result;
    });
    await info.attach('background-return.json', {
      body: JSON.stringify(
        {
          browser: browser.version(),
          noDefaults: true,
          before,
          background,
          after,
          originalTab: { id: original.id, windowId: original.windowId },
          otherTab: { id: other.id, windowId: other.windowId },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(background.hidden).toBe(true);
    expect(after.age).toBeGreaterThan(404);
    expect(after.snapshot).toBe(after.actual);
    expect(after.snapshot).toBeCloseTo(before.left + 150, 1);
    expect(after.pending).toBe('none');
    expect(after.visibility.map((v: any) => v.hidden)).toEqual([true, false]);
  } finally {
    if (browser) {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    }
    if (child.exitCode === null)
      await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill();
  }
});
