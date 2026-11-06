import { test, expect, type Page, type CDPSession, type BrowserContext } from '@playwright/test';
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

/** Calls per named extension function, from a precise coverage taken with callCount. */
const callCounts = (result: { url: string; functions: { functionName: string; ranges: { count: number }[] }[] }[]) => {
  const counts: Record<string, number> = {};
  for (const script of result.filter((s) => s.url.startsWith('chrome-extension://')))
    for (const fn of script.functions) {
      const calls = fn.ranges[0]?.count ?? 0;
      if (calls && fn.functionName) counts[fn.functionName] = (counts[fn.functionName] ?? 0) + calls;
    }
  return counts;
};

type Layer = { id: string; character?: unknown; model?: Record<string, unknown>; placement: object };
type Design = { decorations: Layer[] } & Record<string, unknown>;

/** The mannequin and the room picture, imported through the editor's real import (as in
 * tests/r32-live.spec.ts), on the watch page; returns what the measurements need. */
async function setUp(context: BrowserContext) {
  const content = path.join(out, 'content');
  const { models } = writeContent(path.resolve('.'), content);
  const design = JSON.parse(await readFile(path.join(content, 'design.json'), 'utf8')) as Design;
  const manifest = JSON.parse(await readFile(path.join(content, 'manifest.json'), 'utf8')) as {
    assets: Record<string, { file: string }>;
  };
  const file = (name: string) => path.join(content, name);
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
    (await session.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })).result
      .value;
  const perFrame = (raw: { frames: { time: number; ms: number }[] }) => {
    const frames = new Map<number, number>();
    for (const f of raw.frames) frames.set(f.time, (frames.get(f.time) ?? 0) + f.ms);
    const values = [...frames.values()];
    const total = values.reduce((a, b) => a + b, 0);
    return {
      median: quantile(values, 0.5),
      p95: quantile(values, 0.95),
      mean: total / Math.max(1, values.length),
      total,
      frames: values.length,
    };
  };
  const play = () =>
    // Not awaited: YouTube's play() promise can stay pending (an advert, a stall), which hung
    // the second round past the test's time limit twice.
    page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
      if (video) video.muted = true;
      void video?.play().catch(() => undefined);
    });
  return { design, popup, page, session, isolated, evaluate, perFrame, play };
}

// Over the picture (visible on YouTube; the player's top edge is not, docs/r3-plan.md R3-0).
const resident = (layer: Layer) => ({ ...layer, placement: { ...layer.placement, y: 0.42 } });

test('R3-2 short check: extension rAF CPU per frame, quiet / plain VRM / computed motion', async () => {
  test.skip(process.env.WW_PERF_R32 !== '1', 'Explicit short measurement on real YouTube (WW_PERF_R32=1).');
  test.setTimeout(1500000);
  await mkdir(out, { recursive: true });
  // WW_PERF_R32_HEADED=1: a real GPU, off the screen (as WW_PERF_SPA_HEADED below).
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-r32-perf-')), false, {
    extensionPath: process.env.WW_TEST_EXTENSION_PATH ?? '.work/g11-measurement-dist',
    ...(process.env.WW_PERF_R32_HEADED === '1' ? { headed: true, width: 1920, height: 1080 } : {}),
  });
  try {
    const { design, popup, page, session, isolated, evaluate, perFrame, play } = await setUp(context);
    const layers = design.decorations;
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
      // Chunk 4: at its own place, the player's bottom-right corner, where the bars come and go
      // (measured with WW_PERF_R32_WIGGLE=1 so they do; compare a WW_LAYERING=1 measurement build).
      corner: layers.map((layer) =>
        layer.id === 'resident' ? { ...layer, character: { ...(layer.character as object), autonomy: false } } : layer,
      ),
    };
    // WW_PERF_R32_VARIANTS=body,autonomy measures only those (the chunk 3 short check).
    const chosen = process.env.WW_PERF_R32_VARIANTS?.split(',').filter((v) => v in variants) ?? [
      'quiet',
      'vrm',
      'body',
    ];

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
        await play();
        // Past start-up: the steady state of each variant.
        await page.waitForTimeout(6000);
        const contextId = await isolated();
        await evaluate(contextId, '__g11Probe.begin(false)');
        // WW_PERF_R32_PROFILE=1: a CPU profile and each extension function's call count for the
        // window (.work/r32-perf/r32-<label>-<variant>-<round>.*). They add their own cost: such a
        // run tells where the time goes, not whether a change passes.
        const profiling = process.env.WW_PERF_R32_PROFILE === '1';
        if (profiling) {
          await session.send('Profiler.enable');
          await session.send('Profiler.setSamplingInterval', { interval: 200 });
          await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
          await session.send('Profiler.takePreciseCoverage');
          await session.send('Profiler.start');
        }
        if (process.env.WW_PERF_R32_WIGGLE === '1') {
          // The pointer crosses the picture and leaves every second: the bars fade in and out.
          const box = (await page.locator('#movie_player').boundingBox())!;
          for (let i = 0; i < 5; i++) {
            await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 3 });
            await page.waitForTimeout(500);
            await page.mouse.move(8, 8, { steps: 3 });
            await page.waitForTimeout(500);
          }
        } else await page.waitForTimeout(5000);
        if (profiling) {
          const name = `r32-${process.env.WW_PERF_R32_LABEL ?? 'run'}-${variant}-${round}`;
          const { profile } = await session.send('Profiler.stop');
          const { result } = await session.send('Profiler.takePreciseCoverage');
          await session.send('Profiler.stopPreciseCoverage');
          await writeFile(path.join(out, `${name}.cpuprofile`), JSON.stringify(profile));
          await writeFile(path.join(out, `${name}.counts.json`), JSON.stringify(callCounts(result)));
        }
        const { total: _total, ...stats } = perFrame(await evaluate(contextId, '__g11Probe.end()'));
        const row = { round, variant, ...stats };
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

/**
 * Chunk 3 follow-up (Codex's chunk3-verification: the search SPA after one character, p95 2.40 →
 * 4.30 ms): one character on the watch page, the cursor brought near it and away (so the autonomy
 * has something to answer), then a search through the masthead (an SPA move to the results), and
 * the 6 s after it measured with the frame probe and a CPU profile of the page's renderer.
 * One build per run (WW_TEST_EXTENSION_PATH); alternate the runs. WW_PERF_SPA_DESIGN=v14 stores the
 * character as v14 (no autonomy keys) for a build before chunk 3. Explicit: WW_PERF_SPA=1.
 * Output: .work/r32-perf/spa-<label>-<round>.{json,cpuprofile}, label from WW_PERF_SPA_LABEL.
 */
test('chunk 3 search SPA: extension CPU per frame and a CPU profile, after one character', async () => {
  test.skip(process.env.WW_PERF_SPA !== '1', 'Explicit short measurement on real YouTube (WW_PERF_SPA=1).');
  test.setTimeout(900000);
  await mkdir(out, { recursive: true });
  const label = process.env.WW_PERF_SPA_LABEL ?? 'run';
  // WW_PERF_SPA_HEADED=1: a real GPU (headless draws with SwiftShader on the CPU, which raises
  // both builds alike and hides the difference), in a window kept off the screen by
  // scripts/test.mjs (WW_TEST_WINDOW_OFFSCREEN), at Codex's 1920×1080.
  const headed = process.env.WW_PERF_SPA_HEADED === '1';
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-spa-perf-')), false, {
    extensionPath: process.env.WW_TEST_EXTENSION_PATH ?? '.work/g11-measurement-dist',
    ...(headed ? { headed: true, width: 1920, height: 1080 } : {}),
  });
  try {
    const { design, popup, page, session, isolated, evaluate, perFrame, play } = await setUp(context);
    const v14 = process.env.WW_PERF_SPA_DESIGN === 'v14';
    const decorations = design.decorations.map((layer) => {
      if (layer.id !== 'resident') return layer;
      // WW_PERF_SPA_AUTONOMY=0: the same v15 character with its autonomy off (to tell it apart).
      const autonomy = process.env.WW_PERF_SPA_AUTONOMY !== '0';
      if (!v14) return { ...resident(layer), character: { ...(layer.character as object), autonomy } };
      const {
        personality: _p,
        computedMotion: _c,
        autonomy: _a,
        behaviourMotions: _b,
        ...character
      } = layer.character as Record<string, unknown>;
      return { ...resident(layer), character };
    });
    await storeDesign(popup, {
      ...design,
      ...(v14 ? { schemaVersion: 14 } : {}),
      siteId: 'youtube',
      rules: [],
      decorations,
    });
    const rounds = Number(process.env.WW_PERF_SPA_ROUNDS ?? 2);
    const rows: Record<string, unknown>[] = [];
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    for (let round = 0; round < rounds; round++) {
      await declinePromotion(page);
      await expect(media(page)).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
      await play();
      await page.waitForTimeout(6000);
      // A rush from the left (tests/autonomy-live.spec.ts): with the autonomy the character flees;
      // the pointer then leaves and the search starts while it walks home (Codex's pairs searched
      // after an approach and a flight). Whether it fled is recorded, not assumed.
      const resident = page.locator('[data-image-id="resident"]').first();
      const home = (await resident.boundingBox())!;
      const at = { x: home.x + home.width / 2, y: home.y + home.height / 2 };
      await page.mouse.move(at.x - 700, at.y);
      await page.waitForTimeout(250);
      await page.mouse.move(at.x - 70, at.y, { steps: 4 });
      await page.waitForTimeout(500);
      const away = (await resident.boundingBox())!;
      const fled = Math.round(Math.hypot(away.x - home.x, away.y - home.y));
      await page.mouse.move(80, 860, { steps: 3 });
      const contextId = await isolated();
      await evaluate(contextId, '__g11Probe.begin(false)');
      // WW_PERF_SPA_COUNTS=1: how many times each extension function ran in the window (precise
      // coverage), to tell "called more often" from "heavier per call". Its own cost is high:
      // such a run's CPU numbers are not compared.
      const counting = process.env.WW_PERF_SPA_COUNTS === '1';
      if (counting) {
        await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
        await session.send('Profiler.takePreciseCoverage');
      }
      await session.send('Profiler.start');
      const query = page.locator('input[name="search_query"]').first();
      await query.fill(round % 2 ? 'piano' : 'lofi');
      await query.press('Enter');
      await page.waitForURL(/\/results\?/, { timeout: 20000 });
      if (counting) {
        // Calls from 1 s to 3 s after the move only (the player is hidden by then).
        await page.waitForTimeout(1000);
        await session.send('Profiler.takePreciseCoverage');
        await page.waitForTimeout(2000);
        const { result } = await session.send('Profiler.takePreciseCoverage');
        const counts: Record<string, number> = {};
        for (const script of result.filter((s) => s.url.startsWith('chrome-extension://')))
          for (const fn of script.functions) {
            const calls = fn.ranges[0]?.count ?? 0;
            if (calls && fn.functionName) counts[fn.functionName] = (counts[fn.functionName] ?? 0) + calls;
          }
        await writeFile(path.join(out, `spa-${label}-${round}.counts-1to3s.json`), JSON.stringify(counts));
      }
      // Where the character is after the move (WW_PERF_SPA_TRACK=1; the reads and the picture add
      // their own cost, so such a run's numbers are not compared).
      const track: unknown[] = [];
      if (process.env.WW_PERF_SPA_TRACK === '1')
        for (const at of [300, 1000, 2000, 3500]) {
          await page.waitForTimeout(at - (track.length ? [300, 1000, 2000, 3500][track.length - 1]! : 0));
          track.push({
            at,
            box: await resident.boundingBox(),
            player: await page.locator('#movie_player').boundingBox(),
          });
          if (at === 1000) await page.screenshot({ path: path.join(out, `spa-${label}-${round}.png`) });
        }
      await page.waitForTimeout(6000 - (track.length ? 3500 : 0));
      const { profile } = await session.send('Profiler.stop');
      if (counting) {
        const { result } = await session.send('Profiler.takePreciseCoverage');
        await session.send('Profiler.stopPreciseCoverage');
        const counts: Record<string, number> = {};
        for (const script of result.filter((s) => s.url.startsWith('chrome-extension://')))
          for (const fn of script.functions) {
            const calls = fn.ranges[0]?.count ?? 0;
            if (calls && fn.functionName) counts[fn.functionName] = (counts[fn.functionName] ?? 0) + calls;
          }
        await writeFile(path.join(out, `spa-${label}-${round}.counts.json`), JSON.stringify(counts));
      }
      const stats = perFrame(await evaluate(contextId, '__g11Probe.end()'));
      const row = { label, round, fled, ...stats, url: page.url(), ...(track.length ? { track } : {}) };
      rows.push(row);
      console.log('SPA perf ' + JSON.stringify(row));
      await writeFile(path.join(out, `spa-${label}-${round}.cpuprofile`), JSON.stringify(profile));
      // Back to the watch page through the SPA too (a reload repeated makes the player fail).
      await page.goBack();
      await page.waitForURL(/\/watch\?/, { timeout: 20000 });
      if (track.length) {
        // Back on the watch page: where it is (home, after startPage) and what the player shows.
        await page.waitForTimeout(1500);
        const player = await page.locator('#movie_player').boundingBox();
        console.log('SPA back ' + JSON.stringify({ home, box: await resident.boundingBox(), player }));
        if (player) await page.screenshot({ path: path.join(out, `spa-${label}-${round}-back.png`), clip: player });
      }
    }
    await writeFile(
      path.join(out, `spa-${label}.json`),
      JSON.stringify({ browser: context.browser()?.version(), headless: !headed, rows }, null, 2),
    );
  } finally {
    await context.close();
  }
});
