import { test, expect, type Page, type Route } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

test.use({ channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 } });
test.describe.configure({ timeout: 90_000 });
const mode = process.env.CHUNK2_FAULT ?? 'normal';
const root = path.resolve(mode === 'underlay' || mode === 'clip' ? `.work/fault-${mode}` : '.work/playground');
const out = path.resolve('.work/verify-evidence');
const model = (page: Page) => page.locator('.model-media');
let server: Server, url: string;
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webm': 'video/webm',
};

test.beforeAll(async () => {
  await mkdir(out, { recursive: true });
  server = createServer(async (request, response) => {
    const raw = decodeURIComponent(new URL(request.url!, 'http://local').pathname);
    const name = path.resolve(root, '.' + (raw === '/' ? '/index.html' : raw));
    const relative = path.relative(root, name);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(name);
      response.writeHead(200, { 'content-type': mime[path.extname(name)] ?? 'application/octet-stream' }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function withDesign(page: Page, edit?: (design: any) => any) {
  if (edit)
    await page.route('**/content/design.json', async (route: Route) => {
      const original = await route.fetch();
      await route.fulfill({ response: original, json: edit(await original.json()) });
    });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto(url);
  await expect(page.locator('#apply')).toBeEnabled();
  return errors;
}

async function pose(page: Page) {
  return model(page).evaluate((node: HTMLElement) => JSON.parse(node.dataset.modelFrame!).pose);
}

test('room-only underlay leaves every pixel of the paused picture intact', async ({ page }) => {
  const errors = await withDesign(page, (design) => ({
    ...design,
    decorations: design.decorations.filter((layer: any) => layer.id === 'room'),
  }));
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('#play').click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.25);
  await page.locator('#play').click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  const time = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
  const rect = (await video.boundingBox())!;
  const box = { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 };
  const margin = { x: 10, y: 80, width: 80, height: 80 };
  const before = await page.screenshot({ clip: box, path: path.join(out, `pg-${mode}-picture-before.png`) });
  const plainMargin = await page.screenshot({ clip: margin });
  await page.screenshot({ path: path.join(out, `pg-${mode}-page-before.png`) });
  await page.locator('#apply').click();
  await expect(page.locator('[data-image-id="room"]')).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('[data-image-id="room"] img')
        .evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)),
    )
    .toBeGreaterThan(0);
  await expect.poll(async () => (await page.screenshot({ clip: margin })).equals(plainMargin)).toBe(false);
  const after = await page.screenshot({ clip: box, path: path.join(out, `pg-${mode}-picture-after.png`) });
  await page.screenshot({ path: path.join(out, `pg-${mode}-page-after.png`) });
  const css = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('#around-atmosphere-decorations');
    const heading = document.querySelector<HTMLElement>('h1')!;
    return {
      atmosphereParent: layer?.parentElement?.tagName,
      zIndex: layer ? getComputedStyle(layer).zIndex : null,
      heading: heading.textContent,
      color: getComputedStyle(heading).color,
      background: getComputedStyle(heading).backgroundColor,
      time: document.querySelector('video')!.currentTime,
    };
  });
  await writeFile(
    path.join(out, `pg-${mode}-background.json`),
    JSON.stringify({ samePixels: before.equals(after), box, css, errors }, null, 2),
  );
  expect(css.time).toBe(time);
  expect(before.equals(after), 'the room must not change any paused-picture pixel').toBe(true);
  expect(css.zIndex).toBe('-1');
  expect(errors).toEqual([]);
});

test('same artwork uses its seat, look-down and hop in the Playground', async ({ page }) => {
  const errors = await withDesign(page);
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 35_000 });
  await expect.poll(() => pose(page).then((p) => p?.seat)).toBe(true);
  const seat = await pose(page);
  expect(seat.yawDeg).toBeGreaterThan(20);
  expect(seat.yawDeg).toBeLessThan(30);
  await page.screenshot({ path: path.join(out, 'pg-sit.png') });
  await page.locator('#play').click();
  await expect.poll(() => pose(page).then((p) => p?.hips[1]), { intervals: [25] }).toBeGreaterThan(0.05);
  const hop = await pose(page);
  await page.screenshot({ path: path.join(out, 'pg-hop.png') });
  await page.locator('#play').click();
  await expect.poll(() => pose(page).then((p) => p?.bones.head?.[0] ?? 0), { intervals: [50] }).toBeGreaterThan(5);
  const look = await pose(page);
  await page.screenshot({ path: path.join(out, 'pg-look.png') });
  await page.keyboard.press('Alt+Shift+KeyQ');
  await expect(model(page)).toHaveCount(0);
  await page.keyboard.press('Alt+Shift+KeyQ');
  await expect(model(page)).toHaveAttribute('data-renderer', 'three');
  expect(errors).toEqual([]);
  await writeFile(path.join(out, 'pg-motion.json'), JSON.stringify({ seat, hop, look, errors }, null, 2));
});

test('overlapping mannequin cannot change the play button pixels or consume its click', async ({ page }) => {
  await withDesign(page, (design) => ({
    ...design,
    rules: [],
    decorations: design.decorations
      .filter((layer: any) => layer.id === 'resident')
      .map((layer: any) => ({
        ...layer,
        placement: {
          ...layer.placement,
          anchor: { kind: 'viewport' },
          x: 170 / 1280,
          y: 613 / 800,
          widthPx: 200,
          heightPx: 250,
        },
      })),
  }));
  const play = page.locator('#play');
  const box = (await play.boundingBox())!;
  const before = await page.screenshot({ clip: box });
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three');
  await expect.poll(() => pose(page).then((p) => p?.seat)).toBe(true);
  const resident = (await page.locator('[data-image-id="resident"]').boundingBox())!;
  expect(resident.x).toBeLessThan(box.x + box.width);
  expect(resident.y).toBeLessThan(box.y + box.height);
  expect(resident.x + resident.width).toBeGreaterThan(box.x);
  expect(resident.y + resident.height).toBeGreaterThan(box.y);
  await page.screenshot({ path: path.join(out, `pg-${mode}-overlap.png`) });
  const after = await page.screenshot({ clip: box });
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('#play')?.id,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe('play');
  await play.click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await writeFile(
    path.join(out, `pg-${mode}-overlap.json`),
    JSON.stringify({ box, resident, hit, samePixels: before.equals(after) }, null, 2),
  );
  expect(before.equals(after), 'the actual play button pixels stay unchanged').toBe(true);
});
