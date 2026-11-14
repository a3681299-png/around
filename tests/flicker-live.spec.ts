import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor, closeEditorPages } from './helpers/editor';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';
import { writeContent } from '../scripts/playground/content';

/**
 * The character flickering on real YouTube (chunk 4, docs/layering-plan.md): put the cursor inside
 * the default imported mannequin's box with autonomy on and off, and sweep the player with the
 * original mannequin at its corner. Watch normally and edit in a connected editor.
 * Every frame records the composition, guard, position and pose. Explicit:
 * AROUND_LIVE_FLICKER=1 (headless; AROUND_TEST_EXTENSION_PATH for another build). Records go to .work/flicker-live.
 */
const out = path.resolve('.work/flicker-live');
type Point = { x: number; y: number };
type Row = {
  at: number;
  way: string;
  stopped: boolean;
  why: string;
  error: boolean;
  pointer: Point | null;
  box: (Point & { width: number; height: number }) | null;
  behaviour: string | null;
  clip: number | null;
  suspended: boolean;
  pose: string | null;
  issues: string;
  guard: string;
};

/** Installed once: per frame, the way, the stop and its reasons, for the current phase. */
async function sampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { aroundPhase: string; aroundFrames: Record<string, Row[]> };
    w.aroundPhase = 'start';
    w.aroundFrames = {};
    let pointer: Point | null = null;
    let layerId: string | null = null;
    let lastSafety = '';
    let lastGeometry = '';
    let geometry = '';
    let issues: { layerId: string; action?: string; surfaceId: string; reason: string }[] = [];
    window.addEventListener('pointermove', (e) => (pointer = { x: e.clientX, y: e.clientY }), true);
    const tick = (at: number) => {
      let node: Element | undefined,
        media: HTMLElement | null | undefined,
        hostId = '';
      for (const host of document.querySelectorAll('[id^="around"]')) {
        // The layer drawing the 3D character (the editor's working copy has its own layer id).
        const model = host.shadowRoot?.querySelector<HTMLElement>('.model-media');
        const found = model?.closest('[data-image-id]');
        if (found && !node) {
          node = found;
          media = model;
          hostId = host.id;
        }
      }
      const host = hostId ? document.getElementById(hostId) : null;
      const before = host?.previousElementSibling as HTMLElement | null;
      const way = !node
        ? 'none'
        : hostId !== 'around-video-decorations'
          ? hostId.replace('around-', '')
          : before?.classList.contains('html5-video-container') &&
              getComputedStyle(host!).zIndex === getComputedStyle(before).zIndex
            ? 'beneath'
            : 'cut-out';
      const stopped = !node || node.hasAttribute('data-safety-limited');
      layerId = node?.getAttribute('data-image-id') ?? layerId;
      const safety = document.querySelector<HTMLElement>('[data-around-safety]')?.dataset.aroundSafety ?? '';
      if (safety !== lastSafety) {
        lastSafety = safety;
        issues = JSON.parse(safety || '{}').issues ?? [];
      }
      const layerIssues = issues
        .filter((i) => i.layerId === layerId)
        .map((i) => `${i.action ?? 'stop'} ${i.surfaceId}: ${i.reason}`)
        .join(' / ');
      const why = stopped ? layerIssues : '';
      const trace = document.documentElement.dataset.aroundGuardGeometry ?? '';
      if (trace !== lastGeometry) {
        lastGeometry = trace;
        const entries = JSON.parse(trace || '[]') as { change: string }[];
        geometry = JSON.stringify(entries.filter((e) => e.change !== 'sweep').slice(-1)[0] ?? null);
      }
      const frame = JSON.parse(media?.dataset.modelFrame ?? '{}');
      const bounds = media?.getBoundingClientRect();
      const box =
        bounds?.width && bounds.height
          ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          : null;
      // The player's own error screen over everything: such a frame says nothing about the guard.
      const failed = [...document.querySelectorAll<HTMLElement>('#movie_player .ytp-error')].some(
        (e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none',
      );
      (w.aroundFrames[w.aroundPhase] ??= []).push({
        at,
        way,
        stopped,
        why,
        error: failed,
        pointer,
        box,
        behaviour: frame.body?.autonomy?.behaviour ?? null,
        clip: frame.clip ?? null,
        suspended: frame.suspended ?? false,
        pose: frame.pose ? JSON.stringify(frame.pose) : null,
        issues: layerIssues,
        guard: geometry,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const phase = (page: Page, name: string) =>
  page.evaluate((n) => ((window as unknown as { aroundPhase: string }).aroundPhase = n), name);

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

const cursorModes = ['still', 'slow', 'cross'] as const;

async function overCharacter(page: Page, scene: string, run: string) {
  const shoot = (name: string, index: number) =>
    // Hiding the caret changes native inputs' inline styles and itself triggers a guard read.
    page.screenshot({ path: path.join(run, `${name}-${index}.png`), caret: 'initial' });
  const model = page.locator('.model-media');
  await expect(model).toBeVisible();
  const start = (await model.boundingBox())!;
  const startY = start.y + start.height / 2;
  // Approach the model gradually; a teleport from the masthead legitimately makes it flee
  // and leaves the following pointer path on an empty part of the player.
  await page.mouse.move(start.x - start.width, startY);
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(start.x + start.width * (i / 8 - 1), startY);
    await page.waitForTimeout(60);
  }
  for (const mode of cursorModes) {
    await expect(model).toBeVisible();
    const box = (await model.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const name = `${scene}-${mode}`;
    await phase(page, name);
    await page.mouse.move(x, y);
    if (mode === 'still') {
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(300);
        if (process.env.AROUND_FLICKER_SHOTS === '1') await shoot(name, i);
      }
    } else {
      const extent = mode === 'slow' ? box.width / 8 : box.width * 0.6;
      for (let i = 0; i <= 24; i++) {
        // Cross the inside edge twice without leaving the player at its outer edge.
        const wave = Math.sin((i / 12) * Math.PI);
        await page.mouse.move(x - extent * (mode === 'cross' ? wave * wave : wave), y);
        await page.waitForTimeout(50);
        if (process.env.AROUND_FLICKER_SHOTS === '1' && [3, 9, 15, 21].includes(i)) await shoot(name, i);
      }
    }
  }
  await phase(page, 'between-cursor-modes');
  await page.mouse.move(4, 4);
}

/** Flickers in one phase's frames: drawn → hidden, and changes of way. */
function count(rows: Row[]) {
  let hides = 0,
    switches = 0,
    behaviourChanges = 0,
    clipChanges = 0,
    suspensionChanges = 0,
    poseChanges = 0,
    positionChanges = 0,
    positionJumps = 0;
  const reasons: Record<string, number> = {},
    ways: Record<string, number> = {};
  rows.forEach((row, i) => {
    ways[row.way] = (ways[row.way] ?? 0) + 1;
    if (row.stopped) reasons[row.why || '(no stop entry)'] = (reasons[row.why || '(no stop entry)'] ?? 0) + 1;
    const prev = rows[i - 1];
    if (!prev) return;
    if (!prev.stopped && row.stopped) hides++;
    if (prev.way !== row.way) switches++;
    if (prev.behaviour !== row.behaviour) behaviourChanges++;
    if (prev.clip !== row.clip) clipChanges++;
    if (prev.suspended !== row.suspended) suspensionChanges++;
    if (prev.pose !== row.pose) poseChanges++;
    if (row.box && prev.box) {
      const distance = Math.hypot(row.box.x - prev.box.x, row.box.y - prev.box.y);
      if (distance >= 1) positionChanges++;
      if (distance >= 40) positionJumps++;
    }
  });
  return {
    frames: rows.length,
    stopped: rows.filter((r) => r.stopped).length,
    hides,
    switches,
    behaviourChanges,
    clipChanges,
    suspensionChanges,
    poseChanges,
    positionChanges,
    positionJumps,
    pointerInside: rows.filter(
      ({ pointer, box }) =>
        pointer &&
        box &&
        pointer.x >= box.x &&
        pointer.x < box.x + box.width &&
        pointer.y >= box.y &&
        pointer.y < box.y + box.height,
    ).length,
    ways,
    reasons,
    playerError: rows.filter((r) => r.error).length,
  };
}

for (const autonomy of [true, false])
  test(`real YouTube: the character does not flicker while watching or editing (autonomy ${autonomy ? 'on' : 'off'})`, async () => {
    test.skip(process.env.AROUND_LIVE_FLICKER !== '1', 'Explicit real YouTube check (AROUND_LIVE_FLICKER=1).');
    test.setTimeout(300000);
    await cursorFlicker(autonomy, false);
  });

test('real YouTube: the character at the player corner does not flicker while watching or editing', async () => {
  test.skip(process.env.AROUND_LIVE_FLICKER !== '1', 'Explicit real YouTube check (AROUND_LIVE_FLICKER=1).');
  test.setTimeout(300000);
  await cursorFlicker(true, true);
});

async function cursorFlicker(autonomy: boolean, playerCorner: boolean) {
  await mkdir(out, { recursive: true });
  const content = path.join(out, 'content');
  const { models } = writeContent(path.resolve('.'), content);
  const file = (name: string) => path.join(content, name);
  const design = JSON.parse(await readFile(file('design.json'), 'utf8'));
  // AROUND_FLICKER_VIDEO=1: a headed window kept off screen (scripts/test.mjs sets AROUND_TEST_WINDOW_OFFSCREEN=1),
  // recorded to .work/flicker-live/video for a person to watch.
  const video = process.env.AROUND_FLICKER_VIDEO === '1' && process.env.AROUND_TEST_WINDOW_OFFSCREEN === '1';
  const headed =
    video || (process.env.AROUND_FLICKER_HEADED === '1' && process.env.AROUND_TEST_WINDOW_OFFSCREEN === '1');
  const run = path.join(out, playerCorner ? 'player-corner' : autonomy ? 'on' : 'off');
  await mkdir(run, { recursive: true });
  const profile = await mkdtemp(path.resolve('.work/p-'));
  const context = await launchExtension(profile, false, {
    headed,
    width: 1280,
    height: 860,
    ...(video ? { videoDir: path.join(out, 'video') } : {}),
  });
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
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await showArtwork(popup);
    const { panel } = await openEditor(popup, page);
    const model =
      process.env.AROUND_FLICKER_PRIVATE === '1'
        ? process.env.AROUND_VRM_FILE
        : file(models.find((name) => name.endsWith('.vrm'))!);
    expect(model, 'Set AROUND_VRM_FILE for a private-model run').toBeTruthy();
    await panel.locator('.model-file').setInputFiles(model!);
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
    await panel.locator('.character-file').setInputFiles(models.filter((name) => name.endsWith('.vrma')).map(file));
    await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
    // Keep the import defaults for the reported case. The original sweep uses the player corner.
    const resident = design.decorations.find((layer: { id: string }) => layer.id === 'resident');
    const placeAtCorner = async (editor: typeof panel) => {
      await editor.getByLabel('配置の基準').selectOption('video-player');
      await editor.getByLabel('画像の幅').fill(String(resident.placement.widthPx));
      await editor.getByLabel('画像の高さ').fill(String(resident.placement.heightPx));
      await editor.getByLabel('画像のX位置').fill(String(resident.placement.x * 100));
      await editor.getByLabel('画像のY位置').fill(String(resident.placement.y * 100));
    };
    if (playerCorner) await placeAtCorner(panel);
    await panel.getByLabel('自律', { exact: true }).setChecked(autonomy);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    // Paused: the flicker comes from the guard and the pointer, and an automated player that plays
    // for a minute fails ("Something went wrong", its error screen then covers the character).
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')!.pause());
    await declinePromotion(page);
    await sampler(page);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(2000);
    // Watching.
    if (playerCorner) {
      await phase(page, 'watching');
      await sweep(page);
    } else await overCharacter(page, 'watching', run);
    // Editing: the editor connected (its own tab here), the page as wide as beside a side panel.
    await phase(page, 'opening-editor');
    const { panel: editing } = await openEditor(popup, page);
    // The layer the editor holds, and where it is anchored (it must be the saved one).
    report['editorAnchor'] = await editing
      .getByLabel('配置の基準')
      .inputValue()
      .catch(() => null);
    report['storedAnchor'] = await popup.evaluate(async () => {
      const design = (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'] as {
        decorations: { id: string; placement: { anchor: unknown } }[];
      };
      return design.decorations.map((d) => ({ id: d.id, anchor: d.placement.anchor }));
    });
    // The reopened editor restores its own earlier working copy (anchored to the viewport, as just
    // imported), not the saved artwork: placed again at the player's corner, as the person had it.
    if (playerCorner && report['editorAnchor'] !== 'video-player') await placeAtCorner(editing);
    await editing.getByLabel('自律', { exact: true }).setChecked(autonomy);
    await page.bringToFront();
    await page.setViewportSize({ width: 880, height: 800 });
    await page.waitForTimeout(2500);
    // What is on the page while editing (the hosts and the layers they hold), for the report.
    report['editingHosts'] = await page.evaluate(() =>
      [...document.querySelectorAll('[id^="around"]')].map((h) => ({
        id: h.id,
        parent: h.parentElement?.id || h.parentElement?.tagName,
        layers: [...(h.shadowRoot?.querySelectorAll('[data-image-id]') ?? [])].map((n) =>
          n.getAttribute('data-image-id'),
        ),
        hidden: document.hidden,
        editing: document.documentElement.getAttribute('data-around-editing'),
      })),
    );
    if (playerCorner) {
      await phase(page, 'editing');
      await sweep(page);
    } else await overCharacter(page, 'editing', run);
    await phase(page, 'end');
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            aroundFrames: Record<string, Row[]>;
          }
        ).aroundFrames,
    );
    for (const [name, rows] of Object.entries(frames)) report[name] = count(rows);
    report['ways'] = await page.evaluate(() => document.documentElement.dataset['aroundLayeringWays'] ?? null);
    report['unprovenControls'] = await page.evaluate(() => ({
      rows: document.documentElement.dataset.aroundBeneathRows,
      why: document.documentElement.dataset.aroundBeneathWhy,
      pending: document.getElementById('around-video-decorations')?.dataset.aroundBeneathUnsettled,
    }));
    await writeFile(path.join(run, 'frames.json'), JSON.stringify(frames));
    console.log('FLICKER ' + JSON.stringify(report));
    if (!playerCorner && !autonomy) {
      // A model that leaves hover to the player must still be draggable in the editor.
      const model = page.locator('.model-media');
      const box = (await model.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 32, y, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await model.boundingBox())!.x).toBeLessThan(box.x - 20);
    }
    for (const name of ['watching', 'editing']) {
      if (playerCorner) {
        const r = report[name] as ReturnType<typeof count>;
        expect(r.frames, name).toBeGreaterThan(100);
        // A record taken over YouTube's error screen is not a record of the character.
        expect(r.playerError, `${name}: frames over the player's error screen`).toBe(0);
        expect.soft(r.hides, `${name}: drawn → hidden`).toBe(0);
        expect.soft(r.switches, `${name}: changes of way`).toBe(0);
        continue;
      }
      for (const mode of cursorModes) {
        const scene = `${name}-${mode}`;
        const cursor = report[scene] as ReturnType<typeof count>;
        expect(cursor.pointerInside, `${scene}: pointer over the character`).toBeGreaterThan(5);
        if (mode === 'cross')
          expect(cursor.frames - cursor.pointerInside, `${scene}: pointer outside the character`).toBeGreaterThan(5);
        expect.soft(cursor.playerError, `${scene}: frames over the player's error screen`).toBe(0);
        expect.soft(cursor.stopped, `${scene}: stopped frames`).toBe(0);
        expect.soft(cursor.hides, `${scene}: drawn → hidden`).toBe(0);
        expect.soft(cursor.switches, `${scene}: changes of way`).toBe(0);
      }
    }
  } finally {
    await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 1));
    await context.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
