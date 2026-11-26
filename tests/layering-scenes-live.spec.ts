import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { writeContent } from '../scripts/playground/content';

/**
 * Chunk 4 on real YouTube (docs/layering-plan.md): the scenes not seen in the first prototype,
 * with the test mannequin under the player's controls. Captions (they are read: they must stay
 * over the character), fullscreen, the miniplayer and the end screen, and an advert when one comes.
 * In each, the character is not stopped (or takes the cut-out way where a part is not proven),
 * YouTube's parts are over it and the point of a button is never the extension's. Fullscreen is
 * headless only: an off-screen headed window would go fullscreen on the nearest monitor, over the
 * person's work. AROUND_LIVE_HEADED=1 opens the other scenes in an off-screen window. Explicit:
 * AROUND_LIVE_LAYERING=1 (the normal build; a AROUND_GUARD_TRACE build also records why). Pictures go to
 * .work/layering-scenes.
 */
const shots = path.resolve('.work/layering-scenes');

async function residentOnYouTube(
  placement: { x: number; y: number; widthPx: number; heightPx: number },
  video = 'LC1a-DwUhls',
) {
  await mkdir(shots, { recursive: true });
  const content = path.join(shots, 'content');
  const { models } = writeContent(path.resolve('.'), content);
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  // Headed only off screen (scripts/test.mjs sets AROUND_TEST_WINDOW_OFFSCREEN=1), and never for
  // fullscreen: a headless player often fails to load the video after an advert.
  const headed = process.env.AROUND_LIVE_HEADED === '1' && process.env.AROUND_TEST_WINDOW_OFFSCREEN === '1';
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-layering-scenes-')), false, {
    headed,
    width: 1280,
    height: 860,
  });
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
  await item.waitFor();
  const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
  await manager.close();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`https://www.youtube.com/watch?v=${video}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
  await declinePromotion(page);
  for (let i = 0; i < 60 && (await page.locator('#movie_player.ad-showing').count()); i++)
    await page.waitForTimeout(500);
  await showArtwork(popup);
  const { panel } = await openEditor(popup, page);
  await panel.locator('.model-file').setInputFiles(file(models.find((name) => name.endsWith('.vrm'))!));
  await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
  await panel.locator('.character-file').setInputFiles(models.filter((name) => name.endsWith('.vrma')).map(file));
  await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(page);
  const resident = design.decorations.find((layer: { id: string }) => layer.id === 'resident');
  await storeDesign(popup, {
    ...design,
    siteId: 'youtube',
    rules: [],
    decorations: [
      {
        ...resident,
        placement: { ...resident.placement, ...placement },
        // Held where it is placed (the computed body would stand it on the bar).
        character: { ...resident.character, autonomy: false, computedMotion: false },
      },
    ],
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
  await declinePromotion(page);
  await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
    v.muted = true;
    void v.play().catch(() => undefined);
  });
  // Every frame: is the character stopped, in this phase? (as in layering-live.spec.ts)
  await page.evaluate(() => {
    const w = window as unknown as {
      aroundPhase: string;
      aroundStops: Record<string, [number, number]>;
      aroundWhy: Record<string, string[]>;
    };
    w.aroundPhase = 'start';
    w.aroundStops = {};
    w.aroundWhy = {};
    const tick = () => {
      let node: Element | undefined;
      for (const host of document.querySelectorAll('[id^="around"]'))
        node ??= host.shadowRoot?.querySelector('[data-image-id="resident"]') ?? undefined;
      const row = (w.aroundStops[w.aroundPhase] ??= [0, 0]);
      row[0]++;
      if (!node || node.hasAttribute('data-safety-limited')) {
        row[1]++;
        // Why: the guard's stop entries for it, and where its node was (once each).
        const record = document.querySelector<HTMLElement>('[data-around-safety]')?.dataset.aroundSafety;
        const issues = (JSON.parse(record ?? '{}').issues ?? []) as {
          layerId: string;
          action?: string;
          surfaceId: string;
          reason: string;
        }[];
        const why = (w.aroundWhy[w.aroundPhase] ??= []);
        const texts = [
          ...issues
            .filter((i) => i.layerId === 'resident' && i.action === 'stop')
            .map((i) => `${i.surfaceId}: ${i.reason}`),
          `node in ${node ? (node.getRootNode() as ShadowRoot).host?.id : 'none'}`,
          `ways ${document.documentElement.dataset['aroundLayeringWays']?.split('|').slice(-3).join('|') ?? ''}`,
        ];
        for (const text of texts) if (!why.includes(text)) why.push(text);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { context, page };
}

const phase = (page: Page, name: string) =>
  page.evaluate((n) => ((window as unknown as { aroundPhase: string }).aroundPhase = n), name);
const stops = (page: Page) =>
  page.evaluate(() => (window as unknown as { aroundStops: Record<string, [number, number]> }).aroundStops);
const whys = (page: Page) =>
  page.evaluate(() => (window as unknown as { aroundWhy: Record<string, string[]> }).aroundWhy);
/** Waits out an advert (pressing its own Skip when it offers one), up to 90 s. */
async function afterAdverts(page: Page) {
  for (let i = 0; i < 180 && (await page.locator('#movie_player.ad-showing').count()); i++) {
    const skip = page.locator('#movie_player :is(.ytp-skip-ad-button, .ytp-ad-skip-button-modern)').first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
/** Where the plane is: in the player, directly after its media, at its level. */
const plane = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('#around-video-decorations');
    const before = host?.previousElementSibling as HTMLElement | null;
    return {
      inPlayer: host?.parentElement?.id === 'movie_player',
      afterMedia: Boolean(before?.classList.contains('html5-video-container')),
      sameLevel: Boolean(host && before && getComputedStyle(host).zIndex === getComputedStyle(before).zIndex),
    };
  });
/** The character's drawn height as a share of the player's. */
const share = (page: Page) =>
  page.evaluate(() => {
    const player = document.querySelector('#movie_player')!.getBoundingClientRect();
    let node: Element | undefined;
    for (const host of document.querySelectorAll('[id^="around"]'))
      node ??= host.shadowRoot?.querySelector('[data-image-id="resident"]') ?? undefined;
    return (node?.getBoundingClientRect().height ?? 0) / player.height;
  });
/** The element at the centre of each given part: never the extension's. */
const points = (page: Page, selectors: string[]) =>
  page.evaluate(
    (list) =>
      list.flatMap((s) => {
        const b = [...document.querySelectorAll<HTMLElement>(s)].find((e) => e.getBoundingClientRect().width > 0);
        if (!b) return [];
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return [
          {
            s,
            own: Boolean(hit && (hit === b || b.contains(hit))),
            at: hit?.closest('[id]')?.id ?? hit?.tagName ?? null,
          },
        ];
      }),
    selectors,
  );
/**
 * A part's own bright pixels (a caption's letters, an end screen card's title) with the character,
 * and with the character's canvases made transparent: where the part is near white without it, it
 * is the same with it. Counted in the page from two screenshots of the part's box.
 */
async function ownPixels(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box || box.width < 4 || box.height < 4) return undefined;
  const canvases = (value: string) =>
    page.evaluate((v) => {
      const root = document.querySelector('#around-video-decorations')?.shadowRoot;
      for (const c of root?.querySelectorAll('canvas') ?? []) c.style.opacity = v;
    }, value);
  const a = await page.screenshot({ clip: box });
  await canvases('0');
  await page.waitForTimeout(80);
  const b = await page.screenshot({ clip: box });
  await canvases('');
  return page.evaluate(
    async ([x, y]) => {
      const read = async (b64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [p, q] = [await read(x!), await read(y!)];
      let compared = 0,
        covered = 0,
        shows = 0;
      for (let i = 0; i < q.length; i += 4) {
        const differs = Math.max(...[0, 1, 2].map((c) => Math.abs(p[i + c]! - q[i + c]!))) > 24;
        if (differs) shows++;
        if (!(q[i]! >= 235 && q[i + 1]! >= 235 && q[i + 2]! >= 235)) continue;
        compared++;
        if (differs) covered++;
      }
      return { compared, covered, shows };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}
/** The stacking chain of the first matching element up to the player, as YouTube has it now. */
const chainOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const player = document.querySelector('#movie_player')!;
    const e = player.querySelector(s);
    const chain: string[] = [];
    for (let c = e; c && c !== player; c = c.parentElement) {
      const st = getComputedStyle(c);
      chain.push(`${c.tagName.toLowerCase()}.${c.classList[0] ?? ''}:${st.position}/${st.zIndex}/${st.opacity}`);
    }
    return chain;
  }, selector);

/**
 * One scene in its own browser (a headless player that has played for a minute or two can fail
 * with "Something went wrong"). An advert first, if one plays (its parts over the character, then
 * waited out). The report is written whatever was reached; the plane must be in place, no frame
 * stopped in the scene's phases, and the extension must never take a part's point.
 */
async function scene(
  name: string,
  placement: { x: number; y: number; widthPx: number; heightPx: number },
  body: (page: Page, report: Record<string, unknown>) => Promise<void>,
  video?: string,
) {
  test.skip(process.env.AROUND_LIVE_LAYERING !== '1', 'Explicit real YouTube check (AROUND_LIVE_LAYERING=1).');
  test.setTimeout(300000);
  const { context, page } = await residentOnYouTube(placement, video);
  const report: Record<string, unknown> = {};
  try {
    await page.mouse.move(8, 8);
    await page.waitForTimeout(2000);
    report['plane'] = await plane(page);
    await phase(page, 'advert');
    if (await page.locator('#movie_player.ad-showing').count()) {
      report['advert'] = true;
      await page.screenshot({ path: path.join(shots, `${name}-advert.png`) });
    }
    await afterAdverts(page);
    await body(page, report);
    await phase(page, 'end');
  } finally {
    report['stops'] = await stops(page).catch(() => undefined);
    report['why'] = await whys(page).catch(() => undefined);
    // A trace build: why a read was not covered, and each part not proven (src/sites/youtube-operations.ts).
    report['unsettled'] = await page
      .evaluate(
        () => document.querySelector<HTMLElement>('#around-video-decorations')?.dataset['aroundBeneathUnsettled'],
      )
      .catch(() => undefined);
    report['place'] = await page
      .evaluate(() => document.documentElement.getAttribute('data-around-beneath-place'))
      .catch(() => undefined);
    report['notProven'] = await page
      .evaluate(() => document.documentElement.dataset['aroundBeneathRows']?.split('\n'))
      .catch(() => undefined);
    await writeFile(path.join(shots, `${name}-report.json`), JSON.stringify(report, null, 1));
    console.log(`LAYERING SCENE ${name} ` + JSON.stringify(report));
    await context.close();
  }
  expect(report['plane']).toEqual({ inPlayer: true, afterMedia: true, sameLevel: true });
  // A phase the body marked as taking the way out (the cut-out way, for a control the stacking
  // order cannot keep clear) is held by that way's own rules, as before: counted, not asserted.
  const wayOut = new Set((report['wayOut'] as string[] | undefined) ?? []);
  for (const [phaseName, [, stopped]] of Object.entries(report['stops'] as Record<string, [number, number]>))
    if (phaseName !== 'start' && !wayOut.has(phaseName))
      expect(stopped, `${name} ${phaseName}: frames stopped`).toBe(0);
}
const pointsOk = (scene: string, r: { plane: unknown; points: { s: string; at: string | null }[] }, wayOut = false) => {
  if (!wayOut) expect(r.plane, scene).toEqual({ inPlayer: true, afterMedia: true, sameLevel: true });
  for (const p of r.points) expect(p.at ?? '', `${scene} ${p.s}`).not.toMatch(/around/);
};

test('real YouTube: captions are drawn over the character', async () => {
  // Bottom centre, large: where captions are drawn.
  await scene(
    'captions',
    { x: 0.5, y: 0.78, widthPx: 340, heightPx: 420 },
    async (page, report) => {
      await phase(page, 'captions');
      // The player's own CC button, then a few points of the video until a caption shows.
      const box = (await page.locator('#movie_player').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 3 });
      const cc = page.locator('#movie_player .ytp-subtitles-button');
      if ((await cc.getAttribute('aria-pressed').catch(() => null)) !== 'true') await cc.click().catch(() => undefined);
      report['ccPressed'] = await cc.getAttribute('aria-pressed').catch(() => null);
      await page.mouse.move(8, 8);
      const caption = page.locator('#movie_player .ytp-caption-segment');
      let shown = false;
      for (const at of [40, 70, 100]) {
        await page.evaluate((t) => {
          const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
          v.currentTime = t;
          void v.play().catch(() => undefined);
        }, at);
        shown = await caption
          .first()
          .waitFor({ state: 'visible', timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        if (shown) break;
      }
      report['captionsShown'] = shown;
      // What the captions container holds and the player's state, for the report.
      report['captionState'] = await page.evaluate(() => {
        const c = document.querySelector('#ytp-caption-window-container');
        const v = document.querySelector<HTMLVideoElement>('video.html5-main-video');
        return {
          html: c?.innerHTML.slice(0, 300) ?? null,
          time: v?.currentTime,
          classes: document
            .querySelector('#movie_player')
            ?.className.split(' ')
            .filter((n) => /caption|ad-|cued|playing|paused|ended|error/.test(n)),
        };
      });
      if (!shown) {
        test.info().annotations.push({ type: 'not seen', description: 'no caption segment was shown' });
        return;
      }
      await page.waitForTimeout(400);
      report['captionChain'] = await chainOf(page, '.ytp-caption-segment');
      const letters = await ownPixels(page, '#movie_player .caption-window');
      report['captionPixels'] = letters;
      // The letters (near white) are the same with the character as without it: they are over it.
      expect(letters, 'caption pixels').toBeDefined();
      expect(letters!.compared).toBeGreaterThan(30);
      expect(letters!.covered).toBe(0);
      await page.screenshot({
        path: path.join(shots, 'captions.png'),
        clip: (await page.locator('#movie_player').boundingBox())!,
      });
      // A video with captions of its own (the song's automatic ones did not show): AROUND_CAPTION_VIDEO.
    },
    process.env.AROUND_CAPTION_VIDEO ?? 'dQw4w9WgXcQ',
  );
});

test('real YouTube: fullscreen and the miniplayer keep the character under the player parts', async () => {
  // An off-screen window would go fullscreen on the nearest monitor, over the person's work.
  test.skip(process.env.AROUND_LIVE_HEADED === '1', 'Fullscreen is checked headless only.');
  await scene('fullscreen', { x: 0.5, y: 0.78, widthPx: 340, heightPx: 420 }, async (page, report) => {
    // Fullscreen (f): the player is the same stacking; the plane stays after the media.
    await phase(page, 'fullscreen');
    await page.locator('#movie_player').focus();
    await page.keyboard.press('f');
    await page.waitForTimeout(2500);
    report['fullscreen'] = {
      element: await page.evaluate(() => document.fullscreenElement?.tagName ?? null),
      plane: await plane(page),
      points: await points(page, ['.ytp-play-button', '.ytp-fullscreen-button', '.ytp-settings-button']),
    };
    await page.mouse.move(640, 400, { steps: 3 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, 'fullscreen.png') });
    pointsOk('fullscreen', report['fullscreen'] as Parameters<typeof pointsOk>[1]);
    await phase(page, 'fullscreen-exit');
    await page.keyboard.press('f');
    await page.waitForTimeout(2000);
    // Miniplayer (i): YouTube moves the player into its fixed miniplayer.
    await phase(page, 'miniplayer');
    await page.mouse.move(8, 8);
    const regularShare = await share(page);
    await page.locator('#movie_player').focus();
    await page.keyboard.press('i');
    await page.waitForTimeout(2500);
    const mini = await page.locator('#movie_player').boundingBox();
    report['miniplayer'] = {
      box: mini,
      inMiniplayer: await page.evaluate(() =>
        Boolean(document.querySelector('#movie_player')?.closest('ytd-miniplayer')),
      ),
      // The adapter reports the reduced form on the part (chunk 4 fix, docs/layering-plan.md 9).
      reduced: await page.locator('#movie_player').evaluate((player) => player.hasAttribute('data-around-reduced')),
      regularShare,
      share: await share(page),
      plane: await plane(page),
      points: await points(page, ['.ytp-miniplayer-expand-watch-page-button', '.ytp-play-button']),
    };
    if (mini) await page.screenshot({ path: path.join(shots, 'miniplayer.png'), clip: mini });
    pointsOk('miniplayer', report['miniplayer'] as Parameters<typeof pointsOk>[1]);
    // The character keeps its share of the player in the miniplayer (2% for the drawn box's rounding).
    const reduced = report['miniplayer'] as { reduced: boolean; share: number };
    expect(reduced.reduced).toBe(true);
    expect(Math.abs(reduced.share - regularShare)).toBeLessThan(regularShare * 0.02);
    await phase(page, 'miniplayer-exit');
    await page.locator('#movie_player').focus();
    await page.keyboard.press('i');
    await page.waitForTimeout(2500);
    report['miniplayer-exit'] = {
      reduced: await page.locator('#movie_player').evaluate((player) => player.hasAttribute('data-around-reduced')),
      share: await share(page),
    };
    expect(report['miniplayer-exit']).toMatchObject({ reduced: false });
  });
});

test('real YouTube: the end screen and its autoplay card stay over the character', async () => {
  await scene(
    'end-screen',
    { x: 0.5, y: 0.78, widthPx: 340, heightPx: 420 },
    async (page, report) => {
      // The last seconds, then what YouTube shows when the video ends.
      await phase(page, 'end-screen');
      // YouTube's own player API: after an advert its video element can be another one for a while,
      // so the length and the seek go through the player.
      type YouTubePlayer = HTMLElement & {
        getDuration?: () => number;
        seekTo?: (s: number, a: boolean) => void;
        playVideo?: () => void;
      };
      // A short video played to its end without seeking (an automated player that seeks far ahead
      // is refused by YouTube: "Something went wrong").
      report['duration'] = await page.evaluate(() =>
        (document.querySelector('#movie_player') as YouTubePlayer).getDuration?.(),
      );
      await page.evaluate(() => (document.querySelector('#movie_player') as YouTubePlayer).playVideo?.());
      // YouTube marks the player when the video has ended (its end screen and autoplay follow).
      const ended = await page
        .waitForFunction(
          () =>
            document.querySelector('#movie_player')?.classList.contains('ended-mode') ||
            document.querySelector<HTMLVideoElement>('video.html5-main-video')?.ended,
          null,
          { timeout: 90000 },
        )
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(2500);
      report['endState'] = await page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('video.html5-main-video');
        return {
          time: v?.currentTime,
          duration: v?.duration,
          classes: document
            .querySelector('#movie_player')
            ?.className.split(' ')
            .filter((n) => /ad-|cued|playing|paused|ended|error/.test(n)),
        };
      });
      report['endScreen'] = {
        ended,
        shown: await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '#movie_player .html5-endscreen, #movie_player .ytp-autonav-endscreen-countdown-overlay, #movie_player .ytp-fullscreen-grid',
            ),
          ]
            .filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none')
            .map((e) => e.className.split(' ')[0]),
        ),
        plane: await plane(page),
        points: await points(page, [
          '.ytp-videowall-still',
          '.ytp-ce-element',
          '.ytp-autonav-endscreen-upnext-cancel-button',
          '.ytp-autonav-endscreen-upnext-play-button',
          '.ytp-play-button',
        ]),
      };
      await page.screenshot({
        path: path.join(shots, 'end-screen.png'),
        clip: (await page.locator('#movie_player').boundingBox())!,
      });
      // The autoplay card sits in a container without a z-index, under the media's level (the media
      // is gone once the video ends): not proven, so the character takes the way out (cut out, as
      // before) while they meet. Either way, its buttons are never the extension's.
      const ways = await page.evaluate(() => document.documentElement.dataset['aroundLayeringWays'] ?? '');
      const out = /way-out/.test(ways) || !(report['endScreen'] as { plane: { afterMedia: boolean } }).plane.afterMedia;
      report['endWays'] = ways;
      if (out) report['wayOut'] = ['end-screen'];
      pointsOk('end screen', report['endScreen'] as Parameters<typeof pointsOk>[1], out);
      if (!ended) test.info().annotations.push({ type: 'not seen', description: 'the video did not end' });
      // A short video (19 s), so it ends without a seek: AROUND_END_VIDEO.
    },
    process.env.AROUND_END_VIDEO ?? 'jNQXAC9IVRw',
  );
});
