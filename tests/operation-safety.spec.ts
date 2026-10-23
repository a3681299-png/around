import { build } from 'esbuild';
import { test, expect } from './fixtures';
import path from 'node:path';
import { exposeEditorControls } from './helpers/editor-workspace';

async function probeCode() {
  const result = await build({
    stdin: {
      contents: `export {youtubeOperations} from './src/sites/youtube-operations'; export {createOperationGuardHost} from './src/host/operation-guard'; export {safePaintRegions} from './src/world/operations'; export {evaluatePreparedWorld,initialWorldState} from './src/world/evaluate'; export {evaluateLayout} from './src/world/layout'; export {worldScenario} from './tests/helpers/world-scenario';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G1Probe',
  });
  return result.outputFiles[0]!.text;
}

test('default artwork retains its decoder while the compositor clips protected regions', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((b: HTMLButtonElement) => b.click());
  const editor = youtube.locator('#web-world-themes-creator');
  await exposeEditorControls(editor);
  const data = await youtube.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e84f83';
    ctx.fillRect(16, 0, 48, 48);
    return c.toDataURL();
  });
  await editor.getByLabel('画像素材を追加').setInputFiles({
    name: 'transparent.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.split(',')[1]!, 'base64'),
  });
  await expect(editor.locator('.dirty')).toHaveText('未保存の変更');
  try {
    await expect(youtube.locator('#web-world-themes-decorations img')).toBeVisible();
  } catch (error) {
    console.log('Safety state:', await youtube.locator('#web-world-themes-decorations').getAttribute('data-ww-safety'));
    throw error;
  }
});

test('YouTube operation snapshots contain numeric geometry and detect replacement before input', async ({
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(async () => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document),
      first = source.capture();
    const input = document.querySelector('yt-searchbox input')!;
    const next = input.cloneNode(true);
    input.replaceWith(next);
    const valid = source.validate(first, new KeyboardEvent('keydown'));
    const latest = source.capture();
    const forged = source.validate({ ...latest });
    const frozen = Object.isFrozen(latest.surfaces[0].policy);
    const player = document.querySelector<HTMLElement>('#movie_player')!;
    player.style.position = 'fixed';
    const fixedSlot = source.videoSlot();
    player.style.removeProperty('position');
    await player.requestFullscreen();
    source.validate(latest, new KeyboardEvent('keydown')); // Force a fresh numeric snapshot.
    const fullscreen = source.capture();
    const outsideVisible = fullscreen.surfaces.some((s: any) => s.id.startsWith('comment.') && s.availability.visible);
    const fullscreenHit = source.validate(fullscreen, new PointerEvent('pointerdown', { clientX: 550, clientY: 380 }));
    await document.exitFullscreen();
    source.destroy();
    return { first, latest, valid, forged, frozen, hasFixedSlot: Boolean(fixedSlot), outsideVisible, fullscreenHit };
  });
  expect(result.valid).toBe(false);
  expect(result.forged).toBe(false);
  expect(result.frozen).toBe(true);
  expect(result.hasFixedSlot).toBe(false);
  expect(result.outsideVisible).toBe(false);
  expect(result.fullscreenHit).toBe(true);
  expect(result.latest.generation.geometry).toBeGreaterThan(result.first.generation.geometry);
  expect(result.first.surfaces.some((s: any) => s.id === 'player.controls.bottom' && s.kind === 'drag')).toBe(true);
  expect(result.first.surfaces.some((s: any) => s.id.startsWith('comment.') && s.kind === 'text-input')).toBe(true);
  expect(JSON.stringify(result.first)).not.toContain('element');
});

test('Host pauses before mismatched input, recovers only when stable, and excludes hidden time from idle', async ({
  youtube,
}) => {
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document);
    let immediate = 0;
    const host = api.createOperationGuardHost(document, source, (stop: boolean) => {
      if (stop) immediate++;
    });
    const now = performance.now();
    host.sample(now);
    host.pause('test geometry mismatch', true);
    const paused = host.snapshot().stopped;
    host.sample(now + 100);
    const early = host.snapshot().stopped;
    host.sample(now + 500);
    const recovered = host.snapshot().stopped;
    const idle = host.sample(now + 2000).idleSeconds;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hidden = host.sample(now + 10000).idleSeconds;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    const visible = host.sample(performance.now()).idleSeconds;
    host.pause('repeat 2', true);
    host.pause('repeat 3', true);
    host.sample(now + 20000);
    const latched = host.snapshot().stopped;
    host.destroy();
    const scoped = api.createOperationGuardHost(document, api.youtubeOperations(document), () => undefined);
    scoped.sample(performance.now());
    const paints = ['image', 'model'].map((id) => ({
      id,
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      opacity: 0,
      pointerEvents: false,
      outset: 0,
      composition: 'overlay',
    }));
    for (let i = 0; i < 3; i++) scoped.pause('model context lost', true, ['model']);
    scoped.sample(performance.now() + 1000);
    const scopedStops = [...scoped.commit(paints)];
    scoped.destroy();
    return { immediate, paused, early, recovered, idle, hidden, visible, latched, scopedStops };
  });
  expect(result.immediate).toBe(3);
  expect(result.paused).toBeTruthy();
  expect(result.early).toBeTruthy();
  expect(result.recovered).toBe('');
  expect(result.idle).toBeGreaterThan(1);
  expect(result.hidden).toBe(0);
  expect(result.visible).toBeLessThan(0.1);
  expect(result.latched).toBe('repeat 3');
  expect(result.scopedStops).toEqual(['model']);
});

test('leaving a native control restores motion after hysteresis without another pointer event', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  await youtube.evaluate(() => {
    const api = (window as any).G1Probe;
    let pending = false;
    const host = api.createOperationGuardHost(document, api.youtubeOperations(document), () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame((time) => {
          pending = false;
          host.sample(time);
        });
      }
    });
    host.sample(performance.now());
    host.commit([
      {
        id: 'motion',
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        opacity: 0,
        pointerEvents: false,
        outset: 0,
        composition: 'overlay',
        dynamic: true,
      },
    ]);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 180 }));
    (window as any).g1Approach = () => host.snapshot().approaching;
    (window as any).g1FinishApproach = () => host.destroy();
  });
  await expect.poll(() => youtube.evaluate(() => (window as any).g1Approach())).toBe(true);
  await youtube.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { clientX: 850, clientY: 500 })));
  await expect.poll(() => youtube.evaluate(() => (window as any).g1Approach())).toBe(false);
  await youtube.evaluate(() => (window as any).g1FinishApproach());
});

test('manual emergency OFF releases drawing and preserves an unsaved editor and Undo until explicit resume', async ({
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((b: HTMLButtonElement) => b.click());
  const editor = youtube.locator('#web-world-themes-creator');
  await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(editor.locator('.dirty')).toHaveText('未保存の変更');
  await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-theme', 'retro');
  await expect(editor.locator('.dirty')).toHaveText('未保存の変更');
  await expect(editor.getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
  await popup.getByRole('switch', { name: '制作モード' }).check();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-theme', 'retro');
  await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(1);
  await expect(editor.locator('.dirty')).toHaveText('未保存の変更');
});

test('opaque click-through paint is compositor-clipped away from native controls', async ({ youtube }) => {
  await youtube.addScriptTag({ content: await probeCode() });
  // Exercise exactly the production numerical partition, independent of assets.
  const code = await build({
    stdin: {
      contents: `export {safePaintRegions, guardPaint} from './src/world/operations';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'G1Guard',
  });
  await youtube.addScriptTag({ content: code.outputFiles[0]!.text });
  const button = youtube.getByRole('button', { name: 'All', exact: true });
  const before = await button.screenshot();
  const result = await youtube.evaluate(() => {
    const source = (window as any).G1Probe.youtubeOperations(document),
      snapshot = source.capture(),
      api = (window as any).G1Guard;
    const regions = api.safePaintRegions(snapshot, false);
    const composition = source.overlaySlot();
    if (!composition) throw new Error('No verified composition slot');
    const overlay = document.createElement('div');
    overlay.id = 'web-world-themes-test-opaque';
    overlay.style.cssText = `position:fixed;inset:0;background:red;pointer-events:none;z-index:${composition.zIndex};clip-path:path('${regions.map((r: any) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('')}')`;
    composition.parent.append(overlay);
    const issues = api.guardPaint(snapshot, [
      {
        id: 'opaque',
        bounds: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
        opacity: 1,
        pointerEvents: false,
        outset: 30,
        composition: 'overlay',
      },
    ]);
    source.destroy();
    return issues;
  });
  expect(result.some((i: any) => i.severity === 'enforced' && i.action === 'clip')).toBe(true);
  expect((await button.screenshot()).equals(before)).toBe(true);
  await button.click();
  await youtube.locator('#navigate').click();
  await expect(youtube).toHaveURL(/watch/);
});

test('operation guard frame overhead alternates baseline and guarded frames (informational)', async ({
  youtube,
}, info) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await youtube.addScriptTag({ content: await probeCode() });
  const result = await youtube.evaluate(() => {
    const api = (window as any).G1Probe,
      source = api.youtubeOperations(document),
      host = api.createOperationGuardHost(document, source, () => undefined);
    const { scene, inputs } = api.worldScenario(32),
      input = inputs[0],
      layout = api.evaluateLayout(scene, input);
    const paints = layout.layers
      .filter((l: any) => l.bounds)
      .map((l: any) => ({
        id: l.layer.id,
        bounds: l.bounds,
        opacity: 1,
        pointerEvents: false,
        outset: 0,
        composition: 'overlay',
      }));
    const element = document.createElement('div');
    element.id = 'web-world-themes-benchmark';
    const shadow = element.attachShadow({ mode: 'open' }),
      style = document.createElement('style');
    style.textContent = ':host{clip-path:var(--ww-decoration-clip,none)}';
    shadow.append(style);
    document.body.append(element);
    const workloads = [];
    let checksum = 0;
    function run(guarded: boolean, fresh: boolean, iterations: number) {
      let state = api.initialWorldState();
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const value = api.evaluatePreparedWorld(layout, state, { ...input, timeMs: i * 16, deltaMs: i ? 16 : 0 });
        state = value.state;
        checksum += value.frame.effects.length;
        if (guarded) {
          if (fresh) source.validate(source.capture(), new KeyboardEvent('keydown'));
          host.sample(performance.now());
          host.commit(paints);
          const regions = api.safePaintRegions(source.capture(), false);
          element.style.setProperty(
            '--ww-decoration-clip',
            `path('${regions.map((r: any) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('')}')`,
          );
        }
      }
      return (performance.now() - start) / iterations;
    }
    for (const fresh of [false, true]) {
      run(false, fresh, 300);
      run(true, fresh, 300);
      const pairs = [];
      for (let round = 0; round < 12; round++) {
        let before: number, after: number;
        if (round % 2) {
          after = run(true, fresh, 200);
          before = run(false, fresh, 200);
        } else {
          before = run(false, fresh, 200);
          after = run(true, fresh, 200);
        }
        pairs.push({ before, after, added: after - before });
      }
      const median = (values: number[]) => {
        values.sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1]! + values[middle]!) / 2;
      };
      workloads.push({
        geometry: fresh ? 'fresh native geometry each frame' : 'cached stable geometry',
        pairs,
        beforeMedianMs: median(pairs.map((p) => p.before)),
        afterMedianMs: median(pairs.map((p) => p.after)),
        addedMedianMs: median(pairs.map((p) => p.added)),
      });
    }
    const surfaces = source.capture().surfaces.length;
    host.destroy();
    element.remove();
    return { layers: 32, surfaces, iterationsPerBatch: 200, pairs: 12, checksum, workloads };
  });
  expect(result.checksum).toBeGreaterThan(0);
  console.log('OPERATION_GUARD_BENCHMARK ' + JSON.stringify(result));
  await info.attach('operation-guard-benchmark.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
