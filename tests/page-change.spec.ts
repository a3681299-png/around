import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { pageChangeBundle } from './helpers/page-change-build';

test.use({ channel: 'chromium', viewport: { width: 1920, height: 1080 } });
async function mount(page: Page, legacy = false) {
  const html = await readFile('tests/fixtures/youtube.html', 'utf8');
  await page.route('https://www.youtube.com/**', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.abort(),
  );
  await page.goto('https://www.youtube.com/');
  await page.addScriptTag({ content: await pageChangeBundle(undefined, legacy) });
  await page.evaluate(() => {
    (globalThis as any).__pageTest = (globalThis as any).PageChangeTest.mount();
  });
  await settle(page);
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let index = 0; index < 6; index++) await new Promise(requestAnimationFrame);
  });
}

test('small text mutations do not write theme variables, refresh features or recompile artwork', async ({ page }) => {
  await mount(page);
  const counts = await page.evaluate(async () => {
    const runtime = (globalThis as any).__pageTest;
    runtime.reset();
    return runtime.mutate(12);
  });
  expect(counts).toMatchObject({ themeWrites: 0, variables: 0, compiles: 0, featureRefreshes: 0 });
  expect(counts.surfaces).toBeGreaterThan(0);
  // A text-only edit can change card eligibility or duration classification.
  await page
    .locator('ytd-thumbnail-overlay-time-status-renderer')
    .first()
    .evaluate((node) => {
      node.textContent = 'LIVE';
    });
  await expect(page.locator('ytd-thumbnail-overlay-time-status-renderer').first()).not.toHaveAttribute(
    'data-ww-surface',
    /duration/,
  );
});

test('page following reattaches the cached sheets and discovers new native surfaces without recompilation', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const runtime = (globalThis as any).__pageTest;
    (globalThis as any).__sheets = [
      document.getElementById('web-world-themes-style'),
      document.getElementById('web-world-themes-design-style'),
    ];
    runtime.reset();
    for (const sheet of (globalThis as any).__sheets) sheet.remove();
    const card = document.querySelector('ytd-rich-grid-media')!.cloneNode(true) as Element;
    card.removeAttribute('data-ww-surface');
    card.id = 'new-native-card';
    document.querySelector('ytd-rich-grid-renderer')!.append(card);
  });
  await expect(page.locator('#new-native-card')).toHaveAttribute('data-ww-surface', /video-card/);
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).__sheets.every((sheet: Element) => sheet.isConnected))).toBe(
    true,
  );
  expect(await page.evaluate(() => (globalThis as any).__pageTest.counts.compiles)).toBe(0);
  expect(await page.evaluate(() => (globalThis as any).__pageTest.counts.themeWrites)).toBe(0);
  expect(await page.evaluate(() => (globalThis as any).__pageTest.counts.featureRefreshes)).toBeGreaterThan(0);
  await expect(page.locator('#new-native-card')).toHaveCSS('background-color', 'rgb(201, 212, 232)');
});

test('settings, artwork, navigation, native modes and fullscreen match the former full-render route', async ({
  context,
}, info) => {
  const captures: Record<string, Buffer>[] = [];
  for (const legacy of [true, false]) {
    const page = await context.newPage();
    await mount(page, legacy);
    const snapshots: Record<string, Buffer> = {};
    const capture = async (name: string) => {
      await settle(page);
      snapshots[name] = await page.screenshot({
        animations: 'disabled',
        mask: [page.locator('#web-world-themes-clock, #web-world-themes-daily-detail')],
      });
    };
    await capture('home');
    await page.evaluate(() => {
      const { controller } = (globalThis as any).__pageTest;
      // Settings stay validated by their existing boundary; this harness supplies trusted typed values.
      controller.update({
        enabled: true,
        strength: 35,
        features: { palette: true, 'window-chrome': true },
        palette: { hue: 210, saturation: 60, brightness: 65 },
        noiseStrength: 22,
      });
    });
    await capture('settings');
    await page.evaluate(() => {
      const runtime = (globalThis as any).__pageTest;
      runtime.controller.updateDesign({
        ...runtime.design,
        rules: [
          { kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#dac5df', borderRadiusPx: 14 } },
        ],
      });
    });
    await capture('artwork');
    await page.locator('#navigate').click();
    await capture('navigation');
    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
    await capture('dark');
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));
    await capture('light');
    await page.locator('#movie_player [aria-label="Fullscreen"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-ww-fullscreen', '');
    await capture('fullscreen');
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-fullscreen', '');
    await capture('exit-fullscreen');
    await page.evaluate(() => {
      const runtime = (globalThis as any).__pageTest;
      runtime.controller.updateDesign({ ...runtime.design, baseThemeId: null });
    });
    await capture('independent');
    captures.push(snapshots);
    await page.close();
  }
  for (const name of Object.keys(captures[0]!)) {
    await info.attach(`${name}-before.png`, { body: captures[0]![name]!, contentType: 'image/png' });
    await info.attach(`${name}-after.png`, { body: captures[1]![name]!, contentType: 'image/png' });
    expect(captures[1]![name], name).toEqual(captures[0]![name]);
  }
});
