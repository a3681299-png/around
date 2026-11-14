// Real YouTube. Existing isolated-world CPU probe + document-start frame clock. No source edits.
import { test, expect, type Page } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor, closeEditorPages } from '../../tests/helpers/editor';
import { waitForAdvertToEnd } from '../../tests/helpers/youtube-live';
import { installFrameClock, sampleFrameClock } from '../../scripts/ui1/frame-clock.mjs';
import { auditHost } from '../../scripts/ui1/host-audit.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, platform, release, cpus } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const URL_ = 'https://www.youtube.com/watch?v=LC1a-DwUhls',
  DURATION = 6000;
const work = path.resolve(process.env.R31_PERF_WORK ?? '.work/r31-fix-evidence/performance');
const relativeWork = path.relative(path.resolve('.work'), work);
if (!relativeWork || relativeWork.startsWith('..') || path.isAbsolute(relativeWork))
  throw Error('Measurement output must remain inside .work');
function stats(values: number[]) {
  const a = [...values].sort((x, y) => x - y),
    n = a.length;
  return {
    count: n,
    median: n ? (a[Math.floor((n - 1) / 2)] + a[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? a[Math.ceil(n * 0.95) - 1] : null,
    max: a.at(-1) ?? null,
  };
}
function frameCpu(sample: any) {
  const sums = Array(sample.frames.length - 1).fill(0);
  let total = 0;
  for (let n = 0; n < sample.calls.length; n += 2) {
    const t = sample.calls[n],
      v = sample.calls[n + 1];
    total += v;
    let lo = 0,
      hi = sums.length - 1,
      i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sample.frames[mid] <= t) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (i >= 0 && t < sample.frames.at(-1)) sums[i] += v;
  }
  const accounted = sums.reduce((a, b) => a + b, 0);
  expect(Math.abs(accounted - total)).toBeLessThan(0.001);
  return { values: sums, total, accounted };
}
function traceFrameTimes(events: any[]) {
  const counts = new Map<string, number>();
  for (const e of events)
    if (e.name === 'FireAnimationFrame') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0],
    open = new Map(),
    durations = [];
  for (const e of events.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts)) {
    if (e.name !== 'AnimationFrame') continue;
    if (e.ph === 's') open.set(e.id, e.ts);
    if (e.ph === 'f' && open.has(e.id)) {
      durations.push((e.ts - open.get(e.id)) / 1000);
      open.delete(e.id);
    }
  }
  return durations;
}
function browserState() {
  const v = document.querySelector('video'),
    q = v?.getVideoPlaybackQuality(),
    roots = [...document.querySelectorAll<HTMLElement>('[data-around-model-stats]')];
  // Statistics stay on the main host; player/page planes own separate open shadow roots.
  const planes = [
    ...document.querySelectorAll('#around-decorations,#around-video-decorations,#around-page-decorations'),
  ];
  const media = planes.flatMap((root) => [
    ...(root.shadowRoot ?? root).querySelectorAll<HTMLElement>('.model-media'),
  ])[0];
  const all = roots
    .map((e) => {
      try {
        return JSON.parse(e.dataset.aroundModelStats!);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const ad = document.querySelector('.ad-showing');
  return {
    video: q
      ? {
          total: q.totalVideoFrames,
          dropped: q.droppedVideoFrames,
          paused: v!.paused,
          time: v!.currentTime,
          ready: v!.readyState,
        }
      : null,
    model: all.find((s) => s.instances > 0) ?? all[0] ?? null,
    media: media
      ? {
          playback: media.dataset.playback,
          frame: media.dataset.modelFrame ? JSON.parse(media.dataset.modelFrame) : null,
        }
      : null,
    hidden: document.hidden,
    ad: Boolean(ad && ad.getBoundingClientRect().width > 0),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  };
}
async function state(page: Page) {
  return page.evaluate(browserState);
}
async function oneRun(label: string, extensionPath: string, pair: number, calibration = false) {
  const idLabel = `${calibration ? 'calibration' : 'pair-' + pair}-${label}`,
    result: any = { label, pair, extensionPath, phases: {}, attempts: {}, started: new Date().toISOString() };
  result.hostBefore = await auditHost();
  result.hostAttempts = [result.hostBefore];
  // User decision during this repair: ordinary browser background load is reference data,
  // not a 5% rejection gate. Ad/visibility/window/GPU checks are unchanged.
  console.log('R31_PERF_START', idLabel);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-r31-perf-')), false, {
    headed: true,
    width: 1920,
    height: 1241,
    extensionPath,
  });
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate((e: any) => e.data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await popup.getByRole('switch', { name: '作品を表示する' }).check();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await installFrameClock(page);
    // Sample in-page, rather than adding 24 CDP round trips to the six-second interval.
    await page.addInitScript({
      content: `globalThis.__r31Snapshots=[];const read=${browserState.toString()};setInterval(()=>globalThis.__r31Snapshots.push(read()),250);`,
    });
    const cdp = await context.newCDPSession(page),
      contexts = new Set<number>();
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
      if (c.auxData?.type === 'isolated') contexts.add(c.id);
    });
    cdp.on('Runtime.executionContextDestroyed', ({ executionContextId: id }) => contexts.delete(id));
    cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
    await cdp.send('Runtime.enable');
    async function probe(expression: string) {
      for (let n = 0; n < 100; n++) {
        for (const contextId of contexts) {
          try {
            const r = await cdp.send('Runtime.evaluate', {
              expression: `globalThis.__ui1Probe?.installed ? (${expression}) : undefined`,
              contextId,
              returnByValue: true,
            });
            if (r.result.value !== undefined) return r.result.value;
          } catch {}
        }
        await page.waitForTimeout(50);
      }
      throw Error('Isolated-world CPU probe absent');
    }
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
    // Windows clamps the native off-screen window to its work area. Fix the render viewport
    // before navigation (same on both builds), and verify the actual WebGL backend below.
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({
      width: 1920,
      height: 1080,
      dpr: 1,
    });
    await waitForAdvertToEnd(page);
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
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
    await page.bringToFront();
    async function measure(scene: string, phase: string, action?: () => Promise<void>, startup = false, attempt = 0) {
      const events: any[] = [];
      const onTrace = ({ value }: any) => events.push(...value);
      cdp.on('Tracing.dataCollected', onTrace);
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
        transferMode: 'ReportEvents',
      });
      const start = startup ? null : await state(page);
      if (!startup) {
        await page.evaluate(() => ((globalThis as any).__r31Snapshots = []));
        await probe('(__ui1Probe.begin(),true)');
      }
      const deadline = Date.now() + DURATION;
      if (action) await action();
      const committedClock = startup
        ? await page.evaluate(() => ({
            href: location.href,
            timeOrigin: performance.timeOrigin,
            now: performance.now(),
          }))
        : null;
      if (startup) {
        // Confirm the destination clock: a one-shot delay calculated across navigation can
        // shorten the capture if the document changes between evaluation and waiting.
        await page.waitForFunction((target) => location.href.startsWith(target) && performance.now() >= 6000, URL_, {
          polling: 'raf',
          timeout: 15000,
        });
      } else await page.waitForTimeout(Math.max(0, deadline - Date.now()));
      const snapshots: any[] = await page.evaluate(() => (globalThis as any).__r31Snapshots);
      const raw = await probe('__ui1Probe.end()'),
        origin = await probe('performance.timeOrigin'),
        sample = await sampleFrameClock(page, raw, origin, startup);
      const done = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
      await cdp.send('Tracing.end');
      await done;
      cdp.off('Tracing.dataCollected', onTrace);
      const finish = snapshots.at(-1),
        cpu = frameCpu(sample),
        gpu = snapshots.map((s) => s.model?.gpuMs).filter((v) => typeof v === 'number'),
        full = traceFrameTimes(events),
        traceFile = `${idLabel}-${scene}-${phase}-${attempt}.trace.json.gz`,
        packed = gzipSync(JSON.stringify({ traceEvents: events }));
      await writeFile(path.join(work, traceFile), packed);
      const reset = Boolean(start?.video && finish.video && finish.video.total < start.video.total),
        base = reset ? null : start?.video;
      const q = finish.video
        ? {
            total: finish.video.total - (base?.total ?? 0),
            dropped: finish.video.dropped - (base?.dropped ?? 0),
            counterReset: reset,
          }
        : null;
      const block = {
        cpu: stats(cpu.values),
        gpu: stats(gpu),
        video: q,
        frame: stats(full),
        clock: sample.clock,
        committedClock,
        kinds: sample.kinds,
        raw: { cpuPerFrame: cpu.values, calls: sample.calls, frames: sample.frames, fullFrameMs: full, gpuMs: gpu },
        cpuMs: cpu.total,
        accountedCpuMs: cpu.accounted,
        start,
        finish,
        hiddenSamples: snapshots.filter((s) => s.hidden).length,
        adSamples: snapshots.filter((s) => s.ad).length,
        modelSamples: snapshots.filter((s) => s.media && ['playing', 'paused'].includes(s.media.playback)).length,
        trace: { file: traceFile, sha256: createHash('sha256').update(packed).digest('hex') },
      };
      (result.attempts[`${scene}:${phase}`] ??= []).push(block);
      result.phases[`${scene}:${phase}`] = block;
      await writeFile(path.join(work, idLabel + '.json'), JSON.stringify(result, null, 2));
      console.log(
        'R31_PERF_BLOCK',
        idLabel,
        scene,
        phase,
        attempt,
        JSON.stringify({ cpu: block.cpu, gpu: block.gpu, video: q, hidden: block.hiddenSamples, ad: block.adSamples }),
      );
      (block as any).valid =
        !block.hiddenSamples &&
        !block.adSamples &&
        block.cpu.count > 120 &&
        sample.clock.end - sample.clock.start >= 5800 &&
        sample.clock.end - sample.clock.start <= 6500;
      if (scene === 'character' && phase === 'steady')
        (block as any).valid &&=
          block.modelSamples > 20 && !/SwiftShader|llvmpipe/i.test(finish.model?.backend ?? 'SwiftShader');
      return block;
    }
    async function ensurePlaying() {
      await page
        .locator('video')
        .first()
        .evaluate(async (v: HTMLVideoElement) => {
          v.muted = true;
          if (v.paused) await v.play();
        });
      await page.mouse.move(10, 10);
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    }
    for (const scene of calibration ? ['no-character'] : ['no-character', 'character']) {
      if (scene === 'character') {
        await page.goto(URL_, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
        await waitForAdvertToEnd(page);
        await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
        const editor = await openEditor(popup, page);
        await editor.panel
          .locator('.model-file')
          .setInputFiles(process.env.AROUND_VRM_FILE ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/trusie.vrm');
        await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
        await editor.panel.locator('[data-image-prop="widthPx"]').fill('210');
        await editor.panel.locator('[data-image-prop="heightPx"]').fill('280');
        await editor.panel.locator('[data-image-prop="anchor"]').selectOption('video-player');
        await editor.panel.locator('[data-image-prop="x"]').fill('75');
        await editor.panel.locator('[data-image-prop="y"]').fill('45');
        await editor.panel.locator('[data-image-prop="y"]').press('Tab');
        if (label === 'after') {
          await editor.panel
            .locator('.character-file')
            .setInputFiles(
              path.join(
                process.env.AROUND_VRMA_DIR ?? 'C:/Users/sm787/Desktop/ローポリモデル用/out/anim',
                'trusie',
                'idle.vrma',
              ),
            );
          await expect(editor.panel.locator('.character-motions li')).toHaveCount(1, { timeout: 60000 });
        }
        await editor.panel.locator('.save').click();
        await expect(editor.panel.locator('.dirty')).toHaveText('保存済み');
        result.character = await popup.evaluate(async () => {
          const d = (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'];
          const m = d.decorations.find((l: any) => l.kind === 'model3d');
          return {
            embeddedClips: m.source.clips,
            placement: m.placement,
            motions: m.character?.motions?.map((v: any) => ({
              id: v.id,
              role: v.role,
              duration: v.source.duration,
              origin: v.origin,
            })),
          };
        });
        await closeEditorPages(page);
        await page.bringToFront();
      }
      if (!calibration)
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await waitForAdvertToEnd(page);
          await page.goto('about:blank');
          const block = await measure(
            scene,
            'startup',
            async () => {
              await page.goto(URL_, { waitUntil: 'commit' });
            },
            true,
            attempt,
          );
          if ((block as any).valid) break;
        }
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 45000 });
      await waitForAdvertToEnd(page);
      await ensurePlaying();
      await page.waitForTimeout(8000);
      if (scene === 'character') {
        await expect(page.locator('.model-media')).toHaveAttribute('data-renderer', 'three');
        const pixels = await page.locator('.model-media canvas').evaluate((c: HTMLCanvasElement) => {
          const a = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          return a.filter((v, n) => n % 4 === 3 && v > 0).length;
        });
        expect(pixels).toBeGreaterThan(100);
        result.paintedPixels = pixels;
        if (pair === 1) {
          await mkdir(path.join(work, 'private'), { recursive: true });
          await page.screenshot({ path: path.join(work, 'private', `${idLabel}-character.png`) });
        }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) {
          await waitForAdvertToEnd(page);
          await ensurePlaying();
          await page.waitForTimeout(8000);
        }
        const block = await measure(scene, 'steady', undefined, false, attempt);
        if ((block as any).valid) break;
      }
      if (!calibration) {
        await page.evaluate(() => {
          (globalThis as any).__r31Same = true;
        });
        const search = page.getByRole('combobox', { name: /Search|検索/ });
        await search.fill('lofi hip hop');
        await measure(scene, 'spa', async () => {
          await search.press('Enter');
          await expect(page).toHaveURL(/results\?search_query=/);
        });
        expect(await page.evaluate(() => (globalThis as any).__r31Same)).toBe(true);
      }
    }
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await waitForAdvertToEnd(page);
    await ensurePlaying();
    await page.waitForTimeout(8000);
    const q0 = (await state(page)).video;
    await page.waitForTimeout(DURATION);
    const q1 = (await state(page)).video;
    result.artworkOffVideo = q0 && q1 ? { total: q1.total - q0.total, dropped: q1.dropped - q0.dropped } : null;
    result.browser = context.browser()?.version();
    result.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  } catch (error) {
    result.error = { message: String(error) };
    console.log('R31_INVALID_RUN', idLabel, String(error));
  } finally {
    await context.close();
    result.hostAfter = await auditHost();
    result.finished = new Date().toISOString();
    await writeFile(path.join(work, idLabel + '.json'), JSON.stringify(result, null, 2));
  }
  result.eligible =
    !result.error &&
    Boolean(result.hostBefore && result.hostAfter) &&
    Object.keys(result.phases).length === (calibration ? 1 : 6) &&
    Object.values(result.phases).every((p: any) => p.valid);
  await writeFile(path.join(work, idLabel + '.json'), JSON.stringify(result, null, 2));
  return result;
}
test('R31 fix real YouTube alternating performance', async () => {
  test.skip(process.env.R31_PERF !== '1');
  test.setTimeout(3600000);
  await mkdir(work, { recursive: true });
  const calibration = process.env.R31_CALIBRATION === '1',
    runs: any[] = [];
  const builds = {
    before: path.resolve('../r31-before/.work/r31-perf'),
    after: path.resolve('.work/r31-perf'),
    busy: path.resolve('.work/r31-perf-busy'),
  };
  try {
    if (calibration) {
      runs.push(await oneRun('after', builds.after, 0, true));
      runs.push(await oneRun('busy', builds.busy, 0, true));
      const a = runs[0].phases['no-character:steady'].cpu,
        b = runs[1].phases['no-character:steady'].cpu;
      const delta = { median: b.median - a.median, p95: b.p95 - a.p95 };
      await writeFile(path.join(work, 'calibration.json'), JSON.stringify({ delta, runs }, null, 2));
      expect(delta.median).toBeGreaterThan(1.5);
      expect(delta.median).toBeLessThan(2.5);
      expect(delta.p95).toBeGreaterThan(1.5);
    } else {
      const grouped = new Map();
      for (const r of runs) {
        const p = grouped.get(r.pair) ?? {};
        p[r.label] = r;
        grouped.set(r.pair, p);
      }
      let accepted = [...grouped.values()].filter((p) => p.before?.eligible && p.after?.eligible).length;
      const first = 1 + Math.max(0, ...runs.map((r) => r.pair)),
        last = first + 8 - 1;
      for (let pair = first; pair <= last && accepted < 4; pair++) {
        const pairRuns = [];
        for (const label of pair % 2 ? ['before', 'after'] : ['after', 'before']) {
          const r = await oneRun(label, builds[label], pair);
          r.traceDirectory = work;
          pairRuns.push(r);
          runs.push(r);
        }
        if (pairRuns.every((r) => r.eligible)) accepted++;
        else console.log('R31_EXCLUDED_PAIR', pair, 'quality review');
      }
      expect(accepted, 'Four complete pairs with background CPU recorded').toBe(4);
    }
  } finally {
    await writeFile(
      path.join(work, calibration ? 'calibration-runs.json' : 'runs.json'),
      JSON.stringify(
        {
          environment: {
            os: platform(),
            release: release(),
            cpu: cpus()[0].model,
            url: URL_,
            headed: true,
            windowPosition: [-4000, 0],
            duration: DURATION,
            probe: 'isolated-world-v3',
          },
          runs,
        },
        null,
        2,
      ),
    );
  }
});
