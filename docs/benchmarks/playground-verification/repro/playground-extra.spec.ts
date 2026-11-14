import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(process.env.PG_BUILD ?? '.work/playground-test');
let server: ReturnType<typeof createServer>, origin: string;
const records: any[] = [];
test.use({ channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 } });
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const file = path.resolve(root, '.' + new URL(req.url!, 'http://x').pathname.replace(/\/$/, '/index.html'));
      if (!file.startsWith(root + path.sep)) throw Error('outside');
      const data = await readFile(file);
      const type: any = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.webm': 'video/webm',
      };
      res.writeHead(200, { 'content-type': type[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await mkdir('.work/evidence', { recursive: true });
  const suffix = process.env.PG_REMOVE_MARK === '1' ? 'no-mark' : path.basename(root);
  await writeFile(`.work/evidence/pg-${suffix}.json`, JSON.stringify(records, null, 2));
});
const model = (p: Page) => p.locator('.model-media');
async function open(p: Page) {
  await p.goto(origin);
  await expect(p.locator('#apply')).toHaveText('Around を適用');
  await expect.poll(() => p.evaluate(() => Boolean((globalThis as any).__aroundPlayground))).toBe(true);
}
test('Playground refuses malformed artwork through parseDesign', async ({ page }) => {
  const good = JSON.parse(await readFile(path.join(root, 'content/design.json'), 'utf8'));
  for (const [label, patch] of Object.entries({
    extra: { unexpected: 'executable()' },
    css: {
      rules: [{ kind: 'surface-style', target: 'page', style: { css: 'background:url(https://invalid.example/x)' } }],
    },
    url: { decorations: [{ ...good.decorations[0], url: 'javascript:alert(1)' }] },
    version: { schemaVersion: 999 },
  })) {
    const doc = { ...good, ...patch };
    await page.route('**/content/design.json', (r) => r.fulfill({ json: doc }));
    await page.goto(origin);
    await expect(page.locator('#status')).not.toBeEmpty();
    await page.locator('#apply').click();
    await expect(model(page)).toHaveCount(0);
    records.push({ case: label, rejected: await page.locator('#status').textContent() });
    await page.unroute('**/content/design.json');
  }
});
test('Playground asset port rejects changed bytes and hash-matching malformed assets', async ({ page }) => {
  await open(page);
  await page.addScriptTag({ url: origin + '/asset-port.js' });
  const good = JSON.parse(await readFile(path.join(root, 'content/manifest.json'), 'utf8'));
  const entry: any = Object.values(good.assets).find((e: any) => e.file.endsWith('.vrm'));
  const original = await readFile(path.join(root, 'content', entry.file));
  const malformed = Buffer.from('invalid VRM, not a GLB container');
  for (const [label, bytes, id] of [
    ['changed', malformed, Object.keys(good.assets).find((id) => good.assets[id].file === entry.file)],
    ['matching-hash', malformed, 'asset-' + createHash('sha256').update(malformed).digest('hex')],
    [
      'truncated-glb',
      original.subarray(0, 40),
      'asset-' + createHash('sha256').update(original.subarray(0, 40)).digest('hex'),
    ],
  ] as const) {
    await page.route('**/content/verification.vrm', (r) =>
      r.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
    );
    const error = await page.evaluate(
      async ({ origin, id }) => {
        try {
          await (globalThis as any)
            .verificationAssets(new URL(origin + '/content/'), {
              assets: { [id!]: { file: 'verification.vrm', name: 'bad.vrm' } },
            })
            .load(id);
          return null;
        } catch (e) {
          return String(e);
        }
      },
      { origin, id },
    );
    expect(error, label).toBeTruthy();
    if (label === 'changed') expect(error).toContain('ID と一致');
    else expect(error).not.toContain('ID と一致');
    records.push({ case: label, error });
    await page.unroute('**/content/verification.vrm');
  }
});
test('G1 missing mark causes the coverage assertion to fail', async ({ page }) => {
  if (process.env.PG_REMOVE_MARK === '1')
    await page.route('**/index.html', async (r) => {
      const html = await readFile(path.join(root, 'index.html'), 'utf8');
      const broken = html.replace('id="play" type="button" data-around-control="click"', 'id="play" type="button"');
      expect(broken).not.toBe(html);
      await r.fulfill({ body: broken, contentType: 'text/html' });
    });
  await page.goto(origin + '/index.html');
  await expect.poll(() => page.evaluate(() => Boolean((globalThis as any).__aroundPlayground))).toBe(true);
  const missing = await page.evaluate(() => {
    const c = new Set((globalThis as any).__aroundPlayground.controls());
    return [...document.querySelectorAll('button,a[href],input,video')]
      .filter((e) => !e.closest('[id^="around"]') && !c.has(e))
      .map((e) => e.id || e.textContent?.trim());
  });
  records.push({ case: 'controls', missing });
  expect(missing).toEqual([]);
});
test('G1 overlapping character preserves real button pixels and click delivery', async ({ page }) => {
  const good = JSON.parse(await readFile(path.join(root, 'content/design.json'), 'utf8'));
  await page.route('**/content/design.json', (r) =>
    r.fulfill({
      json: {
        ...good,
        rules: [],
        decorations: good.decorations
          .filter((d: any) => d.kind === 'model3d')
          .map((d: any) => ({
            ...d,
            placement: {
              ...d.placement,
              anchor: { kind: 'viewport' },
              x: 0.1328,
              y: 0.767,
              widthPx: 260,
              heightPx: 250,
            },
          })),
      },
    }),
  );
  await open(page);
  const button = page.locator('#play');
  const box = (await button.boundingBox())!;
  // x/y above place the character over this actual control in the fixed 1280x800 viewport.
  const before = await button.screenshot();
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 30000 });
  await page.mouse.move(2, 2);
  await expect
    .poll(() =>
      model(page)
        .locator('canvas')
        .evaluate(
          (c: HTMLCanvasElement) =>
            c
              .getContext('2d')!
              .getImageData(0, 0, c.width, c.height)
              .data.filter((v, i) => i % 4 === 3 && v > 0).length,
        ),
    )
    .toBeGreaterThan(50);
  const bounds = (await page.locator('[data-image-id="resident"]').boundingBox())!;
  expect(bounds.x).toBeLessThan(box.x + box.width);
  expect(bounds.x + bounds.width).toBeGreaterThan(box.x);
  expect(bounds.y).toBeLessThan(box.y + box.height);
  expect(bounds.y + bounds.height).toBeGreaterThan(box.y);
  await page.waitForTimeout(500);
  const whole = await page.screenshot();
  await writeFile(`.work/evidence/pg-overlap-${path.basename(root)}.png`, whole);
  const green = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const a = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i + 1] > 120 && a[i] < 80 && a[i + 2] < 80) n++;
    return n;
  }, whole.toString('base64'));
  expect(green, 'character must remain visibly drawn away from the protected control').toBeGreaterThan(500);
  const after = await button.screenshot();
  expect(after.equals(before), 'native button pixels must remain identical').toBe(true);
  await button.click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  await button.click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  records.push({ case: 'overlap', box, bounds, green, pixelsEqual: after.equals(before), clicks: true });
});
