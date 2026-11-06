import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion } from './helpers/youtube-live';
import { writeContent } from '../scripts/playground/content';

/**
 * The character flickering on real YouTube (chunk 4, docs/layering-plan.md): the test mannequin at
 * the player's corner, autonomy on, the pointer sweeping over the player, once while only watching
 * and once while editing (the editor connected, the page narrowed by a side panel's width). Every
 * frame: which way it is drawn, whether the guard stops it, and why. A flicker is a frame where it
 * goes from drawn to hidden, or a change of way (the plane moves between places). Explicit:
 * WW_LIVE_FLICKER=1 (headless; WW_TEST_EXTENSION_PATH for another build). Records go to .work/flicker-live.
 */
const out = path.resolve('.work/flicker-live');

/** Installed once: per frame, the way, the stop and its reasons, for the current phase. */
async function sampler(page: Page) {
  await page.evaluate(() => {
    type Row = { way: string; stopped: boolean; why: string; error: boolean };
    const w = window as unknown as { wwPhase: string; wwFrames: Record<string, Row[]> };
    w.wwPhase = 'start';
    w.wwFrames = {};
    const tick = () => {
      let node: Element | undefined,
        hostId = '';
      for (const host of document.querySelectorAll('[id^="web-world-themes"]')) {
        // The layer drawing the 3D character (the editor's working copy has its own layer id).
        const found = host.shadowRoot?.querySelector('.model-media')?.closest('[data-image-id]');
        if (found && !node) {
          node = found;
          hostId = host.id;
        }
      }
      const host = hostId ? document.getElementById(hostId) : null;
      const before = host?.previousElementSibling as HTMLElement | null;
      const way = !node
        ? 'none'
        : hostId !== 'web-world-themes-video-decorations'
          ? hostId.replace('web-world-themes-', '')
          : before?.classList.contains('html5-video-container') &&
              getComputedStyle(host!).zIndex === getComputedStyle(before).zIndex
            ? 'beneath'
            : 'cut-out';
      const stopped = !node || node.hasAttribute('data-safety-limited');
      let why = '';
      if (stopped) {
        const record = document.querySelector<HTMLElement>('[data-ww-safety]')?.dataset.wwSafety;
        const issues = (JSON.parse(record ?? '{}').issues ?? []) as {
          layerId: string;
          action?: string;
          surfaceId: string;
          reason: string;
        }[];
        why = issues
          .filter((i) => i.layerId === node?.getAttribute('data-image-id') && i.action === 'stop')
          .map((i) => `${i.surfaceId}: ${i.reason}`)
          .join(' / ');
      }
      // The player's own error screen over everything: such a frame says nothing about the guard.
      const failed = [...document.querySelectorAll<HTMLElement>('#movie_player .ytp-error')].some(
        (e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none',
      );
      (w.wwFrames[w.wwPhase] ??= []).push({ way, stopped, why, error: failed });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const phase = (page: Page, name: string) =>
  page.evaluate((n) => ((window as unknown as { wwPhase: string }).wwPhase = n), name);

/** The pointer across the player at three heights, around and over the character, then off. */
async function sweep(page: Page, rounds = 3) {
  const p = (await page.locator('#movie_player').boundingBox())!;
  for (let round = 0; round < rounds; round++)
    for (const fy of [0.5, 0.8, 0.95]) {
      await page.mouse.move(p.x + 10, p.y + p.height * fy);
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(p.x + 10 + ((p.width - 20) * i) / 20, p.y + p.height * fy);
        await page.waitForTimeout(40);
      }
    }
  await page.mouse.move(4, 4);
  await page.waitForTimeout(500);
}

/** Flickers in one phase's frames: drawn → hidden, and changes of way. */
function count(rows: { way: string; stopped: boolean; why: string; error: boolean }[]) {
  let hides = 0,
    switches = 0;
  const reasons: Record<string, number> = {},
    ways: Record<string, number> = {};
  rows.forEach((row, i) => {
    ways[row.way] = (ways[row.way] ?? 0) + 1;
    if (row.stopped) reasons[row.why || '(no stop entry)'] = (reasons[row.why || '(no stop entry)'] ?? 0) + 1;
    const prev = rows[i - 1];
    if (!prev) return;
    if (!prev.stopped && row.stopped) hides++;
    if (prev.way !== row.way) switches++;
  });
  return {
    frames: rows.length,
    stopped: rows.filter((r) => r.stopped).length,
    hides,
    switches,
    ways,
    reasons,
    playerError: rows.filter((r) => r.error).length,
  };
}

test('real YouTube: the character does not flicker while watching or while editing', async () => {
  test.skip(process.env.WW_LIVE_FLICKER !== '1', 'Explicit real YouTube check (WW_LIVE_FLICKER=1).');
  test.setTimeout(300000);
  await mkdir(out, { recursive: true });
  const content = path.join(out, 'content');
  const { models } = writeContent(path.resolve('.'), content);
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  // WW_FLICKER_VIDEO=1: a headed window kept off screen (scripts/test.mjs sets WW_TEST_WINDOW_OFFSCREEN=1),
  // recorded to .work/flicker-live/video for a person to watch.
  const video = process.env.WW_FLICKER_VIDEO === '1' && process.env.WW_TEST_WINDOW_OFFSCREEN === '1';
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-flicker-')), false, {
    headed: video,
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
    for (let i = 0; i < 60 && (await page.locator('#movie_player.ad-showing').count()); i++)
      await page.waitForTimeout(500);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page);
    await panel.locator('.model-file').setInputFiles(file(models.find((name) => name.endsWith('.vrm'))!));
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
    await panel.locator('.character-file').setInputFiles(models.filter((name) => name.endsWith('.vrma')).map(file));
    await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
    // Placed as a person would in the editor: the player's bottom-right corner, autonomy on.
    const resident = design.decorations.find((layer: { id: string }) => layer.id === 'resident');
    await panel.getByLabel('配置の基準').selectOption('video-player');
    await panel.getByLabel('画像の幅').fill(String(resident.placement.widthPx));
    await panel.getByLabel('画像の高さ').fill(String(resident.placement.heightPx));
    await panel.getByLabel('画像のX位置').fill(String(resident.placement.x * 100));
    await panel.getByLabel('画像のY位置').fill(String(resident.placement.y * 100));
    await panel.getByLabel('自律', { exact: true }).check();
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    // Paused: the flicker comes from the guard and the pointer, and an automated player that plays
    // for a minute fails ("Something went wrong", its error screen then covers the character).
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')!.pause());
    await declinePromotion(page);
    await sampler(page);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(2000);
    // Watching.
    await phase(page, 'watching');
    await sweep(page);
    // Editing: the editor connected (its own tab here), the page as wide as beside a side panel.
    await phase(page, 'opening-editor');
    const { panel: editing } = await openEditor(popup, page);
    // The layer the editor holds, and where it is anchored (it must be the saved one).
    report['editorAnchor'] = await editing
      .getByLabel('配置の基準')
      .inputValue()
      .catch(() => null);
    report['storedAnchor'] = await popup.evaluate(async () => {
      const design = (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
        'webWorldThemes.design.youtube'
      ] as { decorations: { id: string; placement: { anchor: unknown } }[] };
      return design.decorations.map((d) => ({ id: d.id, anchor: d.placement.anchor }));
    });
    // The reopened editor restores its own earlier working copy (anchored to the viewport, as just
    // imported), not the saved artwork: placed again at the player's corner, as the person had it.
    if (report['editorAnchor'] !== 'video-player') {
      await editing.getByLabel('配置の基準').selectOption('video-player');
      await editing.getByLabel('画像の幅').fill(String(resident.placement.widthPx));
      await editing.getByLabel('画像の高さ').fill(String(resident.placement.heightPx));
      await editing.getByLabel('画像のX位置').fill(String(resident.placement.x * 100));
      await editing.getByLabel('画像のY位置').fill(String(resident.placement.y * 100));
    }
    await page.bringToFront();
    await page.setViewportSize({ width: 880, height: 800 });
    await page.waitForTimeout(2500);
    // What is on the page while editing (the hosts and the layers they hold), for the report.
    report['editingHosts'] = await page.evaluate(() =>
      [...document.querySelectorAll('[id^="web-world-themes"]')].map((h) => ({
        id: h.id,
        parent: h.parentElement?.id || h.parentElement?.tagName,
        layers: [...(h.shadowRoot?.querySelectorAll('[data-image-id]') ?? [])].map((n) =>
          n.getAttribute('data-image-id'),
        ),
        hidden: document.hidden,
        editing: document.documentElement.getAttribute('data-ww-editing'),
      })),
    );
    await phase(page, 'editing');
    await sweep(page);
    await phase(page, 'end');
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            wwFrames: Record<string, { way: string; stopped: boolean; why: string; error: boolean }[]>;
          }
        ).wwFrames,
    );
    for (const [name, rows] of Object.entries(frames)) report[name] = count(rows);
    report['ways'] = await page.evaluate(() => document.documentElement.dataset['wwLayeringWays'] ?? null);
    await writeFile(path.join(out, 'frames.json'), JSON.stringify(frames));
    console.log('FLICKER ' + JSON.stringify(report));
    for (const name of ['watching', 'editing']) {
      const r = report[name] as ReturnType<typeof count>;
      expect(r.frames, name).toBeGreaterThan(100);
      // A record taken over YouTube's error screen is not a record of the character.
      expect(r.playerError, `${name}: frames over the player's error screen`).toBe(0);
      expect.soft(r.hides, `${name}: drawn → hidden`).toBe(0);
      expect.soft(r.switches, `${name}: changes of way`).toBe(0);
    }
  } finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
    await context.close();
  }
});
