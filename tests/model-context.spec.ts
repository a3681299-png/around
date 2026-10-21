import { build } from 'esbuild';
import type { Page, ElementHandle } from '@playwright/test';
import { test, expect } from './fixtures';
import { modelFixture } from './helpers/model-fixture';
import { vrmFixture } from './helpers/vrm-fixture';

const backend = '#model-runtime-test [data-ww-three-backend]';
async function mount(page: Page, bytes: Uint8Array) {
  const bundle = await build({
    entryPoints: ['tests/helpers/model-runtime.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ModelRuntimeTest',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.bringToFront();
  await page.evaluate((bytes) => {
    (globalThis as any).__modelRuntime = (globalThis as any).ModelRuntimeTest.mount(bytes);
  }, Array.from(bytes));
}
async function show(page: Page) {
  await page.evaluate(() => (globalThis as any).__modelRuntime.show());
  await expect(page.locator('#model-runtime-test .model-media')).toHaveAttribute('data-renderer', 'three');
}
const stats = (page: Page) => page.evaluate(() => (globalThis as any).__modelRuntime.stats());
const memory = (s: any) => ({ geometries: s.geometries, textures: s.textures, programs: s.programs });

for (const kind of ['glb', 'vrm'] as const) {
  test(`${kind} context is retained for exactly 30 seconds; repeated reuse and expiry release GPU resources`, async ({
    youtube,
  }, info) => {
    // Control the production 30s timer, not the retention setting. GPU work and parser remain real.
    await youtube.clock.install();
    await mount(youtube, kind === 'glb' ? modelFixture() : vrmFixture());
    const samples: unknown[] = [];
    let loaded: ReturnType<typeof memory> | undefined;
    let previous: ElementHandle<HTMLCanvasElement> | undefined;
    for (const phase of ['retained', 'expired'] as const) {
      for (let run = 0; run < 5; run++) {
        // Reattach at 29,999ms while paused, before the old timer can expire during parsing.
        await youtube.evaluate(() => (globalThis as any).__modelRuntime.show());
        await youtube.clock.resume();
        await expect(youtube.locator('#model-runtime-test .model-media')).toHaveAttribute('data-renderer', 'three');
        const active = await stats(youtube);
        expect(active.errors).toEqual([]);
        loaded ??= memory(active);
        expect(loaded.geometries).toBeGreaterThan(0);
        expect(loaded.textures).toBeGreaterThan(0);
        expect(loaded.programs).toBeGreaterThan(0);
        expect(memory(active)).toEqual(loaded);
        if (previous && phase === 'retained') expect(await previous.evaluate((c) => c.isConnected)).toBe(true);
        previous = (await youtube.locator(backend).elementHandle())! as ElementHandle<HTMLCanvasElement>;
        await youtube.clock.pauseAt(await youtube.evaluate(() => Date.now() + 50));
        await youtube.evaluate(() => (globalThis as any).__modelRuntime.hide());
        const idle = await stats(youtube);
        expect(idle).toMatchObject({
          contexts: 1,
          assets: 0,
          instances: 0,
          estimatedGpuAssetBytes: 0,
          geometries: 0,
          textures: 0,
          programs: 0,
        });
        await youtube.clock.fastForward(29_999);
        expect((await stats(youtube)).contexts).toBe(1);
        if (phase === 'expired') {
          await youtube.clock.fastForward(1);
          expect(await stats(youtube)).toMatchObject({ contexts: 0, geometries: 0, textures: 0, programs: 0 });
          expect(await previous.evaluate((c) => c.isConnected)).toBe(false);
          await expect.poll(() => previous!.evaluate((c) => c.getContext('webgl2')!.isContextLost())).toBe(true);
        }
        samples.push({
          phase,
          run: run + 1,
          active: memory(active),
          idle: memory(idle),
          contextsAfterWait: (await stats(youtube)).contexts,
        });
      }
    }
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.destroy());
    expect((await stats(youtube)).contexts).toBe(0);
    await info.attach(`${kind}-gpu-memory`, {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });
    console.log('MODEL_MEMORY_STATS ' + JSON.stringify({ kind, samples }));
  });
}

test('visibility changes, scene destruction and idle context loss cancel retention immediately; live models recover', async ({
  youtube,
}) => {
  await mount(youtube, vrmFixture());
  await show(youtube);
  // Playwright focus/capture can keep documents visible. Fix the lifecycle input, not GPU behavior.
  const visibility = (hidden: boolean) =>
    youtube.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  try {
    const first = (await youtube.locator(backend).elementHandle())!;
    await visibility(true);
    await expect(youtube.locator(backend)).toHaveCount(0);
    await expect
      .poll(() => first.evaluate((c: HTMLCanvasElement) => c.getContext('webgl2')!.isContextLost()))
      .toBe(true);
    await visibility(false);
    await expect(youtube.locator(backend)).toHaveCount(1);
    await expect.poll(() => stats(youtube)).toMatchObject({ contexts: 1, geometries: 1 });
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.hide());
    const idle = (await youtube.locator(backend).elementHandle())!;
    await youtube
      .locator(backend)
      .evaluate((c: HTMLCanvasElement) => c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
    await expect(youtube.locator(backend)).toHaveCount(0);
    expect(await idle.evaluate((c) => c.isConnected)).toBe(false);
    await show(youtube);
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.hide());
    await visibility(true);
    await expect(youtube.locator(backend)).toHaveCount(0);
    await visibility(false);
    await show(youtube);
    const ending = (await youtube.locator(backend).elementHandle())!;
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.destroy());
    await expect(youtube.locator(backend)).toHaveCount(0);
    await expect
      .poll(() => ending.evaluate((c: HTMLCanvasElement) => c.getContext('webgl2')!.isContextLost()))
      .toBe(true);
    expect((await stats(youtube)).errors).toEqual([]);
  } finally {
    await youtube.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      (globalThis as any).__modelRuntime.destroy();
    });
  }
});
