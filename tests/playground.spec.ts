import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * The Playground without the extension (docs/playground-plan.md): our own static site, the WWT
 * page runtime, plain headless Chromium. The build carries a read-only test hook (WW_PLAYGROUND_TEST).
 */
const out = resolve('.work/playground-e2e');
const shots = resolve('.work/playground-shots');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.vrm': 'application/octet-stream',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
let server: Server, origin: string;
// The same Chromium build as the extension tests (tests/fixtures.ts), headless, no extension.
test.use({ channel: 'chromium', headless: true });

test.beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-playground.mjs'], {
    env: { ...process.env, WW_PLAYGROUND_OUT: '.work/playground-e2e', WW_PLAYGROUND_TEST: '1' },
    stdio: 'pipe',
  });
  mkdirSync(shots, { recursive: true });
  server = createServer((request, response) => {
    const path = normalize(join(out, decodeURIComponent(new URL(request.url!, 'http://x').pathname)));
    const file = path.endsWith('\\') || path.endsWith('/') ? join(path, 'index.html') : path;
    if (!file.startsWith(out) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function open(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(origin + '/');
  await expect(page.locator('#apply')).toHaveText('WWT を適用');
  return problems;
}
const model = (page: Page) =>
  page.locator(
    ':is(#web-world-themes-decorations, #web-world-themes-page-decorations, #web-world-themes-video-decorations) .model-media',
  );

test('without the extension, 適用 switches the site to the artwork and back', async ({ page }) => {
  const problems = await open(page);
  const plain = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(model(page)).toHaveCount(0);
  await page.screenshot({ path: join(shots, 'before.png') });
  await page.locator('#apply').click();
  await expect(page.locator('#apply')).toHaveText('元に戻す');
  // The character is drawn with the same 3D renderer as in the extension.
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  await expect(model(page)).toHaveAttribute('data-format', 'vrm');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(plain);
  // It sits on the player's top edge: its box crosses that edge, near the right end.
  const player = (await page.locator('.player').boundingBox())!,
    character = (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
  expect(character.y).toBeLessThan(player.y);
  expect(character.y + character.height).toBeGreaterThan(player.y);
  expect(character.x + character.width / 2).toBeGreaterThan(player.x + player.width * 0.8);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'after.png') });
  await page.locator('#apply').click();
  await expect(page.locator('#apply')).toHaveText('WWT を適用');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(plain);
  expect(problems.filter((text) => /Content Security Policy|Refused/.test(text))).toEqual([]);
  expect(problems).toEqual([]);
});

/** Every button, link and input on the page, by its id or text, for a readable failure. */
const interactive = (page: Page) =>
  page.evaluate(() => {
    const hook = (globalThis as unknown as { __wwPlayground: { controls(): HTMLElement[] } }).__wwPlayground;
    const controls = new Set(hook.controls());
    const all = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, video, [role="button"], [role="slider"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.closest('[id^="web-world-themes"]'));
    return {
      count: all.length,
      missing: all.filter((element) => !controls.has(element)).map((e) => e.id || e.textContent?.trim() || e.tagName),
    };
  });

test('G1: every button, link and input is an operation surface; an unmarked one is caught', async ({ page }) => {
  await open(page);
  const covered = await interactive(page);
  expect(covered.count).toBeGreaterThanOrEqual(8);
  expect(covered.missing).toEqual([]);
  // Deliberately forget one mark: the check must name it.
  await page.evaluate(() => document.querySelector('#play')!.removeAttribute('data-ww-control'));
  expect((await interactive(page)).missing).toEqual(['play']);
});

test('G1: with the artwork on, the real controls are still the hit target and work', async ({ page }) => {
  await open(page);
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  for (const selector of ['#apply', '#play', '#seek', '#volume', '.card']) {
    const box = (await page.locator(selector).first().boundingBox())!;
    const hit = await page.evaluate(
      ([x, y, selector]) => {
        const element = document.elementFromPoint(x as number, y as number);
        return Boolean(element && (element as Element).closest(selector as string));
      },
      [box.x + box.width / 2, box.y + box.height / 2, selector] as const,
    );
    expect(hit, selector).toBe(true);
  }
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => !document.querySelector('video')!.paused)).toBe(true);
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
});
