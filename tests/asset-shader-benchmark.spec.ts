import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';

test('opt-in shader investigation compares actual program cache keys before and after the first pose', async () => {
  test.skip(
    process.env.AROUND_SHADER_BENCH !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit physical-GPU and private original measurement, with the profiling build.',
  );
  test.setTimeout(300_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-c3-shader-')), false, {
    headed: true,
    width: 1920,
    height: 1080,
  });
  const results: Record<string, any>[] = [];
  await mkdir('.work/verification', { recursive: true });
  try {
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const item = page.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await page.goto(`chrome-extension://${id}/diagnostics/asset-benchmark.html`);
    await page.locator('#file').setInputFiles(process.env.AROUND_VRM_FILE!);
    await page.bringToFront();
    // Alternate ordering across rounds; each trial creates a fresh WebGL context.
    for (let round = 0; round < 5; round++)
      for (const phase of round % 2 ? ['after-pose', 'before-player'] : ['before-player', 'after-pose']) {
        const value = await page.evaluate(
          (phase) => (globalThis as any).aroundAssetBench.run('direct', 'compile', phase),
          phase,
        );
        expect(value.alphaPixels).toBeGreaterThan(1000);
        expect(value.stats.checkShaderErrors).toBe(true);
        const inventory = value.stats.programInventory;
        const prepared = inventory.preparation as { id: number; cacheKey: string }[],
          rendered = inventory.firstRender as { id: number; cacheKey: string }[];
        const added = rendered.filter((p) => !prepared.some((q) => p.cacheKey === q.cacheKey));
        const result = {
          round: round + 1,
          phase,
          totalMs: value.totalMs,
          preparation: value.stats.preparation,
          firstRenderApi: value.stats.firstRenderApi,
          programs: inventory,
          addedPrograms: added,
          alphaPixels: value.alphaPixels,
          checkShaderErrors: value.stats.checkShaderErrors,
          backend: value.stats.backend,
          spans: value.spans.filter((s: { id: string }) => s.id === value.trace),
        };
        results.push(result);
        console.log(
          'SHADER_BENCHMARK ' +
            JSON.stringify({
              round: round + 1,
              phase,
              totalMs: value.totalMs,
              prepared: prepared.length,
              rendered: rendered.length,
              added: added.length,
              infoLog: value.stats.firstRenderApi.getProgramInfoLog,
            }),
        );
        await writeFile('.work/verification/asset-shaders.json', JSON.stringify(results, null, 2));
      }
  } finally {
    await context.close();
  }
});
