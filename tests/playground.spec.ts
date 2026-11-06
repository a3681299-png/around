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
  // A slower machine on purpose (as a busy CI runner): WW_CPU_THROTTLE=4 runs the page 4× slower.
  const throttle = Number(process.env.WW_CPU_THROTTLE ?? 1);
  if (throttle > 1)
    await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
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
  // Home is the player's bottom-right corner (chunk 3): the box's middle is in the corner's
  // quarter, and the box stays inside the player (the site's own controls are just below it).
  const player = (await page.locator('.player').boundingBox())!,
    character = (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
  expect(character.x + character.width / 2).toBeGreaterThan(player.x + player.width * 0.8);
  expect(character.y + character.height / 2).toBeGreaterThan(player.y + player.height * 0.6);
  expect(character.y + character.height).toBeLessThanOrEqual(player.y + player.height + 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'after.png') });
  await page.locator('#apply').click();
  await expect(page.locator('#apply')).toHaveText('WWT を適用');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(plain);
  expect(problems.filter((text) => /Content Security Policy|Refused/.test(text))).toEqual([]);
  expect(problems).toEqual([]);
});

test('the background layer is drawn under the content: the video picture is not veiled', async ({ page }) => {
  await open(page);
  const player = (await page.locator('.player').boundingBox())!;
  // The left half of the paused picture, away from the character on the right.
  const clip = { x: player.x + 20, y: player.y + 60, width: player.width / 2 - 40, height: player.height - 120 };
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.readyState)).toBeGreaterThanOrEqual(2);
  // An empty stretch of the page beside the player, where the room should show.
  const margin = { x: 10, y: 80, width: 80, height: 80 };
  const plain = await page.screenshot({ clip }),
    plainMargin = await page.screenshot({ clip: margin });
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  // The room is visible beside the content ...
  await expect.poll(async () => (await page.screenshot({ clip: margin })).equals(plainMargin)).toBe(false);
  // ... but nothing is painted over the picture.
  expect((await page.screenshot({ clip })).equals(plain)).toBe(true);
});

test('Alt+Shift+Q takes every effect off, and pressing it again brings them back', async ({ page }) => {
  await open(page);
  const plain = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(styled).not.toBe(plain);
  await page.keyboard.press('Alt+Shift+KeyQ');
  // Off: no character, no skin, no layer left on the page.
  await expect(model(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(plain);
  await expect(page.locator('[data-image-id]')).toHaveCount(0);
  await page.keyboard.press('Alt+Shift+KeyQ');
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(styled);
});

test('G1 while the character moves: it takes no input and the controls stay the hit target mid-hop', async ({
  page,
}) => {
  await open(page);
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  const character = (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
  const hit = (x: number, y: number, selector: string) =>
    page.evaluate(
      ([x, y, selector]) => Boolean(document.elementFromPoint(x as number, y as number)?.closest(selector as string)),
      [x, y, selector] as const,
    );
  // The character's own middle is not a target: whatever is under it is.
  const under = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[id^="web-world-themes"]') ?? null,
    [character.x + character.width / 2, character.y + character.height / 2] as const,
  );
  expect(under).toBeNull();
  // Starting the video makes it hop; through the hop every control stays reachable and the
  // body's pose keeps changing (it really is moving while we check).
  const controls = await Promise.all(
    ['#apply', '#play', '#seek', '#volume'].map(async (selector) => {
      const box = (await page.locator(selector).boundingBox())!;
      return { selector, x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
  // Every frame, in the page: the body's height, and whether each control is the hit target at its
  // centre. Round trips from the test (four hit tests each) are slow on a busy machine (a CI runner)
  // and saw too few frames of a short hop; here no frame of it is missed.
  await page.evaluate((list) => {
    const w = window as unknown as { wwHop: { height: number; missed: string[] }[] };
    w.wwHop = [];
    const frame = () => {
      let media: HTMLElement | null = null;
      for (const host of document.querySelectorAll('[id^="web-world-themes"]'))
        media ??= host.shadowRoot?.querySelector<HTMLElement>('.model-media') ?? null;
      const raw = media?.dataset.modelFrame;
      w.wwHop.push({
        height: raw ? (JSON.parse(raw).pose?.hips?.[1] ?? 0) : 0,
        missed: list.filter((c) => !document.elementFromPoint(c.x, c.y)?.closest(c.selector)).map((c) => c.selector),
      });
      if (w.wwHop.length < 600) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, controls);
  const rest = await model(page).evaluate((e: HTMLElement) => JSON.parse(e.dataset.modelFrame!).pose?.hips?.[1] ?? 0);
  await page.locator('#play').click();
  // The hop has happened: more than three heights from the frames since play, rest included.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => new Set((window as unknown as { wwHop: { height: number }[] }).wwHop.map((f) => f.height)).size,
        ),
      { message: 'the body hops', timeout: 15000 },
    )
    .toBeGreaterThan(3);
  // Through every frame of it, each control stayed the hit target.
  const frames = await page.evaluate(
    () => (window as unknown as { wwHop: { height: number; missed: string[] }[] }).wwHop,
  );
  const moving = frames.filter((f) => f.height !== rest);
  // Frames off the rest height: at least three heights besides it (as the check above).
  expect(new Set(moving.map((f) => f.height)).size).toBeGreaterThanOrEqual(3);
  expect(frames.flatMap((f) => f.missed)).toEqual([]);
  // A spot check from the test as well, after the hop.
  for (const control of controls)
    expect(await hit(control.x, control.y, control.selector), control.selector).toBe(true);
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
