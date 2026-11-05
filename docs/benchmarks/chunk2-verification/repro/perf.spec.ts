import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cpus, release, tmpdir } from 'node:os';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { showArtwork } from '../../tests/helpers/artwork';
import { declinePromotion, waitForAdvertToEnd } from '../../tests/helpers/youtube-live';
import { storeDesign } from '../../tests/helpers/skin-verification';
import { installFrameClock, frameWindow } from '../../scripts/ui1/frame-clock.mjs';
import { auditHost } from '../../scripts/ui1/host-audit.mjs';

const url = 'https://www.youtube.com/watch?v=LC1a-DwUhls';
const ms = 6000;
const root = path.resolve('.work/verify-evidence');
const buildPaths = {
  base: '../verify-chunk2-base/.work/perf',
  fix: '../verify-chunk2-fix/.work/perf',
  head: '.work/perf',
  g11: '.work/g11-measurement-dist',
};
type Build = keyof typeof buildPaths;
type Scene = 'quiet' | 'mannequin' | 'trusie';
type Phase = 'startup' | 'steady' | 'spa';
const profiles = path.join(tmpdir(), 'wwt-chunk2-verification-profiles');
const frame = { width: 1920, height: 1080 };

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: sorted.at(-1) ?? null,
    total: sorted.reduce((sum, v) => sum + v, 0),
  };
}

// Runs in the page's main world. These observations are outside extension CPU attribution.
function snapshot() {
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  const q = video?.getVideoPlaybackQuality();
  const model = [...document.querySelectorAll<HTMLElement>('[data-ww-model-stats]')]
    .map((node) => JSON.parse(node.dataset.wwModelStats!))
    .find((item) => item.instances > 0);
  return {
    t: performance.now(),
    visibility: document.visibilityState,
    ad: !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'),
    promotion: [
      ...document.querySelectorAll('ytd-popup-container tp-yt-paper-dialog, ytd-enforcement-message-view-model'),
    ].some((element) => element.getBoundingClientRect().width > 0),
    video: q && {
      total: q.totalVideoFrames,
      dropped: q.droppedVideoFrames,
      paused: video!.paused,
      time: video!.currentTime,
    },
    model: model && { gpuMs: model.gpuMs, backend: model.backend, paints: model.paints, instances: model.instances },
  };
}

async function openRun(build: Build, headed = true) {
  const context = await launchExtension(await mkdtemp(path.join(profiles, 'run-')), false, {
    headed,
    width: 1920,
    height: 1241,
    extensionPath: path.resolve(buildPaths[build]),
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(35_000);
  return context;
}

async function connect(context: BrowserContext) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20_000 }));
  const popup = await context.newPage();
  await popup.goto(new URL('/popup/index.html', worker.url()).href);
  await showArtwork(popup);
  const page = await context.newPage();
  await page.setViewportSize(frame);
  const cdp = await context.newCDPSession(page);
  const worlds = new Set<number>();
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.auxData?.type === 'isolated' && context.auxData?.isDefault === false) worlds.add(context.id);
  });
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  await cdp.send('Runtime.enable');
  async function probe(condition: string, expression: string) {
    for (let n = 0; n < 80; n++) {
      for (const contextId of worlds) {
        const response = await cdp
          .send('Runtime.evaluate', {
            expression: `(${condition}) ? (${expression}) : undefined`,
            contextId,
            returnByValue: true,
          })
          .catch(() => undefined);
        if (response?.exceptionDetails) throw Error(response.exceptionDetails.text);
        if (response?.result.value !== undefined) return response.result.value;
      }
      await page.waitForTimeout(75);
    }
    throw Error('Extension isolated-world probe is missing');
  }
  return { page, popup, cdp, probe };
}

async function ready(page: Page) {
  await expect(page.locator('#movie_player')).toBeVisible({ timeout: 35_000 });
  await declinePromotion(page);
  await waitForAdvertToEnd(page, 35_000);
  await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
}

async function play(page: Page) {
  await page.locator('video.html5-main-video').evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    if (v.paused) void v.play().catch(() => undefined);
  });
}

async function importPicture(popup: Page, page: Page) {
  await page.bringToFront();
  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        try {
          return (await chrome.tabs.sendMessage(tab.id!, { type: 'web-world-themes:probe-editor-target' }))?.siteId;
        } catch {
          return null;
        }
      }),
    )
    .toBe('youtube');
  const { panel } = await openEditor(popup, page);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(panel.locator('.layer')).toHaveCount(1);
  await panel.locator('[data-image-prop="anchor"]').selectOption('video-player');
  await panel.locator('[data-image-prop="x"]').fill('25');
  await panel.locator('[data-image-prop="y"]').fill('35');
  await panel.locator('[data-image-prop="y"]').press('Tab');
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await closeEditorPages(page);
  return readDesign(popup);
}

async function readDesign(popup: Page) {
  return popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
}

async function importModel(popup: Page, page: Page, scene: Exclude<Scene, 'quiet'>, quiet: any) {
  await storeDesign(popup, quiet);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  const { panel } = await openEditor(popup, page);
  const publicDir = path.resolve('.work/playground/content');
  const publicManifest = JSON.parse(await readFile(path.join(publicDir, 'manifest.json'), 'utf8'));
  const publicFile = (name: string) =>
    path.join(publicDir, (Object.values(publicManifest.assets) as any[]).find((a) => a.name === name).file);
  const vrm = scene === 'mannequin' ? publicFile('WW mannequin.vrm') : process.env.WW_VRM_FILE;
  const idle = scene === 'mannequin' ? publicFile('stand.vrma') : path.join(process.env.WW_VRMA_DIR!, 'idle.vrma');
  if (!vrm) throw Error('WW_VRM_FILE is required for Trusie');
  await panel.locator('.model-file').setInputFiles(vrm);
  await expect(panel.locator('.layer')).toHaveCount(2, { timeout: 45_000 });
  await panel.locator('.character-file').setInputFiles(idle);
  await expect(panel.locator('.character-motions li')).toHaveCount(1, { timeout: 45_000 });
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const saved = await readDesign(popup);
  await closeEditorPages(page);
  const model = saved.decorations.find((layer: any) => layer.kind === 'model3d');
  expect(model.character.motions).toHaveLength(1);
  // Use the same stand/idle placement and stable seed in both versions, independent of editor defaults.
  const resident = {
    ...model,
    id: 'resident',
    character: {
      ...model.character,
      standardMotions: 'auto',
      motions: [{ ...model.character.motions[0], role: 'idle', origin: 'character' }],
    },
    model: { ...model.model, clip: 0, playing: true, loop: true },
    placement: {
      ...model.placement,
      anchor: { kind: 'surface', target: 'video-player' },
      x: 0.75,
      y: 0.45,
      widthPx: 210,
      heightPx: 280,
    },
  };
  await storeDesign(popup, { ...quiet, decorations: [...quiet.decorations, resident] });
  return {
    duration: resident.character.motions[0].source.duration,
    modelBytes: (await import('node:fs/promises')).stat(vrm).then((s) => s.size),
  };
}

function summarize(
  raw: any,
  clock: any,
  start: number,
  end: number,
  snapshots: ReturnType<typeof snapshot>[],
  initial?: ReturnType<typeof snapshot>,
) {
  const boundaries = frameWindow(start, end, clock.frames);
  const frames = Array<number>(boundaries.length - 1).fill(0);
  const durations: number[] = [],
    calls: number[] = [];
  for (let i = 0; i < raw.calls.length; i += 2) {
    const t = raw.calls[i],
      duration = raw.calls[i + 1];
    if (t < start || t >= end) continue;
    let left = 0,
      right = frames.length;
    while (right - left > 1) {
      const middle = (left + right) >> 1;
      if (boundaries[middle] <= t) left = middle;
      else right = middle;
    }
    const bounded = Math.min(duration, end - t);
    frames[left] += bounded;
    durations.push(bounded);
    calls.push(t, bounded);
  }
  const gpu = snapshots.flatMap((s) => (typeof s.model?.gpuMs === 'number' ? [s.model.gpuMs] : []));
  const video = snapshots.at(-1)?.video;
  const reset = !video || (initial?.video && (video.total < initial.video.total || video.time < initial.video.time));
  return {
    cpu: stats(frames),
    clock: { start, end, origin: clock.timeOrigin, actualRafFrames: boundaries.length - 2 },
    call: {
      ...stats(durations),
      atLeast2: durations.filter((d) => d >= 2).length,
      atLeast5: durations.filter((d) => d >= 5).length,
      atLeast10: durations.filter((d) => d >= 10).length,
      atLeast16: durations.filter((d) => d >= 16).length,
    },
    gpu: stats(gpu),
    modelSamples: snapshots.filter((s) => s.model?.instances === 1).length,
    backend: snapshots.find((s) => s.model?.backend)?.model.backend,
    video: reset
      ? null
      : { total: video.total - (initial?.video?.total ?? 0), dropped: video.dropped - (initial?.video?.dropped ?? 0) },
    ad: snapshots.filter((s) => s.ad).length,
    promo: snapshots.filter((s) => s.promotion).length,
    hidden: snapshots.filter((s) => s.visibility !== 'visible').length,
    kinds: raw.kinds,
    raw: { frames, calls, boundaries, gpu },
  };
}

async function arm(stage: string, pair: number, side: string, build: Build) {
  const label = `${stage}-${pair}-${side}`;
  const bodyStage = stage.startsWith('B-');
  const result: any = {
    stage,
    pair,
    side,
    build,
    started: new Date().toISOString(),
    blocks: {},
    attempts: {},
    valid: false,
  };
  const save = () => writeFile(path.join(root, `${label}.json`), JSON.stringify(result));
  console.log('ARM', label);
  const context = await openRun(build);
  const watchdog = setTimeout(() => void context.close().catch(() => undefined), bodyStage ? 245_000 : 120_000);
  try {
    const { page, popup, probe, cdp } = await connect(context);
    await installFrameClock(page);
    await page.addInitScript({
      content: `globalThis.__chunk2Samples=[];const state=${snapshot.toString()};setInterval(()=>__chunk2Samples.push(state()),150);`,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready(page);
    result.browser = context.browser()?.version();
    result.viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    expect(result.viewport).toEqual([1920, 1080, 1]);
    const quiet = await importPicture(popup, page);
    const audit = await auditHost();
    result.background = audit?.BackgroundPercent;
    const ui = (expression: string) => probe('globalThis.__ui1Probe?.installed', expression);

    async function measure(scene: Scene, phase: Phase) {
      const startup = phase === 'startup';
      if (startup) await page.goto('about:blank');
      const profiling = process.env.CHUNK2_PROFILE === '1' && startup;
      if (profiling) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      const search = page.getByRole('combobox', { name: /Search|検索/ });
      if (phase === 'spa') await search.fill('lofi hip hop');
      let initial: ReturnType<typeof snapshot> | undefined;
      let start = 0;
      let initialOrigin: number | undefined;
      if (startup) await page.goto(url, { waitUntil: 'commit' });
      else {
        initial = await page.evaluate(snapshot);
        const clocks = await ui('(__ui1Probe.begin(), {start:__ui1Probe.start, origin:performance.timeOrigin})');
        start = clocks.start;
        initialOrigin = clocks.origin;
        if (phase === 'spa') await search.press('Enter');
      }
      const end = start + ms;
      await page.waitForFunction((end) => !!(globalThis as any).__ui1FrameClock && performance.now() >= end, end, {
        timeout: 15_000,
      });
      const capture = await ui('({raw:__ui1Probe.end(),origin:performance.timeOrigin})');
      const pageSample = await page.evaluate(() => ({
        clock: (globalThis as any).__ui1FrameClock,
        snapshots: (globalThis as any).__chunk2Samples,
      }));
      if (profiling) {
        const { profile } = await cdp.send('Profiler.stop');
        // Only extension-script frames, no browsing URLs from the page profile.
        const own = new Set(
          profile.nodes.filter((node) => node.callFrame.url.startsWith('chrome-extension:')).map((node) => node.id),
        );
        const rows = new Map<string, number>();
        const names = new Map(
          profile.nodes
            .filter((node) => own.has(node.id))
            .map((node) => [node.id, node.callFrame.functionName || '(anonymous)']),
        );
        profile.samples?.forEach((id, i) => {
          const name = names.get(id);
          if (name) rows.set(name, (rows.get(name) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000);
        });
        result.profile = [...rows].sort((a, b) => b[1] - a[1]);
        await cdp.send('Profiler.disable');
      }
      if (capture.origin !== pageSample.clock.timeOrigin)
        throw Error('The frame clock and extension clock are from different documents');
      if (phase === 'spa') {
        await expect(page).toHaveURL(/results\?search_query=/);
        if (initialOrigin !== capture.origin) throw Error('Search did not stay in the same document');
      }
      const snapshots = pageSample.snapshots.filter((s: ReturnType<typeof snapshot>) => s.t >= start && s.t <= end);
      const block = summarize(capture.raw, pageSample.clock, start, end, snapshots, initial);
      const realGpu = !!block.backend && !/swiftshader|llvmpipe|basic render driver/i.test(block.backend);
      const valid =
        snapshots.length >= 20 &&
        block.clock.actualRafFrames >= 120 &&
        !block.ad &&
        !block.promo &&
        !block.hidden &&
        (phase === 'spa' || (block.video?.total ?? 0) > 0) &&
        (scene === 'quiet' || phase === 'spa' || (realGpu && block.modelSamples >= (phase === 'steady' ? 20 : 1)));
      const key = `${scene}:${phase}`;
      (result.attempts[key] ??= []).push({ ...block, valid });
      result.blocks[key] = { ...block, valid };
      await save();
      console.log(
        'BLOCK',
        label,
        key,
        JSON.stringify({
          valid,
          cpu: block.cpu,
          call: block.call,
          ad: block.ad,
          promo: block.promo,
          hidden: block.hidden,
          video: block.video,
          backend: block.backend,
        }),
      );
      return valid;
    }

    const scenes: Scene[] = bodyStage ? [stage.slice(2) as Scene] : ['quiet'];
    for (const scene of scenes) {
      if (scene !== 'quiet') {
        const model = await importModel(popup, page, scene, quiet);
        (result.models ??= {})[scene] = { duration: model.duration, bytes: await model.modelBytes };
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await measure(scene, 'startup')) break;
        await ready(page);
      }
      if (!bodyStage) continue;
      await ready(page);
      await play(page);
      await page.mouse.move(10, 10);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      if (scene !== 'quiet')
        await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 45_000 });
      await page.waitForTimeout(8000);
      if (scene !== 'quiet') {
        const selected = await page.locator('.model-media').evaluate((node: HTMLElement) => {
          const sample = JSON.parse(node.dataset.modelFrame!);
          return {
            clip: sample.clip,
            timeMs: sample.timeMs,
            playback: node.dataset.playback,
            posePresent: Boolean(sample.pose),
          };
        });
        expect(selected.clip).toBe(0);
        expect(selected.playback).toBe('playing');
        if (scene === 'trusie') expect(selected.timeMs).toBeGreaterThan(0);
        result.models[scene].selected = selected;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await measure(scene, 'steady')) break;
        await ready(page);
        await play(page);
        await page.waitForTimeout(8000);
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await measure(scene, 'spa')) break;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await ready(page);
        await play(page);
        if (scene !== 'quiet')
          await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 45_000 });
        await page.waitForTimeout(8000);
      }
    }
    result.valid =
      Object.keys(result.blocks).length === (bodyStage ? 3 : 1) &&
      Object.values(result.blocks).every((block: any) => block.valid);
    if (stage === 'B-quiet') {
      try {
        await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 35_000 });
        await declinePromotion(page);
        await waitForAdvertToEnd(page, 35_000);
        await play(page);
        await page.waitForTimeout(8000);
        const a = await page.evaluate(snapshot);
        await page.waitForTimeout(ms);
        const b = await page.evaluate(snapshot);
        result.artworkOff =
          a.video && b.video && b.video.total > a.video.total && !a.ad && !b.ad
            ? { total: b.video.total - a.video.total, dropped: b.video.dropped - a.video.dropped }
            : null;
      } catch (error) {
        result.artworkOffError = String(error);
      }
    }
  } catch (error) {
    result.error = String(error);
    console.log('INVALID', label, result.error);
  } finally {
    clearTimeout(watchdog);
    await context.close().catch(() => undefined);
    result.finished = new Date().toISOString();
    await save();
  }
  return result;
}

test('alternating startup noise, fix, or body motion performance on real YouTube', async () => {
  const stage = process.env.CHUNK2_STAGE ?? '';
  test.skip(!['AA', 'AB', 'B-quiet', 'B-mannequin', 'B-trusie', 'A-profile'].includes(stage));
  const target = stage === 'A-profile' ? 2 : stage.startsWith('B-') ? 4 : 8;
  await mkdir(root, { recursive: true });
  await mkdir(profiles, { recursive: true });
  const files = (await readdir(root)).filter((name) => new RegExp(`^${stage}-\\d+-(left|right)\\.json$`).test(name));
  const arms = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
  const last = Math.max(0, ...arms.map((run) => run.pair));
  const good = () =>
    [...new Set(arms.filter((run) => run.valid).map((run) => run.pair))].filter(
      (pair) => arms.filter((run) => run.pair === pair && run.valid).length === 2,
    );
  const sides =
    stage === 'AA'
      ? { left: 'base', right: 'base' }
      : stage === 'AB' || stage === 'A-profile'
        ? { left: 'base', right: 'fix' }
        : { left: 'fix', right: 'head' };
  for (
    let pair = last + 1;
    pair <= (process.env.CHUNK2_PROFILE === '1' ? 2 : target + 6) && good().length < target;
    pair++
  ) {
    for (const side of pair % 2 ? (['left', 'right'] as const) : (['right', 'left'] as const)) {
      arms.push(await arm(stage, pair, side, sides[side] as Build));
    }
    await writeFile(
      path.join(root, `${stage}-index.json`),
      JSON.stringify(
        {
          url,
          os: release(),
          cpu: cpus()[0].model,
          good: good(),
          arms: arms.map(({ pair, side, valid, error }) => ({ pair, side, valid, error })),
        },
        null,
        2,
      ),
    );
  }
  if (process.env.CHUNK2_PROFILE !== '1') expect(good()).toHaveLength(target);
});

test('g11 official probe resolves the 2 ms isolated-world rAF calibration', async () => {
  test.skip(process.env.CHUNK2_STAGE !== 'calibrate');
  await mkdir(root, { recursive: true });
  await mkdir(profiles, { recursive: true });
  const context = await openRun('g11');
  try {
    const { page, probe } = await connect(context);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await play(page);
    await page.waitForTimeout(8000);
    const g11 = (expression: string) =>
      probe('globalThis.__g11Probe?.hooks === 1 && typeof globalThis.__g11Probe?.refresh === "function"', expression);
    const rows = [];
    for (const load of [0, 2, 2, 0]) {
      await g11(`(() => {
        const samples = globalThis.__g11Probe;
        samples.begin(false);
        const run = () => { const start=performance.now(); while (performance.now()-start<${load}) {} if(samples.recording) requestAnimationFrame(run); };
        requestAnimationFrame(run);
        return true;
      })()`);
      await page.waitForTimeout(2500);
      const raw = await g11('__g11Probe.end()');
      const perFrame = new Map<number, number>();
      for (const { time, ms } of raw.frames) perFrame.set(time, (perFrame.get(time) ?? 0) + ms);
      rows.push({ load, ...stats([...perFrame.values()]) });
      await page.waitForTimeout(200);
    }
    const delta = (key: 'median' | 'p95') => (rows[1][key]! + rows[2][key]! - rows[0][key]! - rows[3][key]!) / 2;
    await writeFile(
      path.join(root, 'g11-calibration.json'),
      JSON.stringify({ rows, medianDelta: delta('median'), p95Delta: delta('p95') }, null, 2),
    );
    expect(delta('median')).toBeGreaterThan(1.7);
    expect(delta('median')).toBeLessThan(2.4);
    expect(delta('p95')).toBeGreaterThan(1.7);
    expect(delta('p95')).toBeLessThan(2.6);
  } finally {
    await context.close();
  }
});

test('ui1 full callback attribution detects 2 ms after an await', async () => {
  test.skip(process.env.CHUNK2_STAGE !== 'calibrate');
  await mkdir(root, { recursive: true });
  await mkdir(profiles, { recursive: true });
  const context = await openRun('base');
  try {
    const { page, probe } = await connect(context);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await play(page);
    await page.waitForTimeout(8000);
    const ui = (expression: string) => probe('globalThis.__ui1Probe?.installed', expression);
    const rows = [];
    for (const load of [0, 2, 2, 0]) {
      await ui(`(() => {
        const p = globalThis.__ui1Probe;
        p.begin();
        const run = () => Promise.resolve().then(() => {
          const start=performance.now(); while (performance.now()-start<${load}) {}
          if(p.recording) requestAnimationFrame(run);
        });
        requestAnimationFrame(run);
        return true;
      })()`);
      await page.waitForTimeout(2500);
      const raw = await ui('__ui1Probe.end()');
      rows.push({
        load,
        ...summarize(raw, { frames: raw.frames.slice(1, -1) }, raw.frames[0], raw.frames.at(-1), []).cpu,
      });
      await page.waitForTimeout(200);
    }
    const delta = (key: 'median' | 'p95') => (rows[1][key]! + rows[2][key]! - rows[0][key]! - rows[3][key]!) / 2;
    await writeFile(
      path.join(root, 'ui1-calibration.json'),
      JSON.stringify({ rows, medianDelta: delta('median'), p95Delta: delta('p95') }, null, 2),
    );
    expect(delta('median')).toBeGreaterThan(1.7);
    expect(delta('median')).toBeLessThan(2.4);
    expect(delta('p95')).toBeGreaterThan(1.7);
    expect(delta('p95')).toBeLessThan(2.6);
  } finally {
    await context.close();
  }
});
