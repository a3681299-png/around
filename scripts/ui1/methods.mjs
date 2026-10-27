// UI1.1: compares frame-drawing methods (inset border-image, outset border-image, front overlay
// pseudo-element) on the real nine YouTube parts. No extension; output stays in .work.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const out = path.resolve(process.env.UI1_WORK ?? '.work/ui1-methods');
if (path.relative(path.join(root, '.work'), out).startsWith('..')) throw new Error('Output must stay in .work');
await mkdir(out, { recursive: true });
const bundle = (
  await build({
    entryPoints: ['scripts/ui1/methods-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome120',
    loader: { '.css': 'text' },
  })
).outputFiles[0].text;
const png = [...(await readFile('tests/fixtures/skins/frame-light.png'))];
// Region order TL, T, TR, L, R, BL, B, BR (centre omitted: the frame is drawn without fill here).
const SOURCE = [
  [224, 48, 48],
  [0, 112, 192],
  [255, 128, 0],
  [128, 64, 192],
  [0, 144, 96],
  [192, 48, 144],
  [208, 160, 0],
  [0, 160, 192],
];
// Same rule as tests/helpers/skin-pixels.ts: the source colour, possibly under a native white wash.
function frameColour(actual, source) {
  const channel = source.indexOf(Math.min(...source));
  const alpha = (actual[channel] - source[channel]) / (255 - source[channel]);
  return (
    alpha >= -1 / 255 &&
    alpha <= 0.5 + 1 / 255 &&
    source.every((value, index) => Math.abs(actual[index] - (value + (255 - value) * alpha)) <= 2)
  );
}
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const results = [];
const pages = {
  'https://www.youtube.com/results?search_query=lofi+hip+hop': ['video-card', 'filter-chip', 'search-box'],
  [process.env.UI1_VIDEO_URL ?? 'https://www.youtube.com/watch?v=jNQXAC9IVRw']: [
    'video-card',
    'subscribe-button',
    'like-button',
    'dislike-button',
    'action-button',
    'description-panel',
    'comment-input',
  ],
};
for (const [url, parts] of Object.entries(pages)) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (url.includes('/watch')) {
    await page.evaluate(() => document.querySelector('video')?.pause());
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(4000);
  }
  await page.evaluate(bundle);
  const image = await page.evaluate(
    (bytes) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })),
    png,
  );
  for (const part of parts) {
    if (part === 'comment-input') {
      await page
        .locator('ytd-comment-simplebox-renderer')
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (!(await page.evaluate((part) => globalThis.__ui1Methods.pick(part), part))) {
      results.push({ part, url, missing: true });
      continue;
    }
    await page.mouse.move(5, 1075);
    await page.waitForTimeout(300);
    const ownPseudo = await page.evaluate(() => {
      const element = document.querySelector('[data-ui1-method]');
      return [getComputedStyle(element, '::before').content, getComputedStyle(element, '::after').content];
    });
    for (const method of ['inset', 'outset', 'overlay']) {
      const row = await page.evaluate(
        ([method, image]) => globalThis.__ui1Methods.apply(method, image),
        [method, image],
      );
      await page.waitForTimeout(150);
      const [x, y, w, h] = row.box;
      const pad = 10;
      const clip = { x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2 };
      const shot = await page.screenshot({ clip, path: path.join(out, `${part}-${method}.png`) });
      const inside = method === 'outset' ? -3 : 3;
      const ox = x - clip.x,
        oy = y - clip.y;
      const at = (px, py) => ({ x: Math.round(ox + px), y: Math.round(oy + py) });
      const points = [
        at(inside, inside),
        at(w / 2, inside),
        at(w - 1 - inside, inside),
        at(inside, h / 2),
        at(w - 1 - inside, h / 2),
        at(inside, h - 1 - inside),
        at(w / 2, h - 1 - inside),
        at(w - 1 - inside, h - 1 - inside),
      ];
      const sampled = await page.evaluate(
        async ({ data, points }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${data}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const context = canvas.getContext('2d');
          context.drawImage(img, 0, 0);
          return points.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
        },
        { data: shot.toString('base64'), points },
      );
      const visible = sampled.map((rgb, i) => frameColour(rgb, SOURCE[i]));
      results.push({ part, url, ownPseudo, ...row, regionsVisible: visible.filter(Boolean).length, sampled });
      console.log(
        JSON.stringify({
          part,
          method,
          static: row.staticBox,
          moved: row.descendantsMovedPx,
          hits: row.hitsSame,
          text: row.textInBand,
          neighbours: row.operableNeighboursUnderOutset,
          visible: visible.filter(Boolean).length + '/8',
        }),
      );
    }
    await page.evaluate(() => globalThis.__ui1Methods.clear());
  }
}
await writeFile(path.join(out, 'methods.json'), JSON.stringify(results, null, 2));
await browser.close();
