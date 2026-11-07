import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';
import type { DesignDocument, ModelDecoration } from '../src/design/types';

/**
 * Reading is enough (docs/product-design-snapshot.md, "読み込むだけで、感情に応じて動く"): a person's
 * VRM and a folder of .vrma (never in the repository: WW_CHARACTER_VRM, WW_CHARACTER_MOTIONS) are
 * read through the editor with nothing set by hand. On real YouTube the character is then seen while
 * watching (at its home, the player's corner), sits on the edge at rest, plays the motion the import
 * assigned to each behaviour as the autonomy switches, and does not flicker with the pointer on it.
 * Headed off screen (a real GPU, the look a person sees). Explicit: WW_LIVE_CHARACTER_IMPORT=1.
 * Pictures and records stay in .work/character-import-live (they show the person's model).
 */
const out = path.resolve('.work/character-import-live');
const media = (page: Page) =>
  page.locator(
    ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations) .model-media',
  );
const wrapper = (page: Page) => media(page).locator('xpath=ancestor::*[@data-image-id][1]');

test('real YouTube: a character read with its motions is seen, sits at home and moves by itself', async () => {
  test.skip(
    process.env.WW_LIVE_CHARACTER_IMPORT !== '1' || !process.env.WW_CHARACTER_VRM || !process.env.WW_CHARACTER_MOTIONS,
    'Explicit: WW_LIVE_CHARACTER_IMPORT=1 with WW_CHARACTER_VRM and WW_CHARACTER_MOTIONS.',
  );
  test.setTimeout(420000);
  await mkdir(out, { recursive: true });
  const folder = process.env.WW_CHARACTER_MOTIONS!;
  const files = (await readdir(folder)).filter((f) => f.endsWith('.vrma')).map((f) => path.join(folder, f));
  expect(files.length).toBeGreaterThan(0);
  const profile = await mkdtemp(path.resolve('.work/p-'));
  // WW_CHARACTER_VIDEO=1: the page recorded for a person to watch (feet, sitting down, standing up).
  const video = process.env.WW_CHARACTER_VIDEO === '1';
  const context = await launchExtension(profile, false, {
    headed: true,
    width: 1280,
    height: 860,
    ...(video ? { videoDir: path.join(out, 'video') } : {}),
  });
  const report: Record<string, unknown> = {};
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
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page);
    const started = Date.now();
    await panel.locator('.model-file').setInputFiles(process.env.WW_CHARACTER_VRM!);
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 60000 });
    await panel.locator('.character-file').setInputFiles(files);
    await expect(panel.locator('.character-motions li')).toHaveCount(files.length, { timeout: 90000 });
    report['importMs'] = Date.now() - started;
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    const saved = (await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    )) as DesignDocument;
    const layer = saved.decorations[0] as ModelDecoration;
    const ids = layer.character!.motions.map((m) => m.id);
    const assigned = layer.character!.behaviourMotions ?? {};
    report['placement'] = layer.placement;
    report['roles'] = layer.character!.motions.map((m) => [m.id, m.role, m.loop]);
    report['assigned'] = assigned;
    // Nothing was set by hand: the home, the autonomy and the behaviours come from the import.
    expect(layer.placement.anchor).toEqual({ kind: 'surface', target: 'video-player' });
    expect(layer.character!.autonomy).toBe(true);
    // (Approaching is a walk only; without one it is left to the computed motion.)
    for (const name of ['rest', 'flee', 'return', 'doze'] as const) expect(assigned[name], name).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
      v.muted = true;
      void v.play().catch(() => undefined);
    });
    const away = { x: 8, y: 8 };
    await page.mouse.move(away.x, away.y);
    // Every frame from here: the drawn box, the clip, the behaviour, the seat and its weight, so
    // a jump between two frames (a pose switched at once) can be found afterwards.
    await page.evaluate(() => {
      const w = window as unknown as { wwRows: unknown[] };
      w.wwRows = [];
      const tick = (at: number) => {
        const media = [...document.querySelectorAll('[id^="web-world-themes"]')]
          .map((h) => h.shadowRoot?.querySelector<HTMLElement>('.model-media'))
          .find(Boolean);
        const wrap = media?.closest('[data-image-id]');
        if (media && wrap) {
          const f = JSON.parse(media.dataset.modelFrame ?? '{}');
          const r = wrap.getBoundingClientRect(),
            player = document.querySelector('#movie_player')!.getBoundingClientRect();
          w.wwRows.push({
            at,
            clip: f.clip,
            behaviour: f.body?.autonomy?.behaviour,
            seat: f.body?.autonomy?.seat,
            weight: f.body?.seatWeight ?? 0,
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            playerBottom: player.bottom,
            playerTop: player.top,
            held: wrap.hasAttribute('data-safety-limited'),
            host: wrap.getRootNode() instanceof ShadowRoot ? (wrap.getRootNode() as ShadowRoot).host.id : '',
          });
        }
        if (w.wwRows.length < 20000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(6000);
    const frame = () =>
      media(page).evaluate((e: HTMLElement) => {
        const f = JSON.parse(e.dataset.modelFrame!);
        return {
          clip: f.clip as number | null,
          behaviour: f.body?.autonomy?.behaviour as string | undefined,
          seatEdge: f.body?.autonomy?.seat as string | undefined,
          limited: Boolean(e.closest('[data-image-id]')?.hasAttribute('data-safety-limited')),
        };
      });
    // A sequence of pictures of the player (for a person: no pose switched at once).
    let shot = 0;
    const sequence = async (ms: number) => {
      const clip = (await page.locator('#movie_player').boundingBox())!;
      for (const end = Date.now() + ms; Date.now() < end;)
        await page.screenshot({ path: path.join(out, `seq-${String(shot++).padStart(3, '0')}.png`), clip });
    };
    const box = async () => (await wrapper(page).boundingBox())!;
    // Seen: what is on the screen over the character's box changes when the character is hidden.
    const seen = async (name: string) => {
      const b = await box();
      const clip = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: b.height };
      const shown = await page.screenshot({ path: path.join(out, `${name}.png`), clip });
      await wrapper(page).evaluate((e: HTMLElement) => (e.style.visibility = 'hidden'));
      await page.waitForTimeout(120);
      const hidden = await page.screenshot({ clip });
      await wrapper(page).evaluate((e: HTMLElement) => (e.style.visibility = ''));
      let differ = 0;
      for (let i = 0; i < Math.min(shown.length, hidden.length); i += 16) if (shown[i] !== hidden[i]) differ++;
      return differ;
    };
    const during = async (behaviour: string, timeout: number) => {
      let f = await frame();
      for (const end = Date.now() + timeout; f.behaviour !== behaviour && Date.now() < end;) {
        await page.waitForTimeout(40);
        f = await frame();
      }
      return f;
    };
    // Rest at home: seen, sitting on the lower edge, playing the rest motion.
    const rest = await during('rest', 4000);
    report['rest'] = rest;
    report['restSeen'] = await seen('rest');
    await page.screenshot({ path: path.join(out, 'watching.png') });
    // The bars shown (the pointer on the player, away from the character): drawn in front of it.
    const player = (await page.locator('#movie_player').boundingBox())!;
    await page.mouse.move(player.x + player.width * 0.15, player.y + player.height * 0.5, { steps: 4 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'bars-in-front.png') });
    await page.mouse.move(away.x, away.y, { steps: 3 });
    await page.waitForTimeout(3500);
    // A rush from the left: it stands up and flees; then home, it sits down again.
    const at = await box().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    await page.mouse.move(at.x - 700, at.y - 60);
    await page.waitForTimeout(250);
    await page.mouse.move(at.x - 70, at.y - 60, { steps: 4 });
    const flee = await during('flee', 1500);
    report['flee'] = flee;
    await sequence(1200);
    await page.screenshot({ path: path.join(out, 'flee.png') });
    // Away: it goes home.
    await page.mouse.move(away.x, away.y, { steps: 3 });
    const back = await during('return', 4000);
    report['return'] = back;
    await sequence(2500);
    await page.screenshot({ path: path.join(out, 'return.png') });
    await during('rest', 10000);
    await sequence(1500);
    // The pointer on the character: no frame held, nothing hidden (the flicker).
    const home = await box();
    await page.evaluate(() => {
      const w = window as unknown as { wwHeld: number; wwFrames: number; wwStop: boolean };
      w.wwHeld = w.wwFrames = 0;
      w.wwStop = false;
      const tick = () => {
        const m = document.querySelector('[id^="web-world-themes"]')
          ? [...document.querySelectorAll('[id^="web-world-themes"]')]
              .map((h) => h.shadowRoot?.querySelector('.model-media')?.closest('[data-image-id]'))
              .find(Boolean)
          : undefined;
        w.wwFrames++;
        if (!m || m.hasAttribute('data-safety-limited')) w.wwHeld++;
        if (!w.wwStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const cx = home.x + home.width / 2,
      cy = home.y + home.height / 2;
    await page.mouse.move(cx, cy, { steps: 8 });
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(cx + Math.sin(i / 4) * home.width * 0.2, cy);
      await page.waitForTimeout(60);
    }
    report['pointerOnCharacter'] = await page.evaluate(() => {
      const w = window as unknown as { wwHeld: number; wwFrames: number; wwStop: boolean };
      w.wwStop = true;
      return { frames: w.wwFrames, held: w.wwHeld };
    });
    await page.screenshot({ path: path.join(out, 'pointer-on.png') });
    // WW_CHARACTER_PACE=1 with a development build (WW_AUTONOMY_PACE, scripts/build.mjs): left
    // alone, it soon changes edges and dozes, without waiting minutes.
    if (process.env.WW_CHARACTER_PACE === '1') {
      await page.mouse.move(away.x, away.y, { steps: 3 });
      const top = await (async () => {
        let f = await frame();
        for (const end = Date.now() + 40000; f.seatEdge !== 'top' && Date.now() < end;) {
          await page.waitForTimeout(200);
          f = await frame();
        }
        return f;
      })();
      report['topSeat'] = top;
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(out, 'top-seat.png') });
      const doze = await during('doze', 60000);
      report['doze'] = doze;
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(out, 'doze.png') });
    }
    // The frames: the box never jumps between two frames except while hopping between edges, and
    // the seat's weight moves a frame's share at most; at rest it sits on its edge.
    const rows = (await page.evaluate(() => (window as unknown as { wwRows: unknown[] }).wwRows)) as {
      at: number;
      clip: number;
      behaviour: string;
      seat?: string;
      weight: number;
      x: number;
      y: number;
      playerBottom: number;
      playerTop: number;
      held: boolean;
      host: string;
    }[];
    await writeFile(path.join(out, 'frames.json'), JSON.stringify(rows));
    let jumps = 0,
      weightJumps = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!,
        b = rows[i]!;
      // A jump: further than 40 px at once, faster than any move goes (2 px/ms; a stalled frame
      // carries a run further than usual, at its own speed).
      const moved = Math.hypot(b.x - a.x, b.y - a.y);
      if (moved > 40 && moved / Math.max(1, b.at - a.at) > 2) jumps++;
      // The seat moves with time (BODY_TIMING.seatBlendMs, 320 ms end to end). A switch at once
      // moves it all the way in a frame; a stalled frame (the world catching up on its clock) may
      // move it further than usual, never half of it.
      if (Math.abs(b.weight - a.weight) >= 0.5) weightJumps++;
    }
    // Settled and fully seated (the box where it was for the last ten frames, not on its way):
    // it sits on an edge of the player, never in the air.
    const seated = rows.filter(
      (r, i) => r.weight === 1 && i >= 10 && rows.slice(i - 10, i).every((p) => Math.hypot(r.x - p.x, r.y - p.y) < 0.5),
    );
    const gap = (r: (typeof rows)[number]) => Math.min(Math.abs(r.y - r.playerBottom), Math.abs(r.y - r.playerTop));
    report['frames'] = {
      count: rows.length,
      jumps,
      weightJumps,
      seatedBottom: seated.filter((r) => r.seat === 'bottom').length,
      seatedTop: seated.filter((r) => r.seat === 'top').length,
      // How far a settled seated box centre (the hips) is from the nearer edge of the player (px).
      seatGap: seated.length ? Math.max(...seated.map(gap)) : null,
      hosts: [...new Set(rows.map((r) => `${r.seat ?? '-'}:${r.host}`))],
    };
    console.log('CHARACTER IMPORT LIVE ' + JSON.stringify({ ids, report }));
    await writeFile(path.join(out, 'report.json'), JSON.stringify({ ids, report }, null, 1));
    const f = report['frames'] as { jumps: number; weightJumps: number; seatedBottom: number; seatGap: number };
    expect(f.seatedBottom, 'frames seated on the lower edge').toBeGreaterThan(30);
    expect(f.seatGap, 'the seat is on the lower edge (px)').toBeLessThanOrEqual(3);
    expect(f.jumps, 'frames where the box jumps').toBe(0);
    expect(f.weightJumps, 'frames where the seat switches at once').toBe(0);

    expect(rest.behaviour).toBe('rest');
    expect(rest.clip).toBe(ids.indexOf(assigned.rest!.motion));
    expect(report['restSeen'] as number, 'the character is seen while watching').toBeGreaterThan(50);
    expect(flee.behaviour).toBe('flee');
    expect(flee.clip).toBe(ids.indexOf(assigned.flee!.motion));
    const pointer = report['pointerOnCharacter'] as { frames: number; held: number };
    expect(pointer.frames).toBeGreaterThan(60);
    expect(pointer.held, 'frames held with the pointer on the character').toBe(0);
    if (back.behaviour !== 'return')
      test.info().annotations.push({ type: 'not reached', description: `return: last ${back.behaviour}` });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
