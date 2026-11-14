import { chromium, test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPlaygroundServer } from '../scripts/playground/serve.mjs';

/**
 * The Playground without the extension (docs/playground-plan.md): our own static site, the Around
 * page runtime, plain headless Chromium. The build carries a read-only test hook (AROUND_PLAYGROUND_TEST).
 */
const out = resolve('.work/playground-e2e');
const mirdoOut = resolve('.work/playground-mirdo-e2e');
const shots = resolve('.work/playground-shots');
let server: Server, origin: string;
// The same Chromium build as the extension tests (tests/fixtures.ts), headless, no extension.
test.use({ channel: 'chromium', headless: true });

test.beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build-playground.mjs'], {
    env: {
      ...process.env,
      AROUND_PLAYGROUND_MIRDO_ROOT: undefined,
      AROUND_PLAYGROUND_OUT: '.work/playground-e2e',
      AROUND_PLAYGROUND_TEST: '1',
    },
    stdio: 'pipe',
  });
  mkdirSync(shots, { recursive: true });
  server = createPlaygroundServer(out);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function open(page: Page, basic = true, viewport = { width: 1280, height: 800 }) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  // A slower machine on purpose (as a busy CI runner): AROUND_CPU_THROTTLE=4 runs the page 4× slower.
  const throttle = Number(process.env.AROUND_CPU_THROTTLE ?? 1);
  if (throttle > 1)
    await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.setViewportSize(viewport);
  await page.goto(origin + (basic ? '/?basic' : '/'));
  await expect(page.locator('#apply')).toHaveText('Around を適用');
  return problems;
}
const model = (page: Page) =>
  page.locator(':is(#around-decorations, #around-page-decorations, #around-video-decorations) .model-media');

test('Mirdo starts on the lower edge and moves to the upper edge with the imported motions', async ({ page }) => {
  test.skip(!process.env.AROUND_PLAYGROUND_MIRDO_ROOT, 'Requires the approved external asset checkout.');
  test.setTimeout(60000);
  execFileSync(process.execPath, ['scripts/build-playground.mjs'], {
    env: { ...process.env, AROUND_PLAYGROUND_OUT: '.work/playground-mirdo-e2e' },
    stdio: 'pipe',
  });
  // Its own server: the shared one serves a single folder (scripts/playground/serve.mjs).
  const mirdoServer = createPlaygroundServer(mirdoOut);
  await new Promise<void>((done) => mirdoServer.listen(0, '127.0.0.1', done));
  const mirdoOrigin = `http://127.0.0.1:${(mirdoServer.address() as { port: number }).port}`;
  try {
    // Narrower than the 3D board's minimum (spatial.ts): this checks the basic Playground's
    // resident. The demo opens on the plain site (design, demo scene 1).
    await page.setViewportSize({ width: 940, height: 800 });
    await page.goto(mirdoOrigin + '/');
    await page.locator('#apply').click();
    await expect(page.locator('#apply')).toHaveText('元に戻す');
    await expect(page.getByRole('link', { name: /ミルド／ragooou/ })).toHaveAttribute(
      'href',
      'https://booth.pm/ja/items/6614116',
    );
    await expect(page.getByRole('link', { name: /Quaternius Universal Animation Library/ })).toBeVisible();
    await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
    const ids = await page.evaluate(async () => {
      const design = await (await fetch('content/design.json')).json();
      return design.decorations
        .find((layer: { id: string }) => layer.id === 'resident')
        .character.motions.map((m: { id: string }) => m.id) as string[];
    });
    const state = () =>
      model(page).evaluate((e: HTMLElement, ids: string[]) => {
        const f = JSON.parse(e.dataset.modelFrame ?? '{}');
        const box = e.closest('[data-image-id]')!.getBoundingClientRect();
        const player = document.querySelector('.player')!.getBoundingClientRect();
        const seat = f.body?.autonomy?.seat;
        return {
          motion: ids[f.clip],
          behaviour: f.body?.autonomy?.behaviour,
          seat,
          weight: f.body?.seatWeight,
          onEdge: Math.abs(box.y + box.height / 2 - (seat === 'top' ? player.top : player.bottom)) < 1,
        };
      }, ids);
    await expect.poll(state, { timeout: 10000 }).toMatchObject({
      motion: 'sitting-idle-loop',
      behaviour: 'rest',
      seat: 'bottom',
      weight: 1,
      onEdge: true,
    });
    const box = (await model(page).boundingBox())!;
    const player = (await page.locator('.player').boundingBox())!;
    const x = box.x + box.width / 2,
      y = player.y + player.height - 88;
    await page.mouse.move(player.x + 35, y);
    await page.waitForTimeout(200);
    await page.mouse.move(x - 56, y, { steps: 4 });
    await expect.poll(state).toMatchObject({ behaviour: 'flee', motion: 'jog-fwd-loop' });
    // Leave the character, keeping the pointer on the lower side of the player.
    await page.mouse.move(6, y);
    await expect
      .poll(state, { timeout: 10000 })
      .toMatchObject({ behaviour: 'return', motion: 'walk-loop', seat: 'top' });
    await expect.poll(state, { timeout: 15000 }).toMatchObject({
      motion: 'sitting-idle-loop',
      behaviour: 'rest',
      seat: 'top',
      weight: 1,
      onEdge: true,
    });
    const volume = page.getByRole('slider', { name: '音量' });
    await volume.focus();
    await volume.press('ArrowLeft');
    await expect(volume).toHaveValue('59');
  } finally {
    await new Promise<void>((done) => mirdoServer.close(() => done()));
  }
});

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
  await expect(page.locator('#apply')).toHaveText('Around を適用');
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

test('the basic resident has no visible frame while its motion is still loading', async ({ page }) => {
  const problems = await open(page);
  let requested!: () => void;
  let ready!: () => void;
  const motionRequested = new Promise<void>((resolve) => (requested = resolve));
  const motionReady = new Promise<void>((resolve) => (ready = resolve));
  await page.route('**/*.vrma', async (route) => {
    requested();
    await motionReady;
    await route.continue();
  });
  await page.locator('#apply').click();
  try {
    await motionRequested;
    // The loader asks for the clip during the same paint that used to draw the rest pose.
    expect(await model(page).evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
    expect(
      await model(page)
        .locator('canvas')
        .evaluate((canvas: HTMLCanvasElement) => canvas.width),
    ).toBe(1);
  } finally {
    ready();
  }
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  await expect(model(page)).toBeVisible();
  expect(problems).toEqual([]);
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
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[id^="around"]') ?? null, [
    character.x + character.width / 2,
    character.y + character.height / 2,
  ] as const);
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
    const w = window as unknown as { aroundHop: { height: number; missed: string[] }[] };
    w.aroundHop = [];
    const frame = () => {
      let media: HTMLElement | null = null;
      for (const host of document.querySelectorAll('[id^="around"]'))
        media ??= host.shadowRoot?.querySelector<HTMLElement>('.model-media') ?? null;
      const raw = media?.dataset.modelFrame;
      w.aroundHop.push({
        height: raw ? (JSON.parse(raw).pose?.hips?.[1] ?? 0) : 0,
        missed: list.filter((c) => !document.elementFromPoint(c.x, c.y)?.closest(c.selector)).map((c) => c.selector),
      });
      if (w.aroundHop.length < 600) requestAnimationFrame(frame);
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
          () => new Set((window as unknown as { aroundHop: { height: number }[] }).aroundHop.map((f) => f.height)).size,
        ),
      { message: 'the body hops', timeout: 15000 },
    )
    .toBeGreaterThan(3);
  // Through every frame of it, each control stayed the hit target.
  const frames = await page.evaluate(
    () => (window as unknown as { aroundHop: { height: number; missed: string[] }[] }).aroundHop,
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
    const hook = (globalThis as unknown as { __aroundPlayground: { controls(): HTMLElement[] } }).__aroundPlayground;
    const controls = new Set(hook.controls());
    const all = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, video, [role="button"], [role="slider"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.closest('[id^="around"]'));
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
  await page.evaluate(() => document.querySelector('#play')!.removeAttribute('data-around-control'));
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

async function dragProjectedRange(page: Page, slider: Locator, fractions: [number, number]) {
  const [start, end] = await slider.evaluate((element, ratios) => {
    const box = element.getBoundingClientRect();
    return ratios.map((fraction) => {
      const x = box.left + box.width * fraction;
      const rows = [];
      for (let y = Math.ceil(box.top); y < box.bottom; y++)
        if (document.elementFromPoint(x, y) === element) rows.push(y);
      if (rows.length === 0) throw new Error(`The projected range ${element.id} was not a hit target.`);
      return { x, y: rows[Math.floor(rows.length / 2)]! };
    });
  }, fractions);
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  await page.mouse.move(end!.x, end!.y, { steps: 12 });
  await page.mouse.up();
}

async function exerciseSpatialControls(page: Page, mode: 'canvas' | 'css') {
  const problems = await open(page, false);
  const apply = page.locator('#apply');
  const flat = (await apply.boundingBox())!;
  // Check inert synchronously with Apply so even a slow test runner cannot miss the lock.
  await expect(apply).toBeEnabled();
  expect(
    await apply.evaluate((element) => {
      (element as HTMLButtonElement).click();
      return element.closest<HTMLElement>('#watch-page')!.inert;
    }),
  ).toBe(true);
  const stage = page.locator('.playground-stage');
  await expect(stage).toHaveAttribute('data-mode', mode);
  await expect(page.locator('#watch-page')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.playground-handoff')).toHaveCount(0);
  if (mode === 'canvas') {
    expect(
      await stage.locator('canvas').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]),
    ).toEqual([1920, 1200]);
  }
  const tilted = (await apply.boundingBox())!;
  expect(flat.x - tilted.x).toBeGreaterThan(70);
  expect(tilted.y - flat.y).toBeGreaterThan(30);

  const search = page.getByRole('searchbox');
  await search.click();
  await page.keyboard.type('透ける');
  await expect(search).toHaveValue('透ける');
  await expect(page.getByRole('link', { name: '透ける四角の動画' })).toBeVisible();
  await expect(page.getByRole('link', { name: '四角が流れる動画' })).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(apply).toBeFocused();

  const play = page.locator('#play');
  const video = page.locator('video');
  await play.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await play.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  const seek = page.getByRole('slider', { name: '再生位置' });
  await dragProjectedRange(page, seek, [0.28, 0.78]);
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(650);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime / element.duration))
    .toBeGreaterThan(0.65);
  await seek.press('Home');
  await expect(seek).toHaveValue('0');

  await page.locator('#play').click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused)).toBe(true);
  const original = await video.elementHandle();
  const watchPage = page.locator('#watch-page');
  await page.locator('#open-desktop').click();
  await expect(page).toHaveURL(/#desktop$/);
  await expect(stage).not.toHaveAttribute('data-transition', '');
  await expect(page.locator('#close-desktop')).toBeVisible();
  const docked = (await watchPage.boundingBox())!;
  expect(docked.width).toBeLessThan(page.viewportSize()!.width * 0.62);
  expect(
    await video.evaluate((element: HTMLVideoElement, first) => first === element && !element.paused, original),
  ).toBe(true);

  await play.click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await dragProjectedRange(page, seek, [0.24, 0.74]);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime / element.duration))
    .toBeGreaterThan(0.65);
  await dragProjectedRange(page, page.locator('#volume'), [0.54, 0.3]);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBeLessThan(0.42);
  await search.click();
  await search.press('ControlOrMeta+A');
  await search.press('Backspace');
  await page.keyboard.insertText('もう一度');
  await expect(page.getByRole('link', { name: 'もう一度、四角' })).toBeVisible();
  await expect(page.getByRole('link', { name: '透ける四角の動画' })).toBeHidden();
  const playback = () =>
    video.evaluate((element: HTMLVideoElement) => [element.currentTime, element.paused, element.volume]);
  const beforeBack = await playback();
  await page.goBack();
  await expect(page).not.toHaveURL(/#desktop$/);
  await expect(stage).not.toHaveAttribute('data-transition', '');
  await expect(watchPage).not.toHaveAttribute('inert', '');
  expect((await watchPage.boundingBox())!.width).toBeGreaterThan(docked.width);
  expect(await playback()).toEqual(beforeBack);
  expect(await video.evaluate((element, first) => first === element, original)).toBe(true);
  await expect(search).toHaveValue('もう一度');
  await search.fill('透ける');

  await page.keyboard.press('Alt+Shift+KeyQ');
  await expect(stage).toHaveCount(0);
  await expect(search).toHaveValue('透ける');
  await page.keyboard.press('Alt+Shift+KeyQ');
  await expect(stage).toHaveAttribute('data-mode', mode);
  await expect(page.locator('#watch-page')).not.toHaveAttribute('inert', '');
  await apply.click();
  await expect(stage).toHaveCount(0);
  await expect(apply).toHaveText('Around を適用');
  expect(problems).toEqual([]);
}

test('CSS3D keeps the tilted native controls operable without HTML-in-Canvas', async ({ page }) => {
  await exerciseSpatialControls(page, 'css');
});

test('the narrow window retains the basic Playground', async ({ page }) => {
  await open(page, false, { width: 880, height: 800 });
  await page.locator('#apply').click();
  await expect(model(page)).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  await expect(page.locator('.playground-stage')).toHaveCount(0);
});

test('reduced motion keeps the camera still after applying', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, false);
  await page.locator('#apply').click();
  const stage = page.locator('.playground-stage');
  await expect(stage).toHaveAttribute('data-mode', 'css');
  await expect(stage).not.toHaveAttribute('data-transition', '');
  const apply = page.locator('#apply');
  const before = await apply.boundingBox();
  await page.mouse.move(20, 350);
  await page.waitForTimeout(320);
  expect(await apply.boundingBox()).toEqual(before);
  await page.locator('#open-desktop').click();
  await expect(stage).not.toHaveAttribute('data-transition', '');
  const docked = await apply.boundingBox();
  expect(docked).not.toEqual(before);
  await page.mouse.move(20, 350);
  await page.waitForTimeout(320);
  expect(await apply.boundingBox()).toEqual(docked);
  await page.locator('#close-desktop').click();
  await expect(page).not.toHaveURL(/#desktop$/);
});

test('a direct desktop visit has a working video-only fallback and a way back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 880, height: 800 });
  await page.goto(origin + '/?basic#desktop');
  await expect(page.locator('body')).toHaveAttribute('data-desktop', 'basic');
  const monitor = page.locator('.desktop-lite canvas');
  const pixels = () => monitor.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const before = await pixels();
  await page.locator('#play').click();
  await expect.poll(pixels).not.toBe(before);
  const video = page.locator('video');
  const original = await video.elementHandle();
  await page.locator('#close-desktop').click();
  await expect(page).not.toHaveURL(/#desktop$/);
  await expect(monitor).toBeHidden();
  expect(
    await video.evaluate((element: HTMLVideoElement, first) => first === element && !element.paused, original),
  ).toBe(true);
});

test('HTML-in-Canvas in Chromium 153 syncs pointer drag, focus and keyboard', async () => {
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-blink-features=CanvasDrawElement'] });
  try {
    await exerciseSpatialControls(await browser.newPage({ deviceScaleFactor: 1.5 }), 'canvas');
  } finally {
    await browser.close();
  }
});

test('HTML-in-Canvas in stable Chrome syncs pointer drag, focus and keyboard', async () => {
  test.skip(process.env.AROUND_PLAYGROUND_STABLE !== '1', 'Requires installed Chrome with HTML-in-Canvas.');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await exerciseSpatialControls(await browser.newPage({ deviceScaleFactor: 1.5 }), 'canvas');
  } finally {
    await browser.close();
  }
});
