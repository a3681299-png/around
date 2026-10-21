import { build } from 'esbuild';
import { test, expect } from './fixtures';
import { modelFixture } from './helpers/model-fixture';
import { vrmFixture } from './helpers/vrm-fixture';

for (const kind of ['glb', 'vrm'] as const) {
  test(`${kind} parsing, postprocessing and initial pose/render preserve the verified original buffer`, async ({
    youtube,
  }) => {
    const bundle = await build({
      entryPoints: ['tests/helpers/model-runtime.ts'],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'ModelRuntimeTest',
    });
    await youtube.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await youtube.bringToFront();
    const bytes = kind === 'glb' ? modelFixture() : vrmFixture();
    const before = await youtube.evaluate(async (bytes) => {
      const runtime = ((globalThis as any).__modelRuntime = (globalThis as any).ModelRuntimeTest.mount(bytes));
      const digest = await runtime.digest();
      runtime.show();
      return digest;
    }, Array.from(bytes));
    await expect(youtube.locator('#model-runtime-test .model-media')).toHaveAttribute('data-renderer', 'three');
    expect(await youtube.evaluate(() => (globalThis as any).__modelRuntime.digest())).toEqual(before);
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.hide());
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.show());
    await expect(youtube.locator('#model-runtime-test .model-media')).toHaveAttribute('data-renderer', 'three');
    expect(await youtube.evaluate(() => (globalThis as any).__modelRuntime.digest())).toEqual(before);
    expect(await youtube.evaluate(() => (globalThis as any).__modelRuntime.stats().errors)).toEqual([]);
    await youtube.evaluate(() => (globalThis as any).__modelRuntime.destroy());
  });
}
