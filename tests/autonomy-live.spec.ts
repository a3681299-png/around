import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { storeDesign } from './helpers/skin-verification';
import { writeContent } from '../scripts/playground/content';

/**
 * Chunk 3 on real YouTube: the Playground's artwork (the resident at the player's bottom-right
 * corner, autonomy on) with only the site ID changed. Home, a fast rush (it flees inside the
 * player), the pointer gone (it comes home) and a slow approach (it edges closer). Headless;
 * explicit: AROUND_LIVE_AUTONOMY=1. Screenshots are kept in .work/autonomy-live for a person to look at.
 */
const shots = path.resolve('.work/autonomy-live');
const media = (page: Page) =>
  page.locator(':is(#around-decorations, #around-video-decorations, #around-page-decorations) .model-media');

test('real YouTube: the resident sits at the player corner, flees a rush, comes home and edges closer', async () => {
  test.skip(process.env.AROUND_LIVE_AUTONOMY !== '1', 'Explicit real YouTube verification (AROUND_LIVE_AUTONOMY=1).');
  test.setTimeout(300000);
  await residentOnYouTube('autonomy');
});

// Its own page: a headless player that has played for a minute can fail ("Something went wrong").
test('real YouTube: the resident stays at the corner in theater mode and fullscreen', async () => {
  test.skip(process.env.AROUND_LIVE_AUTONOMY !== '1', 'Explicit real YouTube verification (AROUND_LIVE_AUTONOMY=1).');
  test.setTimeout(300000);
  await residentOnYouTube('corners');
});

// Chunk 4 fix (docs/layering-plan.md 9): the page is the adapter's, not the address.
test('real YouTube: t= on the same video keeps a fled resident where it is; another video brings it home', async () => {
  test.skip(process.env.AROUND_LIVE_AUTONOMY !== '1', 'Explicit real YouTube verification (AROUND_LIVE_AUTONOMY=1).');
  test.setTimeout(300000);
  await residentOnYouTube('address');
});

async function residentOnYouTube(mode: 'autonomy' | 'corners' | 'address') {
  await mkdir(shots, { recursive: true });
  const content = path.resolve('.work/autonomy-live/content');
  const { models } = writeContent(path.resolve('.'), content);
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-autonomy-live-')), false);
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
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
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
    // The same character layer as the Playground's; the room and the skin rules stay Playground's.
    await storeDesign(popup, {
      ...design,
      siteId: 'youtube',
      rules: [],
      decorations: design.decorations.filter((layer: { id: string }) => layer.id === 'resident'),
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.muted = true;
      void v.play().catch(() => undefined);
    });
    const player = (await page.locator('#movie_player').boundingBox())!;
    // Far away from the character (beyond its "near" radius) and off the player.
    const away = { x: 8, y: 8 };
    await page.mouse.move(away.x, away.y);
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#movie_player')!.classList.contains('ytp-autohide')), {
        timeout: 15000,
      })
      .toBe(true);
    await page.waitForTimeout(1500);
    const state = () =>
      media(page).evaluate((e: HTMLElement) => {
        const f = JSON.parse(e.dataset.modelFrame!);
        const node = e.closest('[data-image-id]');
        return {
          behaviour: f.body?.autonomy?.behaviour,
          alert: f.body?.autonomy?.alert,
          // Whether the protection stopped it (it is then hidden and its frame is not redrawn).
          limited: Boolean(node?.hasAttribute('data-safety-limited')),
          bars: !document.querySelector('#movie_player')!.classList.contains('ytp-autohide'),
          // Why it was stopped, if it was: the guard's stop entries (surface and reason).
          stops: (
            (JSON.parse(document.querySelector<HTMLElement>('[data-around-safety]')?.dataset.aroundSafety ?? '{}')
              .issues ?? []) as { action?: string; surfaceId: string; reason: string }[]
          )
            .filter((i) => i.action === 'stop')
            .map((i) => `${i.surfaceId}: ${i.reason}`),
        };
      });
    // The guard holds drawing for a moment while the player's own parts change (its bars fading
    // in or out, G1.3 HOLD); a picture is taken once that is over, and how long it took is kept.
    const shoot = async (name: string) => {
      const start = Date.now();
      await expect
        .poll(() => media(page).evaluate((e) => !e.closest('[data-image-id]')?.hasAttribute('data-safety-limited')), {
          timeout: 5000,
        })
        .toBe(true)
        .catch(() => undefined);
      const waited = Date.now() - start;
      const clip = (await page.locator('#movie_player').boundingBox())!;
      await page.screenshot({ path: path.join(shots, `youtube-${name}.png`), clip });
      return waited;
    };
    const box = async () => (await page.locator('[data-image-id="resident"]').first().boundingBox())!;
    const report: Record<string, unknown> = {};
    const home = await box();
    // One capture per moment (a capture holds the drawing briefly; never two in a row).
    report['home'] = { box: home, ...(await state()), shownAfterMs: await shoot('home') };
    expect(home.x + home.width / 2).toBeGreaterThan(player.x + player.width * 0.8);
    expect(home.y + home.height / 2).toBeGreaterThan(player.y + player.height * 0.6);
    if (mode === 'corners') {
      // The corner follows the player: theater mode, then fullscreen (pointer away, so it is home).
      const corner = async (name: string, key: string) => {
        await page.locator('#movie_player').focus();
        await page.keyboard.press(key);
        await page.mouse.move(away.x, away.y);
        await page.waitForTimeout(4000);
        const p = (await page.locator('#movie_player').boundingBox())!;
        const b = await box();
        const shown = await shoot(name);
        report[name] = {
          player: p,
          box: b,
          shownAfterMs: shown,
          fullscreen: await page.evaluate(() => Boolean(document.fullscreenElement)),
          ...(await state()),
        };
        expect(b.x + b.width / 2).toBeGreaterThan(p.x + p.width * 0.8);
        expect(b.y + b.height / 2).toBeGreaterThan(p.y + p.height * 0.6);
        expect(b.x + b.width / 2).toBeLessThan(p.x + p.width);
        expect(b.y + b.height / 2).toBeLessThan(p.y + p.height);
        return p;
      };
      const theater = await corner('theater', 't');
      expect(theater.width).toBeGreaterThan(player.width + 50);
      const full = await corner('fullscreen', 'f');
      expect(full.width).toBeGreaterThan(theater.width - 1);
      console.log('AUTONOMY CORNERS ' + JSON.stringify(report));
      return;
    }
    const at = { x: home.x + home.width / 2, y: home.y + home.height / 2 };
    // A rush from the left.
    await page.mouse.move(at.x - 700, at.y);
    await page.waitForTimeout(250);
    await page.mouse.move(at.x - 70, at.y, { steps: 4 });
    await page.waitForTimeout(500);
    const fled = await box();
    if (mode === 'address') {
      // The same video's address gains t= (and a query): the page is the same video's page (the
      // adapter's identity), so it stays where it fled. Then another video's ID in the address:
      // a new page, so it is home at once (the control that the record would see a jump).
      const follow = async (name: string, address: string) => {
        const clip = (await page.locator('#movie_player').boundingBox())!;
        const recording = page.evaluate(async (next) => {
          const node = () =>
            [...document.querySelectorAll('[id^="around"]')]
              .map((host) => host.shadowRoot?.querySelector('[data-image-id="resident"]'))
              .find(Boolean);
          const rows: { t: number; x: number; y: number; address: string }[] = [];
          const start = performance.now();
          await new Promise<void>((resolve) => {
            const tick = () => {
              const r = node()?.getBoundingClientRect();
              if (r) rows.push({ t: performance.now() - start, x: r.x, y: r.y, address: location.search });
              if (rows.length === 10) history.replaceState(history.state, '', next);
              if (performance.now() - start < 1200) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
          return rows;
        }, address);
        // Continuous pictures while the address changes (about 10 frames in), kept for a person.
        for (let i = 0; i < 4; i++)
          await page.screenshot({ path: path.join(shots, `youtube-${name}-${i}.png`), clip }).catch(() => undefined);
        const frames = await recording;
        const shown = await shoot(name);
        const after = frames.filter((row) => row.address.includes(new URL(address, 'https://x').search));
        const distances = after.map((row) => Math.hypot(row.x - home.x, row.y - home.y));
        report[name] = {
          frames: frames.length,
          framesAfter: after.length,
          minFromHome: Math.min(...distances),
          lastFromHome: distances.at(-1),
          shownAfterMs: shown,
        };
        return distances;
      };
      // Continuous pictures around the change, kept for a person to look at.
      const sameVideo = await follow('address-t', '/watch?v=LC1a-DwUhls&t=7s&pp=keep');
      const anotherVideo = await follow('address-other-video', '/watch?v=jNQXAC9IVRw');
      console.log('AUTONOMY ADDRESS ' + JSON.stringify(report));
      expect(Math.hypot(fled.x - home.x, fled.y - home.y)).toBeGreaterThan(100);
      // t=: no frame after the change is back home (it did not jump).
      expect(sameVideo.length).toBeGreaterThan(20);
      expect(Math.min(...sameVideo)).toBeGreaterThan(60);
      // Another video: home at once.
      expect(anotherVideo.at(-1)!).toBeLessThan(2);
      return;
    }
    // The player's size can still settle after the first read (the page's own layout).
    const room = (await page.locator('#movie_player').boundingBox())!;
    report['fled'] = { box: fled, ...(await state()), shownAfterMs: await shoot('fled') };
    // Away; it goes home.
    await page.mouse.move(away.x, away.y, { steps: 3 });
    await page.waitForTimeout(4000);
    const back = await box();
    report['returned'] = { box: back, ...(await state()), shownAfterMs: await shoot('returned') };
    // Calm, then a slow creep from the left.
    await page.waitForTimeout(6000);
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(away.x + ((at.x - 500 - away.x) * i) / 30, away.y + ((at.y - away.y) * i) / 30);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(4000);
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(at.x - 500 + i * 7, at.y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(2500);
    const near = await box();
    report['approached'] = { box: near, ...(await state()), shownAfterMs: await shoot('approached') };
    console.log('AUTONOMY LIVE ' + JSON.stringify(report));
    // Only in a AROUND_GUARD_TRACE build (.work): why the guard held drawing, if it did.
    const geometry = await page.evaluate(() => document.documentElement.getAttribute('data-around-guard-geometry'));
    if (geometry)
      console.log(
        'GUARD GEOMETRY ' +
          JSON.stringify((JSON.parse(geometry) as { change: string }[]).filter((e) => e.change !== 'sweep').slice(-25)),
      );
    // It fled inside the player (not off it), came back, and came closer on the slow approach.
    // The layer's box is wider than the drawn figure (it already reaches past the player's right
    // edge at home); the figure is the authored width around the box's middle, and that stays in.
    const figure = design.decorations.find((layer: { id: string }) => layer.id === 'resident').placement
      .widthPx as number;
    expect(Math.hypot(fled.x - home.x, fled.y - home.y)).toBeGreaterThan(100);
    expect(fled.x + fled.width / 2 - figure / 2).toBeGreaterThanOrEqual(room.x - 1);
    expect(fled.x + fled.width / 2 + figure / 2).toBeLessThanOrEqual(room.x + room.width + 1);
    expect(fled.y).toBeGreaterThanOrEqual(room.y - 1);
    report['room'] = room;
    expect(Math.hypot(back.x - home.x, back.y - home.y)).toBeLessThan(2);
    expect(near.x).toBeLessThan(home.x - 20);
  } finally {
    await context.close();
  }
}
