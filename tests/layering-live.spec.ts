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
 * Chunk 4 prototype on real YouTube (docs/layering-plan.md): the test mannequin sits at the
 * player's bottom-right corner, inside the player's own stacking under its controls. While the
 * pointer comes and goes, k pauses and plays, the settings menu and the context menu open, the
 * character is never stopped, the bars' own pixels stay on top of it and the real buttons work.
 * Explicit: WW_LIVE_LAYERING=1 with WW_TEST_EXTENSION_PATH=.work/layering-dist (a WW_LAYERING=1
 * build). WW_LIVE_LAYERING_BASELINE=1 runs the same steps on a normal build and only records
 * (the stops it shows are the guard's, as in chunk 3). Pictures go to .work/layering-live.
 */
const shots = path.resolve('.work/layering-live');
const baseline = process.env.WW_LIVE_LAYERING_BASELINE === '1';

test('real YouTube: the character under the player controls is never stopped and never covers them', async () => {
  test.skip(process.env.WW_LIVE_LAYERING !== '1', 'Explicit real YouTube check (WW_LIVE_LAYERING=1).');
  test.setTimeout(300000);
  await mkdir(shots, { recursive: true });
  const content = path.resolve('.work/layering-live/content');
  const { models } = writeContent(path.resolve('.'), content);
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-layering-live-')), false);
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
    // The Playground's resident at the corner, lowered so its legs are where the bottom bar's
    // buttons are drawn (that is what is checked); autonomy off so it stays there.
    const resident = design.decorations.find((layer: { id: string }) => layer.id === 'resident');
    await storeDesign(popup, {
      ...design,
      siteId: 'youtube',
      rules: [],
      decorations: [
        {
          ...resident,
          placement: { ...resident.placement, x: 0.9, y: 0.86, widthPx: 300, heightPx: 380 },
          // The computed body stands it on the bar; held where it is placed, it reaches into it.
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
    // Every frame, in the page: is the character stopped (hidden by the guard) in this phase?
    await page.evaluate(() => {
      const w = window as unknown as {
        wwPhase: string;
        wwStops: Record<string, [number, number]>;
        wwWhy: Record<string, string[]>;
      };
      w.wwPhase = 'start';
      w.wwStops = {};
      w.wwWhy = {};
      const node = () => {
        for (const host of document.querySelectorAll('[id^="web-world-themes"]'))
          for (const n of host.shadowRoot?.querySelectorAll('[data-image-id="resident"]') ?? []) return n;
        return undefined;
      };
      const tick = () => {
        const n = node();
        const row = (w.wwStops[w.wwPhase] ??= [0, 0]);
        row[0]++;
        if (!n || n.hasAttribute('data-safety-limited')) {
          row[1]++;
          // Why: the guard's stop entries for the character (surface and reason), once each.
          const record = document.querySelector<HTMLElement>('[data-ww-safety]')?.dataset.wwSafety;
          const issues = (JSON.parse(record ?? '{}').issues ?? []) as {
            layerId: string;
            action?: string;
            surfaceId: string;
            reason: string;
          }[];
          const why = (w.wwWhy[w.wwPhase] ??= []);
          for (const i of issues)
            if (i.layerId === 'resident' && i.action === 'stop') {
              const text = `${i.surfaceId}: ${i.reason}`;
              if (!why.includes(text)) why.push(text);
            }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const phase = (name: string) =>
      page.evaluate((n) => ((window as unknown as { wwPhase: string }).wwPhase = n), name);
    const shoot = async (name: string) => {
      const clip = (await page.locator('#movie_player').boundingBox())!;
      await page.screenshot({ path: path.join(shots, `${baseline ? 'baseline-' : ''}${name}.png`), clip });
    };
    const player = (await page.locator('#movie_player').boundingBox())!;
    const away = { x: 8, y: 8 };
    await page.mouse.move(away.x, away.y);
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#movie_player')!.classList.contains('ytp-autohide')), {
        timeout: 15000,
      })
      .toBe(true);
    await phase('idle');
    await page.waitForTimeout(1500);
    await shoot('idle');
    // Where the plane is: directly after the media, at its level.
    const plane = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('#web-world-themes-video-decorations');
      const before = host?.previousElementSibling as HTMLElement | null;
      return {
        parent: host?.parentElement?.id,
        afterMedia: Boolean(before?.classList.contains('html5-video-container')),
        z: host && getComputedStyle(host).zIndex,
        mediaZ: before && getComputedStyle(before).zIndex,
      };
    });
    // The pointer over the picture, away from the corner: the bars fade in.
    await phase('hover');
    await page.mouse.move(player.x + player.width * 0.3, player.y + player.height * 0.5, { steps: 4 });
    await page.waitForTimeout(700);
    await shoot('hover');
    await phase('leave');
    await page.mouse.move(away.x, away.y, { steps: 4 });
    await page.waitForTimeout(3500);
    await page.locator('#movie_player').focus();
    await phase('k-pause');
    await page.keyboard.press('k');
    await page.waitForTimeout(1200);
    await shoot('paused');
    // The bars' own pixels: the same with the character as without it, where they draw a glyph.
    const hosts = await page.evaluate(() =>
      [...document.querySelectorAll('[id^="web-world-themes"]')].map(
        (h) =>
          `${h.id} in ${h.parentElement?.id || h.parentElement?.tagName} resident:${Boolean(h.shadowRoot?.querySelector('[data-image-id="resident"]'))}`,
      ),
    );
    const bars = await barPixels(page);
    // The real buttons: what is under the play and settings buttons' centres is the button.
    const reach = await page.evaluate(() =>
      ['.ytp-play-button', '.ytp-settings-button', '.ytp-fullscreen-button'].map((s) => {
        const b = document.querySelector<HTMLElement>(`#movie_player ${s}`);
        if (!b) return { s, hit: false };
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          s,
          hit: Boolean(hit && (b === hit || b.contains(hit))),
          // What took the point instead (YouTube's own, or ours), for the report.
          at: hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${[...hit.classList].join('.')}` : null,
        };
      }),
    );
    await phase('k-play');
    await page.keyboard.press('k');
    await page.waitForTimeout(1200);
    // A real click on the play button pauses (and the guard lets it through).
    await phase('click-play');
    const playButton = page.locator('#movie_player .ytp-play-button');
    await page.mouse.move(player.x + player.width * 0.3, player.y + player.height * 0.5);
    await playButton.click();
    await page.waitForTimeout(600);
    const pausedByClick = await page.evaluate(() => document.querySelector<HTMLVideoElement>('video')!.paused);
    await page.keyboard.press('k');
    await phase('settings');
    await page.locator('#movie_player .ytp-settings-button').click();
    await page.waitForTimeout(1500);
    await shoot('settings');
    await page.keyboard.press('Escape');
    await page.mouse.move(away.x, away.y);
    await page.waitForTimeout(1500);
    await phase('context-menu');
    await page.mouse.click(player.x + player.width * 0.4, player.y + player.height * 0.4, { button: 'right' });
    await page.waitForTimeout(1200);
    await shoot('context-menu');
    await page.keyboard.press('Escape');
    await phase('end');
    const { stops, why } = await page.evaluate(() => {
      const w = window as unknown as { wwStops: Record<string, [number, number]>; wwWhy: Record<string, string[]> };
      return { stops: w.wwStops, why: w.wwWhy };
    });
    const ad = await page.evaluate(() => document.querySelector('#movie_player')!.classList.contains('ad-showing'));
    // A WW_GUARD_TRACE build also says why a pending read was not covered by the stacking order.
    const trace = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('#web-world-themes-video-decorations');
      return {
        unsettled: host?.dataset['wwBeneathUnsettled'],
        why: document.documentElement.dataset['wwBeneathWhy'],
        ways: document.documentElement.dataset['wwLayeringWays'],
      };
    });
    const report = { baseline, plane, hosts, stops, why, trace, bars, reach, pausedByClick, ad };
    await writeFile(
      path.join(shots, `${baseline ? 'baseline' : 'layering'}-report.json`),
      JSON.stringify(report, null, 1),
    );
    console.log('LAYERING LIVE ' + JSON.stringify(report));
    // G1 holds in both builds: the buttons are reached, a click works, the glyphs are on top.
    // The point is the button's, or YouTube's own part laid over it (an advert's badge over the
    // play button): never the extension's. Which it was is in the report.
    for (const r of reach) {
      expect(r.at, r.s).not.toBeNull();
      expect(r.at, `${r.s}: the extension takes the point`).not.toMatch(/web-world-themes/);
      if (!r.hit) test.info().annotations.push({ type: 'covered by YouTube', description: `${r.s}: ${r.at}` });
    }
    expect(reach.some((r) => r.hit)).toBe(true);
    expect(pausedByClick).toBe(true);
    expect(bars.compared).toBeGreaterThan(50);
    expect(bars.covered).toBe(0);
    if (baseline) return;
    // The character is under the shown bar (between and behind its buttons), not cut out of it.
    expect(bars.shows).toBeGreaterThan(300);
    expect(plane).toEqual({ parent: 'movie_player', afterMedia: true, z: plane.mediaZ, mediaZ: plane.mediaZ });
    // Never stopped, in any phase (a frame or two before the first read is allowed at start).
    for (const [name, [, stopped]] of Object.entries(stops))
      if (name !== 'start') expect(stopped, `${name}: frames stopped`).toBe(0);
  } finally {
    await context.close();
  }
});

/**
 * The bottom bar with the character, and with only the character's plane hidden: where the
 * bar draws a bright glyph (luminance over 200 without the character), the pixel is the same
 * with it (within 24 per channel). Counted in the page from two screenshots of the bar.
 */
async function barPixels(page: Page) {
  const box = (await page.locator('#movie_player .ytp-chrome-bottom').boundingBox())!;
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  const withIt = await page.screenshot({ clip });
  // The canvases inside the plane: the host's own style is reset by its :host{all:initial!important}
  // and the model's element sets visibility:visible, so neither hides it from outside.
  const canvases = (value: string) =>
    page.evaluate((v) => {
      const root = document.querySelector('#web-world-themes-video-decorations')?.shadowRoot;
      for (const canvas of root?.querySelectorAll('canvas') ?? []) canvas.style.opacity = v;
    }, value);
  await canvases('0');
  await page.waitForTimeout(100);
  const without = await page.screenshot({ clip });
  await canvases('');
  await writeFile(path.join(shots, `${baseline ? 'baseline-' : ''}bar-with.png`), withIt);
  await writeFile(path.join(shots, `${baseline ? 'baseline-' : ''}bar-without.png`), without);
  return page.evaluate(
    async ([a, b]) => {
      const read = async (b64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [p, q] = [await read(a!), await read(b!)];
      let compared = 0,
        covered = 0,
        // Pixels of the bar's box that the character changes at all: it is really under the bar.
        shows = 0;
      for (let i = 0; i < q.length; i += 4) {
        const differs = Math.max(...[0, 1, 2].map((c) => Math.abs(p[i + c]! - q[i + c]!))) > 24;
        if (differs) shows++;
        if (0.299 * q[i]! + 0.587 * q[i + 1]! + 0.114 * q[i + 2]! <= 200) continue;
        compared++;
        if (differs) covered++;
      }
      return { compared, covered, shows };
    },
    [withIt.toString('base64'), without.toString('base64')],
  );
}
