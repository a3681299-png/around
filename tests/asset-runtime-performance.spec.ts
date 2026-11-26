import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openAssetLab, compactLabResult, isolatedLab } from './helpers/asset-runtime-lab';
import { vrmFixture } from './helpers/vrm-fixture';

const save = async (name: string, report: unknown) => {
  await mkdir('.work/verification', { recursive: true });
  await writeFile('.work/verification/asset-runtime-' + name + '.json', JSON.stringify(report, null, 2));
};
const quality = (page: Page) =>
  page.evaluate(() => {
    const videos = [...document.querySelectorAll('video')],
      v = videos.find((v) => !v.paused && v.readyState >= 2) ?? videos.find((v) => v.readyState >= 2) ?? videos[0]!;
    const tracker = ((globalThis as any).__aroundQualityTracker ??= { next: 0, entries: new WeakMap() });
    let identity = tracker.entries.get(v);
    if (!identity) {
      identity = { id: ++tracker.next, revision: 0 };
      tracker.entries.set(v, identity);
      v.addEventListener('loadedmetadata', () => {
        identity.revision++;
      });
    }
    const q = v.getVideoPlaybackQuality();
    return {
      total: q.totalVideoFrames,
      dropped: q.droppedVideoFrames,
      time: v.currentTime,
      paused: v.paused,
      readyState: v.readyState,
      videoCount: videos.length,
      videoIndex: videos.indexOf(v),
      identity: identity.id,
      revision: identity.revision,
      adShowing: document.querySelector('#movie_player')?.classList.contains('ad-showing') ?? false,
      errorCode: v.error?.code ?? null,
    };
  });

test('opt-in GPU preparation: texture init, compileAsync, residual render and second browser session', async () => {
  test.skip(
    process.env.AROUND_ASSET_GPU_LIVE !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit private-file benchmark',
  );
  test.setTimeout(900000);
  const report: Record<string, any> = {
    conditions: {},
    timing:
      'CPU API wall time; texture GPU elapsed query includes texture commands/mipmaps. Residual render includes geometry, morph and skin uploads. OS/driver caches are not flushed.',
  };
  for (const mode of ['none', 'textures', 'compile', 'both']) {
    const profile = await mkdtemp(path.join(tmpdir(), 'around-ar-shader-'));
    report.conditions[mode] = [];
    for (let session = 1; session <= 2; session++) {
      const context = await launchExtension(profile, false, { headed: true, width: 1920, height: 1000 });
      try {
        report.browser = context.browser()?.version();
        const page = await context.newPage();
        await page.goto('chrome://extensions/');
        const item = page.locator('extensions-item').filter({ hasText: 'Around' });
        await item.waitFor();
        const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
        await page.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
        await page.locator('#file').setInputFiles(process.env.AROUND_VRM_FILE!);
        await page.bringToFront();
        for (let n = 0; n < 5; n++) {
          const r = await page.evaluate(({ mode }) => (globalThis as any).aroundAssetBench.run('direct', mode), {
            mode,
          });
          expect(r.alphaPixels).toBeGreaterThan(1000);
          report.conditions[mode].push({
            browserSession: session,
            trial: n + 1,
            cache: n ? 'warm-process-fresh-context' : session === 1 ? 'first-profile' : 'second-browser-same-profile',
            ...compactLabResult(r),
          });
          await save('gpu', report);
        }
      } catch (error) {
        report.failure = String(error);
        await save('gpu', report);
        throw error;
      } finally {
        await context.close();
      }
    }
  }
});

test('opt-in remaining scenarios: page reload, sequential different models and concurrent maintenance', async () => {
  test.skip(
    process.env.AROUND_ASSET_SCENARIOS_LIVE !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit real-site/private-file benchmark',
  );
  test.setTimeout(600000);
  const lab = await openAssetLab(true, process.env.AROUND_VRM_FILE),
    report: Record<string, any> = {
      browser: lab.context.browser()?.version(),
      reload: [],
      maintenance: [],
      sequential: [],
    };
  let call = lab.call;
  try {
    for (let n = 0; n < 5; n++) {
      const start = performance.now();
      await lab.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(lab.page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
      await lab.page
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) => v.pause());
      const { session } = await lab.control.evaluate(
        ({ id, tab }) => (globalThis as any).aroundAssetLab.open([id], tab),
        {
          id: lab.asset.id,
          tab: lab.tab,
        },
      );
      const cdp = await lab.context.newCDPSession(lab.page);
      call = await isolatedLab(lab.page, cdp, lab.id);
      await call('start', session);
      const r = await call('show', 'resident', lab.asset.id);
      report.reload.push({ trial: n + 1, reloadAndDisplayMs: performance.now() - start, ...compactLabResult(r) });
      await save('scenarios', report);
    }
    for (let n = 0; n < 5; n++) {
      const work = lab.control.evaluate((id) => (globalThis as any).aroundAssetLab.churn(id, 8), lab.asset.id);
      const [maintenance, loaded] = await Promise.all([work, call('show', 'chunks', lab.asset.id)]);
      report.maintenance.push({ trial: n + 1, ...maintenance, ...compactLabResult(loaded) });
      await save('scenarios', report);
    }
    await lab.control.locator('#file').setInputFiles(
      [0, 1].map((n) => ({
        name: `fixture-${n}.vrm`,
        mimeType: 'model/vrm',
        buffer: vrmFixture((j) => {
          j.materials[0].pbrMetallicRoughness.baseColorFactor = n ? [0.2, 0.8, 0.4, 1] : [0.8, 0.3, 0.2, 1];
        }),
      })),
    );
    const other = await lab.control.evaluate(() => (globalThis as any).aroundAssetLab.seedMany()),
      ids = [lab.asset.id, ...other.map((a: any) => a.id)];
    const { session } = await lab.control.evaluate(
      ({ ids, tab }) => (globalThis as any).aroundAssetLab.open(ids, tab),
      {
        ids,
        tab: lab.tab,
      },
    );
    await call('start', session);
    await call('configure', { shared: true });
    for (let n = 0; n < 5; n++) {
      const start = performance.now(),
        models = [];
      for (const id of ids) models.push(compactLabResult(await call('show', 'resident', id)));
      report.sequential.push({ trial: n + 1, totalMs: performance.now() - start, models });
      await save('scenarios', report);
    }
  } catch (error) {
    report.failure = String(error);
    await save('scenarios', report);
    throw error;
  } finally {
    await lab.context.close();
  }
});

test('opt-in actual playing YouTube dropped-frame deltas versus idle and loading routes', async () => {
  test.skip(
    process.env.AROUND_ASSET_QUALITY_LIVE !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit real-site/private-file benchmark',
  );
  test.setTimeout(900000);
  const lab = await openAssetLab(true, process.env.AROUND_VRM_FILE),
    report: Record<string, any> = {
      browser: lab.context.browser()?.version(),
      idle: [],
      modes: {},
      rejectedSamples: [],
      gpuMemoryBytes: null,
    };
  let call = lab.call;
  try {
    const resetVideo = async (ids = [lab.asset.id]) => {
      await lab.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(lab.page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
      const { session } = await lab.control.evaluate(
        ({ ids, tab }) => (globalThis as any).aroundAssetLab.open(ids, tab),
        {
          ids,
          tab: lab.tab,
        },
      );
      call = await isolatedLab(lab.page, await lab.context.newCDPSession(lab.page), lab.id);
      await call('start', session);
      await lab.page.evaluate(async () => {
        const videos = [...document.querySelectorAll('video')],
          v = videos.find((v) => v.readyState >= 2) ?? videos[0]!;
        v.muted = true;
        await Promise.race([
          v.play(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('YouTube playback unavailable')), 15000)),
        ]);
      });
      const first = await quality(lab.page);
      await expect
        .poll(async () => (await quality(lab.page)).total - first.total, { timeout: 20000 })
        .toBeGreaterThan(10);
      await mainVideo();
    };
    const mainVideo = async () => {
      await expect
        .poll(
          async () => {
            const q = await quality(lab.page);
            return !q.adShowing && !q.paused && q.readyState >= 2;
          },
          { timeout: 120000 },
        )
        .toBe(true);
      await lab.page.waitForTimeout(1000);
    };
    await resetVideo();
    const sample = async (work?: () => Promise<any>) => {
      const before = await quality(lab.page),
        start = performance.now();
      const result = work ? await work() : undefined;
      await lab.page.waitForTimeout(Math.max(0, 3000 - (performance.now() - start)));
      const after = await quality(lab.page),
        totalFramesDelta = after.total - before.total,
        droppedFramesDelta = after.dropped - before.dropped;
      const valid =
        !before.adShowing &&
        !after.adShowing &&
        !before.paused &&
        !after.paused &&
        after.readyState >= 2 &&
        totalFramesDelta > 0 &&
        droppedFramesDelta >= 0 &&
        after.time > before.time &&
        after.identity === before.identity &&
        after.revision === before.revision;
      const record = {
        elapsedMs: performance.now() - start,
        valid,
        before,
        after,
        totalFramesDelta,
        droppedFramesDelta,
        ...(result ? { result: compactLabResult(result) } : {}),
      };
      if (!valid) {
        report.rejectedSamples.push(record);
        await save('quality', report);
      }
      return record;
    };
    const collect = async (rows: any[], work?: () => Promise<any>) => {
      for (let attempt = 0; rows.length < 5 && attempt < 10; attempt++) {
        await mainVideo();
        const r = await sample(work);
        if (r.valid) rows.push({ trial: rows.length + 1, ...r });
        await save('quality', report);
      }
      expect(rows.length, 'Five valid, playing, non-ad segments are required').toBe(5);
    };
    await collect(report.idle);
    for (const mode of ['chunks', 'binary', 'resident']) {
      await resetVideo();
      report.modes[mode] = [];
      await collect(report.modes[mode], () => call('show', mode, lab.asset.id));
    }
    await lab.control.locator('#file').setInputFiles(
      [0, 1].map((n) => ({
        name: `fixture-${n}.vrm`,
        mimeType: 'model/vrm',
        buffer: vrmFixture((j) => {
          j.materials[0].pbrMetallicRoughness.baseColorFactor = [0.2 + n * 0.2, 0.8, 0.4, 1];
        }),
      })),
    );
    const other = await lab.control.evaluate(() => (globalThis as any).aroundAssetLab.seedMany()),
      ids = [lab.asset.id, ...other.map((a: any) => a.id)];
    await resetVideo(ids);
    await call('configure', { shared: true });
    report.mixed = [];
    await collect(report.mixed, async () => {
      await call('animate', false);
      const r = await call('show', 'resident', [lab.asset.id, lab.asset.id, lab.asset.id, other[0].id, other[1].id]);
      await call('add2D', 20);
      await call('resetObservations');
      await call('animate', true);
      return r;
    });
    await call('animate', false);
    report.mixedStats = await call('inspect');
    await save('quality', report);
  } catch (error) {
    report.failure = String(error);
    await save('quality', report);
    throw error;
  } finally {
    await lab.context.close();
  }
});
