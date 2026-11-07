import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { layeringBuild, DEFAULT_LAYERING } from './helpers/layering-build';
import { PLATE_TEXT, READABLE_CONTRAST, contrast, luminance } from '../src/world/space';
import { DEFAULT_SPACE_LOOK } from '../src/design/space';

/**
 * The depth foundation on real YouTube (docs/depth-foundation.md): the test room behind the
 * watch page, the UI over it as glass plates, the room moving with the pointer and the scroll.
 * Explicit: WW_LIVE_SPACE=1 and WW_ROOM_FILE=<packed room .glb> (scripts/room/pack-room.mjs; the
 * room is private and never in the repository). WW_SPACE_BREAK=density runs the same steps on a
 * build without the readability density, which must fail the readability check.
 * Pictures and the recording go to .work/space-live (not committed).
 */
const shots = path.resolve('.work/space-live');
const WATCH = 'https://www.youtube.com/watch?v=LC1a-DwUhls';

async function roomPixels(page: Page, points: [number, number][]) {
  await page.evaluate((p) => {
    delete document.documentElement.dataset['wwRoomPixels'];
    document.documentElement.dataset['wwRoomSample'] = JSON.stringify(p);
  }, points);
  await expect(page.locator('html')).toHaveAttribute('data-ww-room-pixels', /\[/, { timeout: 10000 });
  return JSON.parse((await page.locator('html').getAttribute('data-ww-room-pixels'))!) as number[][];
}

test('real YouTube: the room behind the UI, glass plates that keep text readable, the controls on top', async () => {
  test.skip(
    process.env.WW_LIVE_SPACE !== '1' || !process.env.WW_ROOM_FILE,
    'Explicit real YouTube check (WW_LIVE_SPACE=1, WW_ROOM_FILE).',
  );
  test.setTimeout(420000);
  await mkdir(shots, { recursive: true });
  const variant: Record<string, string> = { WW_SPACE_PROBE: '1' };
  if (process.env.WW_SPACE_BREAK) variant['WW_SPACE_BREAK'] = process.env.WW_SPACE_BREAK;
  const extensionPath = await layeringBuild(DEFAULT_LAYERING, variant);
  const scheme = process.env.WW_SPACE_SCHEME === 'light' ? 'light' : 'dark';
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-space-live-')), false, {
    headed: true,
    width: 1600,
    height: 940,
    extensionPath,
    ...(process.env.WW_SPACE_VIDEO === '1' ? { videoDir: path.join(shots, 'video') } : {}),
  });
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await showArtwork(popup);
    // The room goes in through the real import and validation (it is one GLB model asset).
    const { panel } = await openEditor(popup, page);
    // On real YouTube the editor sometimes restores its session right after it opens and drops a
    // file chosen in that moment (no error is shown); choose it again once if no layer came.
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel.locator('.model-file').setInputFiles(path.resolve(process.env.WW_ROOM_FILE!));
      if (
        await expect(panel.locator('.layer'))
          .toHaveCount(1, { timeout: 30000 })
          .then(
            () => true,
            () => false,
          )
      )
        break;
    }
    await expect(panel.locator('.layer')).toHaveCount(1);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    )) as { decorations: { assetId: string }[] } & Record<string, unknown>;
    const assetId = saved.decorations[0]!.assetId;
    const bright = process.env.WW_SPACE_BRIGHT === '1';
    await storeDesign(popup, {
      ...saved,
      decorations: [],
      space: {
        ...DEFAULT_SPACE_LOOK,
        room: { assetId },
        // The brightest the artwork can make the room: the readability check's worst case.
        ...(bright
          ? { lights: { sun_night: 4, room_desk: 4, room_pendant: 4, screen: 4, screen_monitor: 4 }, videoLight: 2 }
          : {}),
      },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(page.locator('html')).toHaveAttribute('data-ww-room', 'ready', { timeout: 60000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.muted = true;
      void v.play();
    });
    for (let i = 0; i < 60 && (await page.locator('#movie_player.ad-showing').count()); i++)
      await page.waitForTimeout(1000);
    await page.waitForTimeout(3000);
    await declinePromotion(page);
    await page.mouse.move(800, 470);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(shots, `${scheme}-1-rest.png`), caret: 'initial' });

    // The room is under the content: the canvas is never what a point on the page hits (a grid
    // over the whole viewport), and the page background is transparent.
    const stacking = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-ww-room]')!;
      let hits = 0;
      for (let y = 5; y < innerHeight; y += 40)
        for (let x = 5; x < innerWidth - 20; x += 40) if (document.elementFromPoint(x, y) === canvas) hits++;
      return {
        z: getComputedStyle(canvas).zIndex,
        parentIsBody: canvas.parentElement === document.body,
        canvasHits: hits,
        app: getComputedStyle(document.querySelector('ytd-app')!).backgroundColor,
      };
    });
    expect(stacking).toEqual({ z: '-1', parentIsBody: true, canvasHits: 0, app: 'rgba(0, 0, 0, 0)' });

    // The pointer and the scroll move the room only.
    const frame = async () => JSON.parse((await page.locator('html').getAttribute('data-ww-room-frame'))!);
    // The playing video lights the room (its colour read on the GPU).
    await expect
      .poll(async () => (await frame()).light, { timeout: 15000, message: JSON.stringify(await frame()) })
      .toBeGreaterThan(0.005);
    await page.mouse.move(1550, 120, { steps: 8 });
    await page.waitForTimeout(1500);
    const right = await frame();
    await page.screenshot({ path: path.join(shots, `${scheme}-2-pointer-right.png`), caret: 'initial' });
    // Inside the viewport (the window is taller than the page's view by its own frame).
    await page.mouse.move(60, 780, { steps: 8 });
    await page.waitForTimeout(1500);
    const left = await frame();
    expect(right.camera[0]).toBeGreaterThan(0.05);
    expect(left.camera[0]).toBeLessThan(-0.05);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(2000);
    const scrolled = await frame();
    expect(scrolled.camera[2]).toBeGreaterThan(0.3);
    await page.screenshot({ path: path.join(shots, `${scheme}-3-scrolled.png`), caret: 'initial' });

    // Readability: inside the reading column's plate, the drawn background behind the text keeps
    // the scheme's protected text at 4.5:1 (sampled on a grid over the whole column in view).
    const grid = await page.evaluate(() => {
      const r = document.querySelector('ytd-watch-flexy #secondary-inner')!.getBoundingClientRect();
      const pts: [number, number][] = [];
      for (let y = Math.max(r.top, 70) + 4; y < Math.min(r.bottom, innerHeight) - 4; y += 24)
        for (let x = r.left + 4; x < r.right - 4; x += 24) pts.push([x, y]);
      return pts;
    });
    const pixels = await roomPixels(page, grid);
    const text = PLATE_TEXT[scheme].text;
    const worst = Math.min(...pixels.map(([r, g, b]) => contrast(text, luminance(r!, g!, b!))));
    console.log(
      `[space-live] ${scheme}${bright ? ' bright' : ''}: plate samples ${pixels.length}, worst contrast ${worst.toFixed(2)}`,
    );
    expect(worst).toBeGreaterThanOrEqual(READABLE_CONTRAST);

    // The controls work: play/pause by the real button, the theater mode and back.
    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(800);
    await declinePromotion(page);
    await page.locator('#movie_player').hover();
    const paused = () =>
      page.evaluate(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')!.paused);
    const before = await paused();
    await page.locator('#movie_player .ytp-play-button').click();
    await expect.poll(paused).toBe(!before);
    await page.keyboard.press('t');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(shots, `${scheme}-4-theater.png`), caret: 'initial' });
    await page.keyboard.press('t');
    await page.setViewportSize({ width: 1100, height: 760 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, `${scheme}-5-narrow.png`), caret: 'initial' });
  } finally {
    await context.close();
  }
});
