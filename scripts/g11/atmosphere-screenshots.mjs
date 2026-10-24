// Real-extension screenshots of a full-viewport atmosphere layer at the engine cap (light and dark).
// Usage: G11_BROWSER_PATH=... WW_EXTENSION=.work/<build> node scripts/g11/atmosphere-screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { workPath } from './environment.mjs';
import path from 'node:path';

const extension = path.resolve(process.env.WW_EXTENSION ?? '.work/g11-check-dist');
const out = 'docs/screenshots/operation-g11-atmosphere';
const video = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const results = [];

async function art(page, kind) {
  return page.evaluate((kind) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d');
    if (kind === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, 256, 160);
      g.addColorStop(0, '#ff3d7f');
      g.addColorStop(0.5, '#ffd23f');
      g.addColorStop(1, '#3fa9ff');
      ctx.fillStyle = g;
    } else ctx.fillStyle = kind;
    ctx.fillRect(0, 0, 256, 160);
    return c.toDataURL().split(',')[1];
  }, kind);
}

for (const scheme of ['light', 'dark']) {
  const profile = await mkdtemp(path.resolve('.work/atmosphere-real-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.G11_BROWSER_PATH,
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  if (scheme === 'dark')
    await context.addCookies([{ name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/' }]);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.evaluate(() =>
    chrome.storage.local.set({
      'webWorldThemes.enabled': true,
      'webWorldThemes.strength': 100,
      'webWorldThemes.safety.emergencyOff': false,
      'webWorldThemes.design.youtube': {
        schemaVersion: 12,
        id: 'atmosphere-check',
        siteId: 'youtube',
        baseThemeId: null,
        rules: [],
        decorations: [],
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(video, { waitUntil: 'domcontentloaded' });
  await page.locator('#movie_player').waitFor();
  await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelector('video')?.pause());
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/real-${scheme}-none.png` });
  // Import through the validated editor path, then make it a full-viewport atmosphere layer.
  const kinds = scheme === 'light' ? ['#ffffff', 'gradient'] : ['#000000', 'gradient'];
  await popup.locator('#creator-editor-open').evaluate((b) => b.click());
  await page.bringToFront();
  const editor = page.locator('#web-world-themes-creator');
  await editor.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  const guide = editor.getByRole('button', { name: '操作ガイドを閉じる', exact: true });
  if (await guide.isVisible()) await guide.click();
  for (const [index, kind] of kinds.entries()) {
    await editor.getByLabel('画像素材を追加').setInputFiles({
      name: `${kind.replace('#', '')}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(await art(page, kind), 'base64'),
    });
    await page.waitForFunction(
      (count) =>
        [...document.querySelectorAll('[id$="decorations"]')].reduce(
          (n, h) => n + (h.shadowRoot?.querySelectorAll('[data-image-id]').length ?? 0),
          0,
        ) >= count,
      index + 1,
      { timeout: 30000 },
    );
  }
  await editor.locator('.dirty').filter({ hasText: '未保存の変更' }).waitFor();
  await editor.locator('.save').click();
  await editor.locator('.dirty').filter({ hasText: '保存済み' }).waitFor();
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  const saved = await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
  for (const [index, kind] of kinds.entries()) {
    const layer = saved.decorations[index];
    const design = {
      ...saved,
      decorations: [
        {
          ...layer,
          opacity: 1,
          visible: true,
          renderMode: 'atmosphere',
          placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 1280, heightPx: 800, rotationDeg: 0 },
        },
      ],
    };
    await popup.evaluate((d) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': d }), design);
    await page.bringToFront();
    await page.mouse.move(1270, 790);
    try {
      await page.waitForFunction(
        () => {
          const plane = document.querySelector('#web-world-themes-atmosphere-decorations');
          const node = plane?.shadowRoot?.querySelector('[data-image-id]');
          return node && getComputedStyle(node).visibility !== 'hidden';
        },
        null,
        { timeout: 15000 },
      );
    } catch (error) {
      console.log(
        'STATE',
        JSON.stringify(
          await page.evaluate(() => ({
            planes: [...document.querySelectorAll('[id^="web-world-themes-"]')].map((e) => e.id),
            safety: document
              .querySelector('#web-world-themes-decorations')
              ?.getAttribute('data-ww-safety')
              ?.slice(0, 400),
            nodes: [...document.querySelectorAll('[id$="decorations"]')].map(
              (h) => h.id + ':' + (h.shadowRoot?.querySelectorAll('[data-image-id]').length ?? 0),
            ),
          })),
        ),
      );
      const stored = await popup.evaluate(async () => await chrome.storage.local.get(null));
      console.log('STORED', JSON.stringify(stored).slice(0, 800));
      throw error;
    }
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => {
      const plane = document.querySelector('#web-world-themes-atmosphere-decorations');
      const node = plane.shadowRoot.querySelector('[data-image-id]');
      const r = node.getBoundingClientRect();
      return {
        dark: document.documentElement.hasAttribute('dark'),
        planeOpacity: getComputedStyle(plane).opacity,
        layerOpacity: getComputedStyle(node).opacity,
        covers: { width: Math.round(r.width), height: Math.round(r.height) },
        hit: document.elementFromPoint(640, 30)?.closest('#web-world-themes-atmosphere-decorations') === null,
      };
    });
    const name = `real-${scheme}-${kind === 'gradient' ? 'gradient' : kind === '#ffffff' ? 'white' : 'black'}-33`;
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push({ scheme, name, ...state });
  }
  await context.close();
}
await writeFile(workPath('.work/atmosphere-real.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
