import { test, expect } from './fixtures';
import { showArtwork } from './helpers/artwork';
import { openEditor } from './helpers/editor';
import { modelFixture } from './helpers/model-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const overlay = '#web-world-themes-decorations';

test('8 rigged models share one context/assets, respect surface budgets and suspend mixed group masks', async ({
  popup,
  youtube,
  context,
}) => {
  test.setTimeout(60000);
  await showArtwork(popup);
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.file').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator(`${overlay} img`)).toBeVisible();
  await expect(panel.locator('.add-model')).toBeEnabled();
  await panel.locator('.model-file').setInputFiles(
    Array.from({ length: 8 }, (_, n) => ({
      name: `Rig ${n + 1}.glb`,
      mimeType: 'model/gltf-binary',
      buffer: modelFixture(),
    })),
  );
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveCount(8);
  for (const item of await media.all()) await expect(item).toHaveAttribute('data-renderer', 'three');
  const stats = () => youtube.locator(overlay).evaluate((e: HTMLElement) => JSON.parse(e.dataset.wwModelStats!));
  await expect.poll(stats).toMatchObject({ contexts: 1, assets: 1, instances: 8, geometries: 1 });
  const cdp = await context.newCDPSession(youtube);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics'),
    start = performance.now();
  await youtube.waitForTimeout(4000);
  const elapsed = performance.now() - start,
    after = await cdp.send('Performance.getMetrics'),
    measured = await stats();
  const metric = (data: typeof before, name: string) => data.metrics.find((m) => m.name === name)?.value ?? 0;
  expect(measured.surfaceBytes).toBeLessThanOrEqual(16 * 1024 * 1024 + 64);
  expect(measured.paints).toBeGreaterThan(30);
  expect(measured.calls).toBe(16); // Transparent double-sided materials use two passes.
  await mkdir('.work/verification', { recursive: true });
  await writeFile(
    '.work/verification/3d-render-benchmark.json',
    JSON.stringify(
      {
        browser: context.browser()?.version(),
        fixture: 'Original 8-vertex / 12-triangle, two-bone rig, three clips, shared 1px embedded texture',
        instances: 8,
        durationMs: elapsed,
        ...measured,
        pageTaskCpuPercent: ((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 100000) / elapsed,
        jsHeapUsedBytes: metric(after, 'JSHeapUsedSize'),
        gpuNote:
          'gpuMs is a disjoint timer query when available; null means unsupported. Not GPU utilization or peak memory.',
      },
      null,
      2,
    ),
  );
  await panel.locator('.select-all').click();
  await panel.locator('.group-layers').click();
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  await panel.getByLabel('円形マスクを使う', { exact: true }).check();
  await expect(youtube.locator(`${overlay} .group-content`)).toHaveCSS('mask-image', /radial-gradient/);
  await panel.getByLabel('グループの不透明度', { exact: true }).fill('0');
  await expect
    .poll(() => media.locator('canvas').evaluateAll((cs) => cs.map((c) => (c as HTMLCanvasElement).width)))
    .toEqual(Array(8).fill(1));
  const frozen = await media.first().getAttribute('data-model-frame');
  await youtube.waitForTimeout(100);
  expect(await media.first().getAttribute('data-model-frame')).toBe(frozen);
  await panel.locator('.undo').click();
  await expect
    .poll(() =>
      media
        .first()
        .locator('canvas')
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBeGreaterThan(1);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
});

test('real WebGL loss recreates a context, deletion releases resources and Undo reuses the retained context', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.file').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator(`${overlay} img`)).toBeVisible();
  await expect(panel.locator('.add-model')).toBeEnabled();
  await panel
    .locator('.model-file')
    .setInputFiles({ name: 'Recover.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveAttribute('data-renderer', 'three');
  const backend = youtube.locator(`${overlay} [data-ww-three-backend]`),
    handle = (await backend.elementHandle())!;
  expect(
    await backend.evaluate((canvas: HTMLCanvasElement) => {
      const loss = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
      loss?.loseContext();
      return Boolean(loss);
    }),
  ).toBe(true);
  await expect.poll(() => handle.evaluate((canvas: HTMLCanvasElement) => canvas.isConnected)).toBe(false);
  await expect
    .poll(() => handle.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost()))
    .toBe(true);
  await expect(media).toHaveAttribute('data-playback', 'playing');
  const recovered = (await backend.elementHandle())!;
  await panel.locator('.delete-image').click();
  await expect(media).toHaveCount(0);
  await expect(youtube.locator(`${overlay} img`)).toBeVisible();
  await expect(backend).toHaveCount(1);
  await expect
    .poll(() => youtube.locator(overlay).evaluate((e: HTMLElement) => JSON.parse(e.dataset.wwModelStats!)))
    .toMatchObject({ contexts: 1, assets: 0, instances: 0, geometries: 0, textures: 0, programs: 0 });
  expect(await recovered.evaluate((canvas) => canvas.isConnected)).toBe(true);
  await panel.locator('.undo').click();
  await expect(media).toHaveAttribute('data-renderer', 'three');
  await expect(backend).toHaveCount(1);
  expect(await recovered.evaluate((canvas) => canvas.isConnected)).toBe(true);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
});
