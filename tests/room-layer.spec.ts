import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures';
import { openEditor, closeEditorPages } from './helpers/editor';
import { showArtwork } from './helpers/artwork';
import { layeringBuild } from './helpers/layering-build';
import { roomFixture } from './helpers/room-fixture';
import { encodePng } from '../scripts/room/pack-room.mjs';
import { DEFAULT_SPACE_LOOK } from '../src/design/space';

/**
 * The depth foundation on the test page (docs/depth-foundation.md): the room is drawn under the
 * page's content, and artwork at `depth: 'room'` goes behind the UI with it, where the browser's
 * stacking keeps every control over it and no guard runs. WW_SPACE_BREAK=stacking (a .work build
 * that draws room-depth artwork over the UI instead) must fail these tests.
 */
const broken = process.env.WW_SPACE_BREAK === 'stacking';
const test = base.extend<object, { extensionPath: string }>({
  extensionPath: [
    async ({}, use) =>
      use(await layeringBuild(true, { WW_SPACE_PROBE: '1', ...(broken ? { WW_SPACE_BREAK: 'stacking' } : {}) })),
    { scope: 'worker' },
  ],
});
const key = 'webWorldThemes.design.youtube';

/** The room and a magenta image, imported through the editor; the stored artwork puts the image
 * at room depth over the player's Play button. */
async function roomArtwork(popup: Page, youtube: Page, mixed = false) {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.locator('#movie_player video').waitFor({ state: 'attached' });
  await showArtwork(popup);
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.model-file').setInputFiles({ name: 'room.glb', mimeType: '', buffer: roomFixture() });
  await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
  const magenta = new Uint8Array(64 * 64 * 3).map((_, i) => (i % 3 === 1 ? 0 : 255));
  await panel
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'magenta.png', mimeType: 'image/png', buffer: encodePng(64, 64, magenta) });
  await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 30000 });
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(youtube);
  const saved = (await popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key)) as {
    decorations: { kind: string; assetId: string }[];
  } & Record<string, unknown>;
  const room = saved.decorations.find((l) => l.kind === 'model3d')!;
  const image = saved.decorations.find((l) => l.kind === 'image')!;
  const play = await youtube.locator('#movie_player button[aria-label="Play"]').boundingBox();
  await popup.evaluate(async ([k, design]) => chrome.storage.local.set({ [k]: design }), [
    key,
    {
      ...saved,
      decorations: [
        {
          ...image,
          depth: 'room',
          placement: {
            anchor: { kind: 'viewport' },
            x: (play!.x + play!.width / 2) / youtube.viewportSize()!.width,
            y: (play!.y + play!.height / 2) / youtube.viewportSize()!.height,
            widthPx: 120,
            heightPx: 120,
            rotationDeg: 0,
          },
        },
        // Mixed artwork: one more image in front of the UI (the guard's), in the page's corner.
        ...(mixed
          ? [
              {
                ...image,
                id: 'front-image',
                placement: {
                  anchor: { kind: 'viewport' },
                  x: 0.97,
                  y: 0.95,
                  widthPx: 30,
                  heightPx: 30,
                  rotationDeg: 0,
                },
              },
            ]
          : []),
      ],
      space: { ...DEFAULT_SPACE_LOOK, room: { assetId: room.assetId } },
    },
  ] as const);
  await youtube.reload();
  await youtube.locator('#movie_player video').waitFor({ state: 'attached' });
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-room', 'ready', { timeout: 30000 });
}

test('the page keeps its background while the room prepares; the room then fades in over it', async ({
  popup,
  youtube,
}) => {
  // Recorded in each document from its start: the order in which the room's canvas and the
  // backdrop style (the page's background made transparent) arrive.
  await youtube.addInitScript(() => {
    const order: unknown[] = [];
    (globalThis as typeof globalThis & { __roomOrder?: unknown[] }).__roomOrder = order;
    let canvasSeen = false,
      styleSeen = false;
    new MutationObserver(() => {
      const canvas = document.querySelector('canvas[data-ww-room]'),
        style = document.getElementById('web-world-themes-backdrop');
      if (canvas && !canvasSeen) {
        canvasSeen = true;
        order.push(['canvas', Boolean(style), getComputedStyle(canvas).opacity]);
      }
      if (style && !styleSeen) {
        styleSeen = true;
        order.push(['style', Boolean(canvas)]);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await roomArtwork(popup, youtube);
  const shown = await youtube.evaluate(() => ({
    order: (globalThis as typeof globalThis & { __roomOrder?: unknown[] }).__roomOrder,
    opacity: getComputedStyle(document.querySelector('canvas[data-ww-room]')!).opacity,
  }));
  // The canvas comes first, transparent; the page's background turns transparent after it; at
  // 'ready' the room is fully shown.
  expect(shown).toEqual({
    order: [
      ['canvas', false, '0'],
      ['style', true],
    ],
    opacity: '1',
  });
});

test('the room is under the content and room-depth artwork stays behind every control, unguarded', async ({
  popup,
  youtube,
}) => {
  await roomArtwork(popup, youtube);
  // Room-only artwork: the guard does not observe the page at all.
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-guard', 'off');
  // The canvas and the artwork's host: under the content, never what a point hits.
  const placed = await youtube.evaluate(() => {
    const canvas = document.querySelector('canvas[data-ww-room]')!;
    const host = [...document.body.children].find((e) => e !== canvas && e.shadowRoot?.querySelector('img, .image')) as
      HTMLElement | undefined;
    let hits = 0;
    for (let y = 4; y < innerHeight; y += 30)
      for (let x = 4; x < innerWidth; x += 30) {
        const at = document.elementFromPoint(x, y);
        if (at === canvas || (host && at === host)) hits++;
      }
    const play = document
      .querySelector<HTMLElement>('#movie_player button[aria-label="Play"]')!
      .getBoundingClientRect();
    return {
      canvasZ: getComputedStyle(canvas).zIndex,
      hostZ: host ? getComputedStyle(host).zIndex : 'none',
      hostAfterCanvas: host?.previousElementSibling === canvas,
      hits,
      playHit: document.elementFromPoint(play.x + play.width / 2, play.y + play.height / 2)?.getAttribute('aria-label'),
      // Room-only artwork draws without the guard: it never writes a guard verdict.
      guardVerdict: host?.dataset['wwSafety'] ?? null,
    };
  });
  // Soft: the pixel check below runs too, so a broken build shows what a person would see.
  expect.soft(placed).toEqual({
    canvasZ: '-1',
    hostZ: '-1',
    hostAfterCanvas: true,
    hits: 0,
    playHit: 'Play',
    guardVerdict: null,
  });
  // What a person sees: the Play button's own pixels are drawn over the magenta artwork.
  expect(await magentaOverPlay(youtube)).toBeLessThan(0.5);
});

test('mixed artwork: the room-depth part stays behind the UI unguarded, the front part keeps the guard', async ({
  popup,
  youtube,
}) => {
  await roomArtwork(popup, youtube, true);
  // Something is in front: the guard observes the page.
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-guard', 'on');
  await expect(youtube.locator('#web-world-themes-room-decorations')).toBeAttached();
  const placed = await youtube.evaluate(() => {
    const canvas = document.querySelector('canvas[data-ww-room]')!;
    const plane = document.getElementById('web-world-themes-room-decorations')!;
    return {
      planeZ: getComputedStyle(plane).zIndex,
      planeAfterCanvas: plane.previousElementSibling === canvas,
      // The room-depth image is on the room plane, the front one is not.
      roomImages: plane.shadowRoot!.querySelectorAll('[data-image-id]').length,
    };
  });
  expect.soft(placed).toEqual({ planeZ: '-1', planeAfterCanvas: true, roomImages: 1 });
  expect(await magentaOverPlay(youtube)).toBeLessThan(0.5);
});

/** The share of magenta pixels inside the player's Play button, as drawn on screen. */
async function magentaOverPlay(youtube: Page) {
  const play = (await youtube.locator('#movie_player button[aria-label="Play"]').boundingBox())!;
  const shot = await youtube.screenshot({ clip: play, caret: 'initial' });
  return youtube.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext('2d')!;
    g.drawImage(image, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let magenta = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! < 60 && d[i + 2]! > 200) magenta++;
    return magenta / (d.length / 4);
  }, shot.toString('base64'));
}

test('the room follows the pointer and stops drawing in fullscreen', async ({ popup, youtube }) => {
  await roomArtwork(popup, youtube);
  const frame = async () => JSON.parse((await youtube.locator('html').getAttribute('data-ww-room-frame'))!);
  const size = youtube.viewportSize()!;
  await youtube.mouse.move(size.width - 5, size.height / 2, { steps: 4 });
  await expect.poll(async () => (await frame()).camera[0]).toBeGreaterThan(0.05);
  await youtube.mouse.move(5, size.height / 2, { steps: 4 });
  await expect.poll(async () => (await frame()).camera[0]).toBeLessThan(-0.05);
  await youtube.evaluate(() =>
    document
      .querySelector('#movie_player')!
      .requestFullscreen()
      .catch(() => undefined),
  );
  if (await youtube.evaluate(() => Boolean(document.fullscreenElement))) {
    await expect(youtube.locator('canvas[data-ww-room]')).toBeHidden();
    await youtube.evaluate(() => document.exitFullscreen());
    await expect(youtube.locator('canvas[data-ww-room]')).toBeVisible();
  }
});
