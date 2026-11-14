import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';
import { vrmFixture } from './helpers/vrm-fixture';

async function extensionId(page: Page) {
  await page.goto('chrome://extensions/');
  const item = page.locator('extensions-item').filter({ hasText: 'Around' });
  await item.waitFor();
  return item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
}
async function metrics(cdp: CDPSession) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
}
function metricDelta(before: Record<string, number>, after: Record<string, number>) {
  return {
    taskCpuMs: (after.TaskDuration! - before.TaskDuration!) * 1000,
    scriptCpuMs: (after.ScriptDuration! - before.ScriptDuration!) * 1000,
    jsHeapBefore: before.JSHeapUsedSize,
    jsHeapAfter: after.JSHeapUsedSize,
    jsHeapPeak: null,
    gpuUtilization: null,
    actualVramBytes: null,
  };
}

test('opt-in load benchmark uses the same renderer for transport, File and IDB without persisting diagnostics in works', async () => {
  test.skip(process.env.AROUND_ASSET_PROFILE_TEST !== '1', 'Build AROUND_ASSET_PROFILE=1 and explicitly opt in.');
  test.setTimeout(90000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-load-smoke-')));
  try {
    const page = await context.newPage(),
      id = await extensionId(page);
    await page.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
    await page.locator('#file').setInputFiles({ name: 'original.vrm', mimeType: 'model/vrm', buffer: vrmFixture() });
    for (const mode of ['transport', 'direct', 'stored']) {
      const result = await page.evaluate((mode) => (globalThis as any).aroundAssetBench.run(mode), mode);
      expect(result.alphaPixels).toBeGreaterThan(100);
      expect(result.stats.contexts).toBe(1);
      expect(result.stats.instances).toBe(1);
      expect(result.spans.some((s: any) => s.name === 'parse.gltf-inclusive')).toBe(true);
      expect(result.spans.some((s: any) => s.name === 'first.presentation-proxy-inclusive')).toBe(true);
      expect(JSON.stringify(result.spans)).not.toContain('original.vrm');
      if (mode !== 'transport')
        expect(result.spans.some((s: any) => /rpc.get-part|upload.parts-total/.test(s.name))).toBe(false);
    }
    const data = await page.evaluate(async () => chrome.storage.local.get(null));
    expect(Object.keys(data).some((k) => k.includes('profile'))).toBe(false);
    await page.evaluate(() => (globalThis as any).aroundAssetBench.stop());
    await expect(page.locator('#stage canvas')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('private local avatar: real YouTube A and controlled A-prime/B/C load performance', async () => {
  test.skip(
    process.env.AROUND_ASSET_BENCH_LIVE !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit private-file and real-site performance run only.',
  );
  test.setTimeout(900000);
  const profiling = process.env.AROUND_ASSET_BENCH_BASELINE !== '1',
    file = path.resolve(process.env.AROUND_VRM_FILE!);
  let report: Record<string, any> = {
    sourceCommit: '90926a6',
    profiling,
    bytes: 57185776,
    conditions: {},
    notes: [
      'First = new Chrome profile/context; OS file/driver cache is not flushed.',
      'Warm = same process, a newly parsed model and a fresh WebGL context, not resource reuse.',
      'CPU is only the measured page target, not the service worker or the GPU process.',
    ],
  };
  const queueOnly = process.env.AROUND_ASSET_BENCH_QUEUE === '1';
  const repeats = Math.max(3, Math.min(10, Number(process.env.AROUND_ASSET_REPEATS) || 3));
  const label = process.env.AROUND_ASSET_RUN_LABEL;
  if (label && !/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid benchmark label');
  const artifact =
    '.work/verification/asset-load-' + (label ?? (queueOnly ? 'queue' : profiling ? 'profile' : 'baseline')) + '.json';
  await mkdir('.work/verification', { recursive: true });
  const persist = () => writeFile(artifact, JSON.stringify(report, null, 2));
  const controlsOnly = profiling && !queueOnly && process.env.AROUND_ASSET_BENCH_CONTROLS === '1';
  if (controlsOnly) {
    report = JSON.parse(await readFile(artifact, 'utf8'));
    report.notes.push(
      'Controlled comparison repeated after explicitly releasing ModelSurface and its bitmaps between trials. Real YouTube measurements are retained.',
    );
  }
  if (!controlsOnly) {
    const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-load-live-')), false, {
      headed: true,
      width: 1920,
      height: 1000,
    });
    try {
      report.browser = context.browser()?.version();
      const manager = await context.newPage(),
        id = await extensionId(manager);
      await manager.close();
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      const page = await context.newPage();
      await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await showArtwork(popup);
      await page.bringToFront();
      await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
      await page
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) => v.pause());
      // UI0-d: the side panel opens straight from 表示設定 (no in-page Studio on the way).
      await expect(popup.locator('#creator-editor-direct')).toBeEnabled();
      await popup.locator('#creator-editor-direct').click();
      await page.bringToFront();
      const panel = await sidePanelDriver(context, page, id);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const query = (action: string) =>
        panel.evaluate<any>(
          `chrome.runtime.sendMessage({type:'ww.asset-profile.v1',action:${JSON.stringify(action)}})`,
        );
      const runs: any[] = [];
      report.conditions.A_real_youtube = runs;
      for (let n = 0; n < (queueOnly ? 1 : repeats); n++) {
        if (n) {
          await panel.click('.delete-image');
          await expect(page.locator('#around-decorations .model-media')).toHaveCount(0);
        }
        if (profiling) await query('clear');
        const before = await metrics(cdp),
          start = performance.now();
        console.log(`Asset load A run ${n + 1}`);
        await panel.files([file], '.model-file');
        const media = page.locator('#around-decorations .model-media');
        await expect(media).toHaveAttribute(
          profiling ? 'data-profile-ready' : 'data-renderer',
          profiling ? /^ap-/ : 'three',
          { timeout: 120000 },
        );
        const totalMs = performance.now() - start,
          after = await metrics(cdp),
          trace = await media.getAttribute('data-profile-ready');
        if (profiling)
          await expect
            .poll(async () =>
              (await query('snapshot')).spans.some(
                (s: any) => s.id === trace && s.name === 'first.presentation-proxy-inclusive',
              ),
            )
            .toBe(true);
        const spans = profiling ? (await query('snapshot')).spans.filter((s: any) => s.id === trace) : [];
        const alphaPixels = await media.locator('canvas').evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let count = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i]) count++;
          return count;
        });
        expect(alphaPixels).toBeGreaterThan(1000);
        runs.push({
          run: n + 1,
          cache: n ? 'warm-process' : 'first-profile',
          totalMs,
          trace,
          spans,
          alphaPixels,
          ...metricDelta(before, after),
          placement: await media.locator('canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]),
          stats: await page
            .locator('#around-decorations')
            .evaluate((e: HTMLElement) => JSON.parse(e.dataset.aroundModelStats!)),
        });
        await persist();
      }
      await panel.click('.save');
      await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
      report.youtube = await page
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) => ({
          readyState: v.readyState,
          paused: v.paused,
          error: v.error?.code ?? null,
        }));
      if (profiling && !queueOnly && process.env.AROUND_ASSET_SKIP_OLD_IFRAME !== '1') {
        const saved = await popup.evaluate(
          async () =>
            (await chrome.storage.local.get('around.design.youtube'))[
              'around.design.youtube'
            ] as import('../src/design/types').DesignDocument,
        );
        const asset = saved.decorations[0]!.assetId,
          target = Number(await panel.evaluate('new URL(location.href).searchParams.get("target")'));
        report.iframe = await iframeProbe(context, page, id, asset, target);
      }
      await persist();
    } catch (error) {
      report.failure = String(error);
      await persist();
      throw error;
    } finally {
      await context.close();
    }
  }
  if (!profiling || queueOnly) return;
  for (const mode of ['transport', 'direct', 'stored']) {
    const browser = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-load-direct-')), false, {
      headed: true,
      width: 1920,
      height: 1000,
    });
    try {
      const page = await browser.newPage(),
        id = await extensionId(page);
      await page.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
      await page.bringToFront();
      await page.locator('#file').setInputFiles(file);
      if (mode === 'stored') await page.evaluate(() => (globalThis as any).aroundAssetBench.seed());
      const cdp = await browser.newCDPSession(page);
      await cdp.send('Performance.enable');
      const runs: any[] = [];
      report.conditions[mode] = runs;
      for (let n = 0; n < repeats; n++) {
        console.log(`Asset load ${mode} run ${n + 1}`);
        const before = await metrics(cdp);
        const result = await page.evaluate((mode) => (globalThis as any).aroundAssetBench.run(mode), mode);
        const after = await metrics(cdp);
        expect(result.alphaPixels).toBeGreaterThan(1000);
        runs.push({
          run: n + 1,
          cache: n ? 'warm-process' : 'first-profile',
          ...result,
          ...metricDelta(before, after),
        });
        await persist();
      }
    } catch (error) {
      report[mode + 'Failure'] = String(error);
      await persist();
      throw error;
    } finally {
      await browser.close();
    }
  }
});

async function iframeProbe(
  context: import('@playwright/test').BrowserContext,
  page: Page,
  id: string,
  asset: string,
  tab: number,
) {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
  const grant = () =>
    control.evaluate(({ asset, tab }) => (globalThis as any).aroundAssetBench.grant(asset, tab), { asset, tab });
  const report: Record<string, any> = {};
  try {
    const { nonce } = await grant();
    report.granted = Boolean(nonce);
    await page.bringToFront();
    await page.evaluate(
      ({ id, nonce }) => {
        const f = document.createElement('iframe');
        f.id = 'around-asset-probe';
        f.src = `chrome-extension://${id}/diagnostics/asset-benchmark.html?nonce=${nonce}`;
        f.style.cssText =
          'position:fixed;left:20px;top:200px;width:240px;height:320px;border:0;z-index:2147483645;pointer-events:none';
        f.allow = 'fullscreen';
        document.body.append(f);
      },
      { id, nonce },
    );
    await expect.poll(() => page.frames().some((f) => f.url().includes('asset-benchmark.html?nonce='))).toBe(true);
    const frame = page.frames().find((f) => f.url().includes('asset-benchmark.html?nonce='))!;
    await frame.waitForFunction(
      () => Boolean(document.documentElement.dataset.probeReady || document.documentElement.dataset.probeError),
      null,
      { timeout: 120000 },
    );
    report.error = await frame.evaluate(() => document.documentElement.dataset.probeError ?? null);
    if (report.error) return report;
    report.render = await frame.evaluate(() => (globalThis as any).aroundAssetBench.latest());
    report.extensionOrigin = await frame.evaluate(() => ({
      origin: location.origin,
      chromeId: chrome.runtime.id,
      transparentBackground: getComputedStyle(document.body).backgroundColor,
    }));
    const cdp = await context.newCDPSession(page),
      contexts: any[] = [];
    cdp.on('Runtime.executionContextCreated', (event) => contexts.push(event.context));
    await cdp.send('Runtime.enable');
    let isolated: number | undefined;
    for (const ctx of contexts.filter((c) => c.auxData?.isDefault === false)) {
      const check = await cdp
        .send('Runtime.evaluate', {
          contextId: ctx.id,
          expression: 'typeof chrome!=="undefined" && chrome.runtime?.id',
          returnByValue: true,
        })
        .catch(() => undefined);
      if (check?.result.value === id) {
        isolated = ctx.id;
        break;
      }
    }
    report.isolatedWorldFound = Boolean(isolated);
    report.binaryTransfers = [];
    if (isolated)
      for (let n = 0; n < 3; n++) {
        const result = await cdp.send('Runtime.evaluate', {
          contextId: isolated,
          awaitPromise: true,
          returnByValue: true,
          expression: `new Promise((resolve,reject)=>{const f=document.querySelector('#around-asset-probe'),c=new MessageChannel();const timer=setTimeout(()=>reject(Error('channel timeout')),10000);c.port1.onmessage=e=>{if(e.data.byteLength){clearTimeout(timer);resolve({ms:performance.now()-start,received:e.data.byteLength,detached:buffer.byteLength===0});c.port1.close();}};f.contentWindow.postMessage({type:'around-binary-probe',nonce:${JSON.stringify(nonce)}},'chrome-extension://${id}',[c.port2]);const buffer=new ArrayBuffer(57185776),start=performance.now();c.port1.postMessage(buffer,[buffer]);})`,
        });
        report.binaryTransfers.push(
          result.exceptionDetails ? { error: result.exceptionDetails.text } : result.result.value,
        );
      }
    await page.locator('#movie_player').hover();
    await page.locator('.ytp-settings-button').click();
    report.nativeControlsClickable = await page.locator('.ytp-settings-menu').isVisible();
    await page.locator('.ytp-settings-button').click();
    await page.locator('.ytp-fullscreen-button').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    report.bodyFrameInsideFullscreen = await page.evaluate(() =>
      document.fullscreenElement!.contains(document.querySelector('#around-asset-probe')),
    );
    report.fullscreenElement = await page.evaluate(() => ({
      tag: document.fullscreenElement!.tagName,
      id: document.fullscreenElement!.id,
    }));
    report.bodyFrameRetained = await frame.evaluate(() => document.documentElement.dataset.probeReady === 'true');
    await page.evaluate(() => document.exitFullscreen());
    await page.evaluate(() => document.querySelector('#around-asset-probe')?.remove());
    const next = await grant();
    await page.evaluate(
      ({ id, nonce }) => {
        const f = document.createElement('iframe');
        f.id = 'around-asset-probe';
        f.src = `chrome-extension://${id}/diagnostics/asset-benchmark.html?nonce=${nonce}`;
        f.style.cssText = 'position:absolute;inset:0;width:240px;height:320px;border:0;pointer-events:none;z-index:100';
        document.querySelector('#movie_player')!.append(f);
      },
      { id, nonce: next.nonce },
    );
    await expect.poll(() => page.frames().some((f) => f.url().includes(next.nonce))).toBe(true);
    const inside = page.frames().find((f) => f.url().includes(next.nonce))!;
    await inside.waitForFunction(() => document.documentElement.dataset.probeReady === 'true', null, {
      timeout: 120000,
    });
    await page.locator('.ytp-fullscreen-button').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    report.playerFrameInsideFullscreen = await page.evaluate(() =>
      document.fullscreenElement!.contains(document.querySelector('#around-asset-probe')),
    );
    // Moving a cross-origin frame can detach Playwright's previous Frame handle.
    // Resolve the current iframe again before deciding whether rendering was lost.
    report.playerFrameState = await page
      .frameLocator('#around-asset-probe')
      .locator('html')
      .evaluate((e: HTMLElement) => ({ ready: e.dataset.probeReady === 'true', error: e.dataset.probeError ?? null }));
    report.playerFrameRetained = report.playerFrameState.ready;
    await page.evaluate(() => document.exitFullscreen());
    await cdp.detach();
  } catch (error) {
    report.failure = String(error);
  } finally {
    await page.evaluate(() => document.querySelector('#around-asset-probe')?.remove());
    await control.close();
  }
  return report;
}

test('opt-in real YouTube iframe origin, storage, transfer and fullscreen lifecycle probe', async () => {
  test.skip(
    process.env.AROUND_ASSET_IFRAME_TEST !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit local avatar / real-site iframe probe only.',
  );
  test.setTimeout(180000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-load-frame-')), false, {
    headed: true,
    width: 1920,
    height: 1000,
  });
  try {
    const manager = await context.newPage(),
      id = await extensionId(manager);
    await manager.close();
    const seed = await context.newPage();
    await seed.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
    await seed.locator('#file').setInputFiles(path.resolve(process.env.AROUND_VRM_FILE!));
    const asset = await seed.evaluate(() => (globalThis as any).aroundAssetBench.seed());
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    await showArtwork(popup);
    await page.bringToFront();
    await page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => v.pause());
    const tab = await seed.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!,
    );
    const result = await iframeProbe(context, page, id, asset, tab);
    await mkdir('.work/verification', { recursive: true });
    await writeFile('.work/verification/asset-iframe-probe.json', JSON.stringify(result, null, 2));
    expect(result.error).toBeNull();
    expect(result.nativeControlsClickable).toBe(true);
    expect(result.bodyFrameRetained).toBe(true);
    expect(result.playerFrameRetained).toBe(true);
  } finally {
    await context.close();
  }
});
