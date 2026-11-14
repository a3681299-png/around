import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { writeContent } from '../scripts/playground/content';
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
 * Explicit: AROUND_LIVE_SPACE=1 and AROUND_ROOM_FILE=<packed room .glb> (scripts/room/pack-room.mjs; the
 * room is private and never in the repository). AROUND_SPACE_BREAK=density runs the same steps on a
 * build without the readability density, which must fail the readability check.
 * Pictures and the recording go to .work/space-live (not committed).
 */
const shots = path.resolve('.work/space-live');
const WATCH = 'https://www.youtube.com/watch?v=LC1a-DwUhls';

async function roomPixels(page: Page, points: [number, number][]) {
  await page.evaluate((p) => {
    delete document.documentElement.dataset['aroundRoomPixels'];
    document.documentElement.dataset['aroundRoomSample'] = JSON.stringify(p);
  }, points);
  await expect(page.locator('html')).toHaveAttribute('data-around-room-pixels', /\[/, { timeout: 10000 });
  return JSON.parse((await page.locator('html').getAttribute('data-around-room-pixels'))!) as number[][];
}

test('real YouTube: the room behind the UI, glass plates that keep text readable, the controls on top', async () => {
  test.skip(
    process.env.AROUND_LIVE_SPACE !== '1' || !process.env.AROUND_ROOM_FILE,
    'Explicit real YouTube check (AROUND_LIVE_SPACE=1, AROUND_ROOM_FILE).',
  );
  test.setTimeout(420000);
  await mkdir(shots, { recursive: true });
  const variant: Record<string, string> = { AROUND_SPACE_PROBE: '1' };
  if (process.env.AROUND_SPACE_BREAK) variant['AROUND_SPACE_BREAK'] = process.env.AROUND_SPACE_BREAK;
  const extensionPath = await layeringBuild(DEFAULT_LAYERING, variant);
  const scheme = process.env.AROUND_SPACE_SCHEME === 'light' ? 'light' : 'dark';
  const names = process.env.AROUND_SPACE_BREAK === 'names';
  const tag = names ? `${scheme}-names` : scheme;
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-space-live-')), false, {
    headed: true,
    width: 1600,
    height: 940,
    extensionPath,
    ...(process.env.AROUND_SPACE_VIDEO === '1' ? { videoDir: path.join(shots, 'video') } : {}),
  });
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
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
    // The editor sometimes finds no target right after YouTube's first load (its page is still
    // settling); a person reloads and opens it again, and so does the test, once.
    const { panel } = await openEditor(popup, page).catch(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(3000);
      return openEditor(popup, page);
    });
    // On real YouTube the editor sometimes restores its session right after it opens and drops a
    // file chosen in that moment (no error is shown); choose it again once if no layer came.
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel.locator('.model-file').setInputFiles(path.resolve(process.env.AROUND_ROOM_FILE!));
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
    // Mixed artwork (the contest's demo): the room behind, and the Playground's resident in front
    // at the player's bottom edge, under the guard.
    const mixed = process.env.AROUND_SPACE_MIXED === '1';
    const content = path.resolve('.work/space-live/content');
    const { models } = mixed ? writeContent(path.resolve('.'), content) : { models: [] as string[] };
    if (mixed) {
      await panel.locator('.model-file').setInputFiles(
        path.join(
          content,
          models.find((n) => n.endsWith('.vrm'))!,
        ),
      );
      await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 60000 });
      await panel
        .locator('.character-file')
        .setInputFiles(models.filter((n) => n.endsWith('.vrma')).map((n) => path.join(content, n)));
      await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
    }
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    )) as { decorations: { assetId: string; source?: { format?: string } }[] } & Record<string, unknown>;
    const assetId = saved.decorations.find((l) => l.source?.format !== 'vrm')!.assetId;
    const residentLayer = saved.decorations.find((l) => l.source?.format === 'vrm');
    const design = JSON.parse(await readFile(path.join(content, 'design.json'), 'utf8').catch(() => '{}'));
    const resident = design.decorations?.find((l: { id: string }) => l.id === 'resident');
    const bright = process.env.AROUND_SPACE_BRIGHT === '1';
    // The room lit so its shape reads (the test room's daylight layer); the night look otherwise.
    const noon = Number(process.env.AROUND_SPACE_NOON ?? 0.12);
    await storeDesign(popup, {
      ...saved,
      decorations:
        mixed && residentLayer && resident
          ? [
              {
                ...residentLayer,
                placement: { ...resident.placement, x: 0.9, y: 0.86, widthPx: 300, heightPx: 380 },
                character: { ...resident.character, autonomy: false },
              },
            ]
          : [],
      space: {
        ...DEFAULT_SPACE_LOOK,
        room: { assetId },
        lights: { ...DEFAULT_SPACE_LOOK.lights, ...(noon > 0 ? { sun_noon: noon } : {}) },
        // The brightest the artwork can make the room: the readability check's worst case.
        ...(bright
          ? {
              lights: { sun_noon: 4, sun_night: 4, room_desk: 4, room_pendant: 4, screen: 4, screen_monitor: 4 },
              videoLight: 2,
            }
          : {}),
      },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(page.locator('html')).toHaveAttribute('data-around-room', 'ready', { timeout: 60000 });
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
    await page.screenshot({ path: path.join(shots, `${tag}-1-rest.png`), caret: 'initial' });

    // The room is under the content: the canvas is never what a point on the page hits (a grid
    // over the whole viewport), and the page background is transparent.
    const stacking = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[data-around-room]')!;
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
    const frame = async () => JSON.parse((await page.locator('html').getAttribute('data-around-room-frame'))!);
    // The playing video lights the room (its colour read on the GPU).
    await expect
      .poll(async () => (await frame()).light, { timeout: 15000, message: JSON.stringify(await frame()) })
      .toBeGreaterThan(0.005);
    await page.mouse.move(1550, 120, { steps: 8 });
    await page.waitForTimeout(1500);
    const right = await frame();
    await page.screenshot({ path: path.join(shots, `${tag}-2-pointer-right.png`), caret: 'initial' });
    // Inside the viewport (the window is taller than the page's view by its own frame).
    await page.mouse.move(60, 780, { steps: 8 });
    await page.waitForTimeout(1500);
    const left = await frame();
    expect(right.camera[0]).toBeGreaterThan(0.05);
    expect(left.camera[0]).toBeLessThan(-0.05);
    if (mixed) {
      // The front character is drawn (guarded), the room-depth part has none here.
      await expect(page.locator('html')).toHaveAttribute('data-around-guard', 'on');
      await expect(page.locator('.model-media').first()).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    }
    // Down to the comments: the left column's gaps between comments show the room.
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(1200);
    await page
      .locator('ytd-comments#comments')
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.locator('ytd-comment-view-model').count(), { timeout: 20000 }).toBeGreaterThan(2);
    await page.waitForTimeout(2500);
    const scrolled = await frame();
    expect(scrolled.camera[2]).toBeGreaterThan(0.3);
    await page.screenshot({ path: path.join(shots, `${tag}-3-comments.png`), caret: 'initial' });
    await page.screenshot({
      path: path.join(shots, `${tag}-3-comments-gaps.png`),
      caret: 'initial',
      clip: { x: 0, y: 200, width: 760, height: 420 },
    });

    // The readability's way out: a build without the part names (AROUND_SPACE_BREAK=names) must plate
    // the columns. On real YouTube it may plate one too when the page shows text no known part
    // covers (an "Auto-dubbed" label seen 2026-11-08): that is the way out working, not a failure.
    // Either way the check below decides: every visible run of text is on glass at 4.5:1.
    const fallback = (await frame()).fallback as number[][];
    console.log(`[space-live] fallback column plates: ${JSON.stringify(fallback)}`);
    if (names) expect(fallback.length).toBeGreaterThan(0);

    // Readability: behind every visible run of text in the page's columns (each comment, each
    // recommendation's text, the title, the masthead; known to the adapter or not), the drawn
    // background keeps the scheme's protected text at 4.5:1. Text on a picture (the player, a
    // thumbnail) or on a part YouTube paints opaque is read against that, not the room.
    const grid = await page.evaluate(() => {
      const pts: [number, number][] = [];
      const range = document.createRange();
      const picture = '#movie_player, ytd-thumbnail, yt-thumbnail-view-model, yt-collection-thumbnail-view-model, img';
      const opaque = (e: Element | null) => {
        for (let n = e; n && n.localName !== 'ytd-app'; n = n.parentElement) {
          const c =
            getComputedStyle(n)
              .backgroundColor.match(/[\d.]+/g)
              ?.map(Number) ?? [];
          if (c.length === 3 || (c.length === 4 && c[3]! >= 0.95)) return true;
        }
        return false;
      };
      for (const e of document.querySelectorAll(
        'ytd-watch-flexy:not([hidden]) #below, ytd-watch-flexy:not([hidden]) #secondary, #masthead-container',
      )) {
        const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
          // Text not shown (a tooltip waiting, opacity 0) is not read.
          acceptNode: (n) =>
            n.parentElement?.closest(picture) ||
            !n.parentElement?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
            opaque(n.parentElement)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        // Text clipped by a box it is in (an ellipsis past a recommendation's text) or by the page
        // (under the scrollbar, under the masthead) is not shown: only the shown part counts.
        const clipOf = (n: Element) => {
          let l = 0,
            t = 64,
            r = document.documentElement.clientWidth,
            b = innerHeight;
          for (let p: Element | null = n; p && p !== e.parentElement; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
            const box = p.getBoundingClientRect();
            l = Math.max(l, box.left);
            t = Math.max(t, box.top);
            r = Math.min(r, box.right);
            b = Math.min(b, box.bottom);
          }
          return { l, t, r, b };
        };
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.nodeValue?.trim()) continue;
          const clip = clipOf(node.parentElement!);
          range.selectNodeContents(node);
          for (const r of range.getClientRects())
            for (let y = Math.max(r.top, clip.t) + 2; y < Math.min(r.bottom, clip.b) - 2; y += 6)
              for (let x = Math.max(r.left, clip.l) + 1; x < Math.min(r.right, clip.r) - 1; x += 12) pts.push([x, y]);
        }
      }
      // An even share of every part when there are more points than one readback takes.
      const step = Math.max(1, Math.ceil(pts.length / 4000));
      return pts.filter((_, i) => i % step === 0);
    });
    const pixels = await roomPixels(page, grid);
    const text = PLATE_TEXT[scheme].text;
    const ratios = pixels.map(([r, g, b]) => contrast(text, luminance(r!, g!, b!)));
    const worst = Math.min(...ratios);
    const at = grid[ratios.indexOf(worst)]!;
    const where = await page.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return `${e?.localName}#${e?.id}.${e?.className}`.slice(0, 80);
    }, at);
    if (worst < READABLE_CONTRAST) {
      // Which plates are near the worst point (for the failure's record).
      const boxes = ((await frame()).boxes as number[][]).filter(
        ([l, t, r, b]) => at[0] > l! - 60 && at[0] < r! + 60 && at[1] > t! - 60 && at[1] < b! + 60,
      );
      console.log(`[space-live] plates near the worst point: ${JSON.stringify(boxes)}`);
    }
    console.log(
      `[space-live] ${scheme}${bright ? ' bright' : ''}: plate samples ${pixels.length}, worst contrast ${worst.toFixed(2)} at ${at.map(Math.round).join(',')} (${where}) rgb ${pixels[ratios.indexOf(worst)]}`,
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
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(shots, `${tag}-4-theater.png`), caret: 'initial' });
    // The theater's sides: the room on both sides of the picture.
    const sides = await page.evaluate(() => {
      const v = document.querySelector('#movie_player video')!.getBoundingClientRect();
      return { left: v.left, right: v.right, top: v.top, bottom: v.bottom };
    });
    if (sides.left > 40)
      await page.screenshot({
        path: path.join(shots, `${tag}-4-theater-side.png`),
        caret: 'initial',
        clip: {
          x: 0,
          y: Math.max(0, sides.top),
          width: Math.min(sides.left, 500),
          height: Math.min(420, sides.bottom - sides.top),
        },
      });
    await page.keyboard.press('t');
    await page.setViewportSize({ width: 1100, height: 760 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, `${tag}-5-narrow.png`), caret: 'initial' });
  } finally {
    await context.close();
  }
});
