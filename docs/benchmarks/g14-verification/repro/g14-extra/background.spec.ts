// Real visibility, without Playwright's default focus emulation; no document.hidden override.
import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
test('G1.4 real background and cancellation transitions read no rectangles', async () => {
  const profile = await mkdtemp(path.resolve('.work/g14-bg-'));
  const extension = path.resolve('.work/g14-normal');
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
    if (!port) throw new Error('Owned Chrome CDP endpoint missing');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0]!,
      page = context.pages()[0]!;
    const html = await readFile('tests/fixtures/youtube.html', 'utf8');
    await context.route('https://www.youtube.com/**', (route) =>
      route.request().resourceType() === 'document'
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.abort(),
    );
    await page.goto('https://www.youtube.com/');
    const bundle = await build({
      stdin: {
        contents:
          "export {youtubeOperations} from './src/sites/youtube-operations';export {createOperationGuardHost} from './src/host/operation-guard';",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'G14Extra',
      dropLabels: ['WW_GUARD_TRACE', 'WW_TEST_PAGE_CHANGE'],
    });
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const api = (window as any).G14Extra,
        source = api.youtubeOperations(document),
        capture = source.capture.bind(source);
      const state: any = ((window as any).g14Idle = { reads: 0, rects: 0, invalidations: [], visibility: [] });
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        state.rects++;
        return rect.call(this);
      };
      source.capture = (o: any) => {
        state.reads++;
        return capture(o);
      };
      state.guard = api.createOperationGuardHost(document, source, (hide: any) =>
        state.invalidations.push({ at: performance.now(), hide }),
      );
      state.paint = {
        id: 'art',
        bounds: { left: 10, top: 10, right: 30, bottom: 30 },
        opacity: 1,
        pointerEvents: false,
        outset: 0,
        composition: 'overlay',
      };
      document.addEventListener('visibilitychange', () =>
        state.visibility.push({ at: performance.now(), hidden: document.hidden }),
      );
      state.guard.sample(performance.now());
      state.guard.commit([state.paint]);
    });
    const measure = async (name: string, action: string) => {
      await page.evaluate((code) => {
        const s = (window as any).g14Idle;
        // The action is selected from fixed test code, never from artwork data.
        if (code === 'empty') s.guard.commit([]);
        if (code === 'transparent') s.guard.commit([{ ...s.paint, opacity: 0 }]);
        if (code === 'inactive') s.guard.setActive(false);
        if (code === 'destroy') s.guard.destroy();
        if (code === 'shown') {
          s.guard.setActive(true);
          s.guard.sample(performance.now());
          s.guard.commit([s.paint]);
        }
        s.reads = 0;
        s.rects = 0;
        s.invalidations = [];
        s.start = performance.now();
      }, action);
      await page.waitForTimeout(1500);
      return {
        name,
        ...(await page.evaluate(() => {
          const s = (window as any).g14Idle;
          return {
            hidden: document.hidden,
            ms: performance.now() - s.start,
            reads: s.reads,
            rects: s.rects,
            invalidations: s.invalidations,
          };
        })),
      };
    };
    const rows: any[] = [];
    rows.push(await measure('shown', 'shown'));
    rows.push(await measure('empty-after-shown', 'empty'));
    rows.push(await measure('shown-again', 'shown'));
    rows.push(await measure('transparent-after-shown', 'transparent'));
    rows.push(await measure('shown-before-background', 'shown'));
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const original = await worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]!);
    await worker.evaluate(async ({ windowId }) => chrome.tabs.create({ windowId, url: 'about:blank', active: true }), {
      windowId: original.windowId,
    });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    rows.push(await measure('real-hidden', ''));
    await worker.evaluate(async ({ id }) => chrome.tabs.update(id!, { active: true }), { id: original.id });
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    rows.push(await measure('returned', 'shown'));
    rows.push(await measure('inactive-after-shown', 'inactive'));
    rows.push(await measure('shown-before-destroy', 'shown'));
    rows.push(await measure('destroyed', 'destroy'));
    const visibility = await page.evaluate(() => (window as any).g14Idle.visibility);
    await writeFile(
      '.work/g14-extra/background.json',
      JSON.stringify({ browser: browser.version(), noDefaults: true, rows, visibility }, null, 2),
    );
    for (const row of rows) {
      if (['shown', 'shown-again', 'shown-before-background', 'returned', 'shown-before-destroy'].includes(row.name)) {
        expect(row.reads, row.name).toBeGreaterThanOrEqual(2);
        expect(row.reads, row.name).toBeLessThanOrEqual(4);
        expect(row.rects, row.name).toBeGreaterThan(0);
      } else {
        expect(row.reads, row.name).toBe(0);
        expect(row.rects, row.name).toBe(0);
      }
    }
    expect(visibility.map((v: any) => v.hidden)).toEqual([true, false]);
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
