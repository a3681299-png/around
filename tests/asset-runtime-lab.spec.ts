import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openAssetLab, compactLabResult } from './helpers/asset-runtime-lab';
import { vrmFixture } from './helpers/vrm-fixture';

test('opt-in resident iframe uses IDB, rejects page messages and reconnects with new generations', async () => {
  test.skip(process.env.WW_ASSET_LAB_TEST !== '1', 'Explicit profiling build only');
  test.setTimeout(180000);
  const lab = await openAssetLab();
  try {
    const result = await lab.call('show', 'resident', lab.asset.id, 3);
    expect(result.alphaPixels).toBeGreaterThan(100);
    expect(result.stats.instances).toBe(3);
    expect(result.binaryBytes).toBe(0);
    expect(await lab.page.locator('#ww-asset-runtime-lab').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe(
      'none',
    );
    // Verify the supported band boundary using our original fixture, not the private avatar.
    const point = await lab.page
      .frameLocator('#ww-asset-runtime-lab')
      .locator('.model-media canvas')
      .first()
      .evaluate((c: HTMLCanvasElement) => {
        const p = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data,
          r = c.getBoundingClientRect();
        for (let y = Math.floor(c.height / 2); y < c.height; y++)
          for (let x = Math.floor(c.width / 2); x < c.width; x++)
            if (p[(y * c.width + x) * 4 + 3]! > 250)
              return { x: r.left + ((x + 0.5) * r.width) / c.width, y: r.top + ((y + 0.5) * r.height) / c.height };
        throw new Error('Opaque fixture pixel missing');
      });
    await lab.page.evaluate((p) => {
      for (const [id, color, z] of [
        ['below', 'rgb(255,0,0)', 2147483643],
        ['above', 'rgb(0,0,255)', 2147483645],
      ] as const) {
        const e = document.createElement('div');
        e.id = 'lab-' + id;
        e.style.cssText = `position:fixed;left:${Math.floor(p.x) - 4}px;top:${Math.floor(p.y) - 4}px;width:9px;height:9px;background:${color};z-index:${z};pointer-events:none`;
        document.body.append(e);
      }
    }, point);
    const pixel = async () =>
      lab.control.evaluate(
        async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
            bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const c = document.createElement('canvas');
          c.width = c.height = 1;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        },
        (
          await lab.page.screenshot({ clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } })
        ).toString('base64'),
      );
    expect(await pixel()).toEqual([0, 0, 255]);
    await lab.page.locator('#lab-above').evaluate((e) => e.remove());
    expect(await pixel()).not.toEqual([255, 0, 0]);
    await lab.page.locator('#lab-below').evaluate((e) => e.remove());
    const invalid = await lab.control.evaluate(async () =>
      chrome.runtime.sendMessage({ type: 'ww.asset-runtime.lab.v1', action: 'claim', ticket: 'forged' }),
    );
    expect(invalid.ok).toBe(false);
    let generation = result.generation;
    for (let n = 0; n < 5; n++) {
      const r = await lab.call('restart');
      expect(r.alphaPixels).toBeGreaterThan(100);
      expect(r.generation).toBeGreaterThan(generation);
      generation = r.generation;
    }
    for (let n = 0; n < 5; n++) {
      await lab.page.locator('#ww-asset-runtime-lab').evaluate((f: HTMLIFrameElement) => {
        f.src = f.src;
      });
      await expect.poll(async () => (await lab.call('state')).generation).toBeGreaterThan(generation);
      await expect
        .poll(() => lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas').count())
        .toBeGreaterThan(0);
      generation = (await lab.call('state')).generation;
    }
    await lab.page.locator('#movie_player').evaluate((e: HTMLElement) => e.requestFullscreen());
    await expect.poll(async () => (await lab.call('state')).generation).toBeGreaterThan(generation);
    await expect
      .poll(() => lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas').count())
      .toBeGreaterThan(0);
    await lab.page.evaluate(() => document.exitFullscreen());
    await lab.call('clear');
    await expect(lab.page.frameLocator('#ww-asset-runtime-lab').locator('canvas')).toHaveCount(0);
    await lab.popup.getByRole('switch', { name: 'テーマを使う' }).uncheck();
    await expect(lab.page.locator('#ww-asset-runtime-lab')).toHaveCount(0);
  } finally {
    await lab.context.close();
  }
});

test('opt-in resident benchmark: private original, five reloads and fullscreen reconnections', async () => {
  test.skip(
    process.env.WW_ASSET_RESIDENT_LIVE !== '1' || !process.env.WW_VRM_FILE,
    'Explicit real-site/private-file benchmark',
  );
  test.setTimeout(600000);
  const lab = await openAssetLab(true, process.env.WW_VRM_FILE),
    report: Record<string, any> = {
      browser: lab.context.browser()?.version(),
      bytes: lab.asset.byteLength,
      actualVrmVersion: lab.asset.model.vrm.version,
      resident: [],
      reconnect: [],
    };
  const persist = async () => {
    await mkdir('.work/verification', { recursive: true });
    await writeFile('.work/verification/asset-runtime-resident.json', JSON.stringify(report, null, 2));
  };
  try {
    await lab.page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => v.pause());
    for (let n = 0; n < 5; n++) {
      const r = await lab.call('show', 'resident', lab.asset.id);
      expect(r.alphaPixels).toBeGreaterThan(1000);
      report.resident.push({
        trial: n + 1,
        cache: n ? 'warm-process-fresh-model' : 'first-renderer',
        ...compactLabResult(r),
      });
      await persist();
    }
    for (let n = 0; n < 5; n++) {
      const started = performance.now(),
        r = await lab.call('restart');
      report.reconnect.push({ trial: n + 1, reconnectMs: performance.now() - started, ...compactLabResult(r) });
      await persist();
    }
    await lab.page.locator('#movie_player').hover();
    await lab.page.locator('.ytp-settings-button').click();
    report.settingsClickable = await lab.page.locator('.ytp-settings-menu').isVisible();
    await lab.page.locator('.ytp-settings-button').click();
    report.fullscreen = [];
    for (let n = 0; n < 5; n++) {
      await lab.page.locator('.ytp-fullscreen-button').click();
      await expect.poll(() => lab.page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      report.fullscreen.push(
        await lab.page.evaluate(() => ({
          inside: document.fullscreenElement!.contains(document.querySelector('#ww-asset-runtime-lab')),
          element: document.fullscreenElement!.tagName,
        })),
      );
      await lab.page.evaluate(() => document.exitFullscreen());
    }
    report.permissions = await lab.control.evaluate(() => chrome.runtime.getManifest().permissions);
    await persist();
  } catch (error) {
    report.failure = String(error);
    await persist();
    throw error;
  } finally {
    await lab.context.close();
  }
});

test('opt-in binary route transfers actual model ownership and preserves pixels', async () => {
  test.skip(process.env.WW_ASSET_LAB_TEST !== '1', 'Explicit profiling build only');
  test.setTimeout(120000);
  const lab = await openAssetLab();
  try {
    const resident = await lab.call('show', 'resident', lab.asset.id);
    const binary = await lab.call('show', 'binary', lab.asset.id);
    const chunks = await lab.call('show', 'chunks', lab.asset.id);
    expect(binary.alphaPixels).toBe(resident.alphaPixels);
    expect(chunks.alphaPixels).toBe(resident.alphaPixels);
    expect(binary.binaryBytes).toBe(lab.asset.byteLength);
    expect(binary.senderDetached).toBe(true);
    expect(binary.spans.some((s: any) => s.id === binary.trace && s.name === 'rpc.get-part')).toBe(false);
    await lab.call('destroy');
    await expect(lab.page.locator('#ww-asset-runtime-lab')).toHaveCount(0);
    await expect(lab.page.locator('#ww-asset-runtime-binary')).toHaveCount(0);
  } finally {
    await lab.context.close();
  }
});

test('opt-in private original: matched saved-source chunks, binary and resident comparison', async () => {
  test.skip(
    process.env.WW_ASSET_BINARY_LIVE !== '1' || !process.env.WW_VRM_FILE,
    'Explicit real-site/private-file benchmark',
  );
  test.setTimeout(600000);
  const lab = await openAssetLab(true, process.env.WW_VRM_FILE),
    report: Record<string, any> = { browser: lab.context.browser()?.version(), bytes: lab.asset.byteLength, modes: {} };
  const persist = async () => {
    await mkdir('.work/verification', { recursive: true });
    await writeFile('.work/verification/asset-runtime-binary.json', JSON.stringify(report, null, 2));
  };
  try {
    await lab.page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => v.pause());
    for (const mode of ['chunks', 'binary', 'resident']) {
      report.modes[mode] = [];
      for (let n = 0; n < 5; n++) {
        const r = await lab.call('show', mode, lab.asset.id);
        expect(r.alphaPixels).toBeGreaterThan(1000);
        report.modes[mode].push({
          trial: n + 1,
          cache: n ? 'warm-process-fresh-model' : 'first-route-session',
          ...compactLabResult(r),
        });
        await persist();
      }
    }
  } catch (error) {
    report.failure = String(error);
    await persist();
    throw error;
  } finally {
    await lab.context.close();
  }
});

test('opt-in shared VRM geometry/textures keep independent expressions and release references', async () => {
  test.skip(process.env.WW_ASSET_LAB_TEST !== '1', 'Explicit profiling build only');
  test.setTimeout(120000);
  const lab = await openAssetLab();
  try {
    await lab.call('configure', { shared: true });
    const result = await lab.call('show', 'resident', lab.asset.id, 3);
    expect(result.stats.instances).toBe(3);
    expect(result.stats.shared.refs).toBe(3);
    expect(result.stats.shared.sharedAssets).toBe(1);
    expect(result.stats.shared.sharedGeometries).toBe(1);
    expect(result.stats.geometries).toBe(1);
    await lab.call('pose', 0, 1);
    const media = lab.page.frameLocator('#ww-asset-runtime-lab').locator('.model-media');
    await expect
      .poll(async () => JSON.parse((await media.nth(0).getAttribute('data-vrm-pose')) ?? '{}').expressions?.happy)
      .toBe(1);
    expect(JSON.parse((await media.nth(1).getAttribute('data-vrm-pose'))!).expressions.happy ?? 0).toBe(0);
    await lab.call('clear');
    const idle = await lab.call('inspect');
    expect(idle.contexts).toBe(1);
    expect(idle.shared.refs).toBe(0);
    const again = await lab.call('show', 'resident', lab.asset.id, 3);
    expect(again.alphaPixels).toBeGreaterThan(100);
    expect(again.stats.shared.sharedAssets).toBe(1);
    await lab.call('configure', { shared: false });
    const empty = await lab.call('inspect');
    expect(empty.contexts).toBe(0);
    expect(empty.shared.sharedAssets).toBe(0);
  } finally {
    await lab.context.close();
  }
});

test('opt-in private cache: three avatars, mixed five-model scene, 20 add/remove cycles', async () => {
  test.skip(
    process.env.WW_ASSET_CACHE_LIVE !== '1' || !process.env.WW_VRM_FILE,
    'Explicit real-site/private-file benchmark',
  );
  test.setTimeout(900000);
  const lab = await openAssetLab(true, process.env.WW_VRM_FILE),
    report: Record<string, any> = {
      browser: lab.context.browser()?.version(),
      bytes: lab.asset.byteLength,
      duplicate3: [],
      cycles: [],
      mixed: [],
      forcedGc: true,
      actualGpuMemoryBytes: null,
    };
  const persist = async () => {
    await mkdir('.work/verification', { recursive: true });
    await writeFile('.work/verification/asset-runtime-cache.json', JSON.stringify(report, null, 2));
  };
  try {
    await lab.page
      .locator('video')
      .first()
      .evaluate((v: HTMLVideoElement) => v.pause());
    const frame = lab.page.frames().find((f) => f.url().includes('asset-runtime-lab.html?ticket='))!,
      gpuTarget = await lab.context.newCDPSession(frame);
    const memory = async () => {
      await gpuTarget.send('HeapProfiler.collectGarbage');
      return gpuTarget.send('Runtime.getHeapUsage');
    };
    report.coldMemory = await memory();
    await lab.call('configure', { shared: true });
    for (let n = 0; n < 5; n++) {
      const r = await lab.call('show', 'resident', lab.asset.id, 3);
      expect(r.stats.instances).toBe(3);
      expect(r.alphaPixels).toBeGreaterThan(20000);
      report.duplicate3.push({ trial: n + 1, ...compactLabResult(r) });
      await persist();
    }
    await lab.call('clear');
    report.residentIdleBefore = await memory();
    for (let n = 0; n < 20; n++) {
      const r = await lab.call('show', 'resident', lab.asset.id);
      await lab.call('clear');
      report.cycles.push({
        cycle: n + 1,
        displayMs: r.endToEndMs,
        memory: await memory(),
        stats: await lab.call('inspect'),
      });
      await persist();
    }
    report.residentIdleAfter = await memory();
    // Self-authored small variants are distinct original assets, not private avatar copies.
    await lab.control.locator('#file').setInputFiles(
      [0, 1].map((n) => ({
        name: `fixture-${n}.vrm`,
        mimeType: 'model/vrm',
        buffer: vrmFixture((j) => {
          j.materials[0].pbrMetallicRoughness.baseColorFactor = n ? [0.2, 0.8, 0.4, 1] : [0.8, 0.3, 0.2, 1];
        }),
      })),
    );
    const other = await lab.control.evaluate(() => (globalThis as any).wwAssetLab.seedMany());
    const ids = [lab.asset.id, ...other.map((a: any) => a.id)];
    const { session } = await lab.control.evaluate(({ ids, tab }) => (globalThis as any).wwAssetLab.open(ids, tab), {
      ids,
      tab: lab.tab,
    });
    await lab.call('start', session);
    await lab.call('configure', { shared: true });
    for (let n = 0; n < 5; n++) {
      const r = await lab.call('show', 'resident', [
        lab.asset.id,
        lab.asset.id,
        lab.asset.id,
        other[0].id,
        other[1].id,
      ]);
      await lab.call('add2D', 20);
      await lab.call('resetObservations');
      const steadyStart = performance.now();
      await lab.call('animate', true);
      await lab.page.waitForTimeout(2000);
      await lab.call('animate', false);
      const steadyMs = performance.now() - steadyStart;
      const steadyStats = await lab.call('inspect');
      report.mixed.push({
        trial: n + 1,
        ...compactLabResult(r),
        steadyStats,
        steadyMs,
        averageModelFps: ((steadyStats.paints / 5) * 1000) / steadyMs,
        twoDimensionalImages: 20,
        lightsPerModelScene: 2,
      });
      await persist();
    }
    await lab.call('configure', { shared: false });
    report.afterFullRelease = await lab.call('inspect');
    const finalFrame = lab.page.frames().find((f) => f.url().includes('asset-runtime-lab.html?ticket='))!,
      finalTarget = await lab.context.newCDPSession(finalFrame);
    await finalTarget.send('HeapProfiler.collectGarbage');
    report.afterFullReleaseMemory = await finalTarget.send('Runtime.getHeapUsage');
    await persist();
  } catch (error) {
    report.failure = String(error);
    await persist();
    throw error;
  } finally {
    await lab.context.close();
  }
});
