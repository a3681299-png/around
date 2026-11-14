import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { pngPixels } from './helpers/png-pixels';

/**
 * G1, chunk 3, on real YouTube: the control bands are protected exactly while the bars are shown.
 * A magenta layer sits in the player's bottom-right corner. Headless; explicit: AROUND_LIVE_BANDS=1.
 * Every situation keeps the bars up (pointer, keys, pause, adverts, the end screen) and must show
 * no artwork in the band, from the frame the bars appear (the computed clip, read at the class
 * change and on every frame) and on screen (pixels, once the drawing is not held).
 */
const shots = path.resolve('.work/bands-live');
const BOTTOM = 112,
  TOP = 64;

/** Counts from one capture of the player (and keeps that capture when named): a second capture
 * right after can fall into the short hold the first one causes, so it is never used. */
async function magenta(page: Page, name?: string) {
  const player = (await page.locator('#movie_player').boundingBox())!;
  const shot = await page.screenshot({ clip: player, ...(name ? { path: path.join(shots, `${name}.png`) } : {}) });
  const { width, height, rgba } = pngPixels(shot);
  let band = 0,
    above = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (!(rgba[at]! > 200 && rgba[at + 1]! < 70 && rgba[at + 2]! > 200)) continue;
      if (y >= height - BOTTOM) band++;
      else above++;
    }
  return { band, above };
}
/** Installs the in-page watcher; the returned function stops it and reports. */
async function watch(page: Page) {
  await page.evaluate(
    ([top, bottom]) => {
      const player = document.querySelector('#movie_player')!;
      const w = window as unknown as { bandProblems: string[]; bandChecks: number; stopBands: () => void };
      w.bandProblems = [];
      w.bandChecks = 0;
      const check = (when: string) => {
        // While the bars are shown (no ytp-autohide), every plane over the player must cut the bands.
        if (player.classList.contains('ytp-autohide')) return;
        for (const host of document.querySelectorAll<HTMLElement>('#around-video-decorations')) {
          w.bandChecks++;
          const clip = getComputedStyle(host).clipPath;
          if (clip !== `inset(${top}px 0px ${bottom}px)`) w.bandProblems.push(`${when}: ${clip}`);
        }
      };
      const observer = new MutationObserver(() => check('class change'));
      observer.observe(player, { attributes: true, attributeFilter: ['class'] });
      let running = true;
      const frame = () => {
        if (!running) return;
        check('frame');
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      w.stopBands = () => {
        running = false;
        observer.disconnect();
      };
    },
    [TOP, BOTTOM] as const,
  );
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { bandProblems: string[]; bandChecks: number; stopBands: () => void };
      w.stopBands();
      return { problems: w.bandProblems, checks: w.bandChecks };
    });
}
const autohidden = (page: Page) =>
  page.evaluate(() => document.querySelector('#movie_player')!.classList.contains('ytp-autohide'));
const adShowing = (page: Page) =>
  page.evaluate(() => document.querySelector('#movie_player')!.classList.contains('ad-showing'));

test('real YouTube: the bands are free only while the bars are hidden, from the first shown frame', async () => {
  test.skip(process.env.AROUND_LIVE_BANDS !== '1', 'Explicit real YouTube verification (AROUND_LIVE_BANDS=1).');
  test.setTimeout(420000);
  await mkdir(shots, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-bands-live-')), false);
  const report: Record<string, unknown> = {};
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
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(process.env.AROUND_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    // An advert at the very start comes before the artwork exists; let it finish first. The advert
    // check below opens other videos once the artwork is in place.
    for (let i = 0; i < 60 && (await adShowing(page)); i++) await page.waitForTimeout(500);
    await showArtwork(popup);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    const { panel } = await openEditor(popup, page);
    const data = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const context = c.getContext('2d')!;
      context.fillStyle = '#ff00ff';
      context.fillRect(0, 0, 64, 48);
      return c.toDataURL();
    });
    await panel.getByLabel('画像素材を追加').setInputFiles({
      name: 'magenta.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data.split(',')[1]!, 'base64'),
    });
    await panel.getByLabel('配置の基準').selectOption('video-player');
    await panel.getByLabel('画像の幅').fill('180');
    await panel.getByLabel('画像の高さ').fill('200');
    await panel.getByLabel('画像のX位置').fill('92');
    await panel.getByLabel('画像のY位置').fill('86');
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const player = (await page.locator('#movie_player').boundingBox())!;
    const away = { x: player.x + player.width + 40, y: player.y + player.height + 120 };
    const play = () =>
      page.evaluate(() => {
        const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
        v.muted = true;
        void v.play().catch(() => undefined);
      });
    /** Playing, pointer away: wait for YouTube to hide the bars, then the band shows the artwork. */
    const hideBars = async () => {
      await play();
      await page.mouse.move(away.x, away.y);
      await expect.poll(() => autohidden(page), { timeout: 15000 }).toBe(true);
      await expect.poll(async () => (await magenta(page)).band, { timeout: 15000 }).toBeGreaterThan(800);
    };
    const shownBand = async (name?: string) => {
      let last = { band: -1, above: 0 };
      await expect.poll(async () => (last = await magenta(page, name)).above, { timeout: 15000 }).toBeGreaterThan(300);
      return last.band;
    };
    await hideBars();
    await magenta(page, 'hidden-bars');
    const center = { x: player.x + player.width / 2, y: player.y + player.height / 2 };
    for (const [name, action] of [
      ['pointer', () => page.mouse.move(center.x, center.y, { steps: 4 })],
      ['key k', async () => (await page.locator('#movie_player').focus(), page.keyboard.press('k'))],
      ['key ArrowRight', async () => (await page.locator('#movie_player').focus(), page.keyboard.press('ArrowRight'))],
      ['key Tab', async () => (await page.locator('#movie_player').focus(), page.keyboard.press('Tab'))],
    ] as const) {
      await hideBars();
      const stop = await watch(page);
      await action();
      await expect.poll(() => autohidden(page), { timeout: 5000 }).toBe(false);
      await page.waitForTimeout(250);
      const watched = await stop();
      const band = await shownBand(`shown-${name.replace(/\s/g, '-')}`);
      report[name] = { ...watched, band };
      expect(watched.problems, name).toEqual([]);
      expect(watched.checks, name).toBeGreaterThan(3);
      expect(band, name).toBe(0);
    }
    // Paused with the pointer over the player: the bars stay up, the band stays empty.
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')!.pause());
    await page.mouse.move(center.x, center.y, { steps: 3 });
    const pausedWatch = await watch(page);
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(center.x + (i % 2) * 6, center.y);
      await page.waitForTimeout(400);
    }
    report['paused, pointer over'] = {
      ...(await pausedWatch()),
      band: await shownBand('paused-pointer-over'),
      hidden: await autohidden(page),
    };
    expect((report['paused, pointer over'] as { problems: string[] }).problems).toEqual([]);
    expect((report['paused, pointer over'] as { hidden: boolean }).hidden).toBe(false);
    expect((report['paused, pointer over'] as { band: number }).band).toBe(0);
    // Paused with the pointer away: YouTube hides the bars (ytp-autohide) even while paused. Then
    // the band holds no visible control and may show the artwork; the watcher still checks that
    // no frame with the bars up was unclipped.
    await page.mouse.move(away.x, away.y);
    const awayWatch = await watch(page);
    await page.waitForTimeout(4000);
    report['paused, pointer away'] = { ...(await awayWatch()), hidden: await autohidden(page) };
    await magenta(page, 'paused-pointer-away');
    expect((report['paused, pointer away'] as { problems: string[] }).problems).toEqual([]);
    // The end screen: its cards stay up over the bars' area.
    // The video's own ended event (autoplay may move on soon after; a poll of `ended` can miss it).
    type Flags = { endedAt?: number };
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.addEventListener('ended', () => ((window as unknown as Flags).endedAt = Date.now()), { once: true });
      v.currentTime = Math.max(0, v.duration - 3);
      void v.play().catch(() => undefined);
    });
    const endWatch = await watch(page);
    const playerError = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#movie_player .ytp-error')].some(
          (e) => e.getBoundingClientRect().height > 0,
        ),
      );
    // In a headless profile, a seek to the end sometimes ends in YouTube's player error instead.
    await expect
      .poll(
        async () => (await page.evaluate(() => (window as unknown as Flags).endedAt ?? 0)) > 0 || (await playerError()),
        { timeout: 30000 },
      )
      .toBe(true);
    await page.waitForTimeout(1500);
    const endBand = await magenta(page, 'end-screen');
    report['end screen'] = {
      ...(await endWatch()),
      ...endBand,
      hidden: await autohidden(page),
      playerError: await playerError(),
    };
    expect((report['end screen'] as { problems: string[] }).problems).toEqual([]);
    if (!(report['end screen'] as { hidden: boolean }).hidden && !(await playerError())) expect(endBand.band).toBe(0);
    // Adverts: open related videos until one starts with an advert (at most 6), then watch the
    // band through the advert and a few seconds after it ends.
    const adverts: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 6 && !adverts.length; attempt++) {
      const next = await page.evaluate(() => {
        const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/watch?v="]')]
          .map((a) => a.href)
          .filter((href) => !href.includes('list='));
        return links[3 + 2 * Math.floor(Math.random() * 3)] ?? links[0];
      });
      if (!next) break;
      await page.goto(next, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2500);
      if (!(await adShowing(page))) continue;
      const adWatch = await watch(page);
      let frame = 0;
      for (let i = 0; i < 40 && (await adShowing(page)); i++) {
        adverts.push({ i, ...(await magenta(page, `advert-${frame++}`)), hidden: await autohidden(page) });
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(3000);
      adverts.push({ after: true, ...(await magenta(page, 'advert-after')), hidden: await autohidden(page) });
      report['advert'] = { ...(await adWatch()), samples: adverts };
    }
    report['advert seen'] = adverts.length > 0;
    console.log('BANDS LIVE ' + JSON.stringify(report));
    if (adverts.length) {
      expect((report['advert'] as { problems: string[] }).problems).toEqual([]);
      for (const sample of adverts as { band: number; hidden: boolean; after?: boolean }[])
        if (!sample.hidden && !sample.after) expect(sample.band).toBe(0);
    }
  } finally {
    console.log('BANDS LIVE REPORT ' + JSON.stringify(report));
    await context.close();
  }
});
