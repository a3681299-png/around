import { test, expect, type Page, type CDPSession } from '@playwright/test';
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
 * R3-2 short check (a hypothesis, not the pass/fail measurement, which Codex makes): the
 * extension's rAF CPU per frame on real YouTube for one character, in three states, alternated:
 *   quiet  — the room picture only
 *   vrm    — the mannequin as a plain VRM (redrawn every frame, no computed motion)
 *   body   — the same mannequin with its character: the R3-2 computed motion on top
 * The measurement build is scripts/g11/build.mjs (WW_TEST_EXTENSION_PATH). Explicit: WW_PERF_R32=1.
 */
const out = path.resolve('.work/r32-perf');
const media = (page: Page) =>
  page.locator(
    ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .model-media',
  );
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
};

test('R3-2 short check: extension rAF CPU per frame, quiet / plain VRM / computed motion', async () => {
  test.skip(process.env.WW_PERF_R32 !== '1', 'Explicit short measurement on real YouTube (WW_PERF_R32=1).');
  test.setTimeout(1500000);
  await mkdir(out, { recursive: true });
  const content = path.join(out, 'content');
  const { models } = writeContent(path.resolve('.'), content);
  const design = JSON.parse(await readFile(path.join(content, 'design.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(content, 'manifest.json'), 'utf8')) as {
    assets: Record<string, { file: string }>;
  };
  const file = (name: string) => path.join(content, name);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-r32-perf-')), false, {
    extensionPath: process.env.WW_TEST_EXTENSION_PATH ?? '.work/g11-measurement-dist',
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
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
    await declinePromotion(page);
    await showArtwork(popup);
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    // The assets go in through the editor's real import, as in tests/r32-live.spec.ts.
    const { panel } = await openEditor(popup, page);
    await panel.locator('.model-file').setInputFiles(file(models.find((name) => name.endsWith('.vrm'))!));
    await expect(panel.locator('.layer')).toHaveCount(1, { timeout: 30000 });
    await panel.locator('.character-file').setInputFiles(models.filter((name) => name.endsWith('.vrma')).map(file));
    await expect(panel.locator('.character-motions li')).toHaveCount(2, { timeout: 30000 });
    const room = Object.values(manifest.assets).find((asset) => asset.file.endsWith('.png'))!;
    await panel.locator('.file').first().setInputFiles(file(room.file));
    await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 30000 });
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    await closeEditorPages(page);

    type Layer = { id: string; character?: unknown; model?: Record<string, unknown>; placement: object };
    const layers = design.decorations as Layer[];
    // Over the picture (visible on YouTube; the player's top edge is not, docs/r3-plan.md R3-0).
    const resident = (layer: Layer) => ({ ...layer, placement: { ...layer.placement, y: 0.42 } });
    const variants: Record<string, Layer[]> = {
      quiet: layers.filter((layer) => layer.id !== 'resident'),
      vrm: layers.map((layer) => {
        if (layer.id !== 'resident') return layer;
        const { character: _drop, ...plain } = resident(layer);
        return { ...plain, model: { ...layer.model, clip: null } };
      }),
      // Chunk 3: the same character without and with its autonomy (v15 `autonomy`).
      body: layers.map((layer) =>
        layer.id === 'resident'
          ? { ...resident(layer), character: { ...(layer.character as object), autonomy: false } }
          : layer,
      ),
      autonomy: layers.map((layer) =>
        layer.id === 'resident'
          ? { ...resident(layer), character: { ...(layer.character as object), autonomy: true } }
          : layer,
      ),
    };
    // WW_PERF_R32_VARIANTS=body,autonomy measures only those (the chunk 3 short check).
    const chosen = process.env.WW_PERF_R32_VARIANTS?.split(',').filter((v) => v in variants) ?? [
      'quiet',
      'vrm',
      'body',
    ];

    const session: CDPSession = await context.newCDPSession(page);
    const contexts = new Set<number>();
    session.on('Runtime.executionContextCreated', ({ context: c }) => contexts.add(c.id));
    session.on('Runtime.executionContextsCleared', () => contexts.clear());
    await session.send('Runtime.enable');
    const isolated = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        for (const id of contexts) {
          try {
            const r = await session.send('Runtime.evaluate', {
              expression: 'Boolean(globalThis.__g11Probe?.begin)',
              contextId: id,
              returnByValue: true,
            });
            if (r.result.value === true) return id;
          } catch {}
        }
        await page.waitForTimeout(250);
      }
      throw new Error('No measurement probe: build with scripts/g11/build.mjs.');
    };
    const evaluate = async (contextId: number, expression: string) =>
      (await session.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }))
        .result.value;

    const rows: { round: number; variant: string; median: number; p95: number; mean: number; frames: number }[] = [];
    for (let round = 0; round < 2; round++) {
      const order = round % 2 ? [...chosen].reverse() : chosen;
      for (const variant of order) {
        // The page stays: the artwork changes in storage and the page follows it (no reload, which
        // repeated in a headless profile makes YouTube's player fail).
        await storeDesign(popup, { ...design, siteId: 'youtube', rules: [], decorations: variants[variant] });
        await declinePromotion(page);
        if (variant === 'quiet') await expect(media(page)).toHaveCount(0, { timeout: 30000 });
        else await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
        // Not awaited: YouTube's play() promise can stay pending (an advert, a stall), which hung
        // the second round past the test's time limit twice.
        await page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
          if (video) video.muted = true;
          void video?.play().catch(() => undefined);
        });
        // Past start-up: the steady state of each variant.
        await page.waitForTimeout(6000);
        const contextId = await isolated();
        await evaluate(contextId, '__g11Probe.begin(false)');
        await page.waitForTimeout(5000);
        const raw = (await evaluate(contextId, '__g11Probe.end()')) as { frames: { time: number; ms: number }[] };
        const perFrame = new Map<number, number>();
        for (const f of raw.frames) perFrame.set(f.time, (perFrame.get(f.time) ?? 0) + f.ms);
        const values = [...perFrame.values()];
        const row = {
          round,
          variant,
          median: quantile(values, 0.5),
          p95: quantile(values, 0.95),
          mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length),
          frames: values.length,
        };
        rows.push(row);
        console.log('R32 perf ' + JSON.stringify(row));
      }
    }
    await writeFile(
      path.join(out, 'result.json'),
      JSON.stringify({ browser: context.browser()?.version(), headless: true, rows }, null, 2),
    );
  } finally {
    await context.close();
  }
});
