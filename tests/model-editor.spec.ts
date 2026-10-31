import { test, expect } from './fixtures';
import { closeEditorPages, openEditor } from './helpers/editor';
import { exposeEditorControls, withCanvas, beginCanvasGesture } from './helpers/editor-workspace';
import { modelFixture } from './helpers/model-fixture';
import type { DesignDocument } from '../src/design/types';
import type { ModelEvaluation } from '../src/world/models';
const overlay = '#web-world-themes-decorations';

test('GLB renders alpha, shares resources, edits/drags/duplicates/undoes, saves and restores original asset', async ({
  popup,
  youtube,
  context,
}) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  const { panel } = await openEditor(popup, youtube);
  await exposeEditorControls(panel);
  await panel
    .locator('.model-file')
    .setInputFiles({ name: 'Rig.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  const alpha = await media.locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let filled = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) filled++;
    return { corner: d[3], filled };
  });
  expect(alpha.corner).toBe(0);
  expect(alpha.filled).toBeGreaterThan(100);
  const center = await media
    .locator('canvas')
    .evaluate((c: HTMLCanvasElement) => [
      ...c.getContext('2d')!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data,
    ]);
  expect(center[1]).toBeGreaterThan(100);
  expect(center[0]).toBeLessThan(10);
  expect(center[2]).toBeLessThan(10); // Embedded green texture, not just the purple material factor.
  await panel.getByLabel('3D回転Y', { exact: true }).fill('35');
  await panel.getByLabel('3D回転Y', { exact: true }).press('Tab');
  await panel.getByLabel('画像のX位置', { exact: true }).fill('65');
  const image = youtube.locator(`${overlay} [data-image-id]`);
  const before = await image.boundingBox();
  await withCanvas(youtube, async () => {
    await beginCanvasGesture(image);
    await youtube.mouse.move(before!.x + before!.width / 2 - 80, before!.y + before!.height / 2 + 50, { steps: 6 });
    await youtube.mouse.up();
  });
  expect((await image.boundingBox())!.x).toBeCloseTo(before!.x - 80, 0);
  await panel.locator('.duplicate-image').click();
  await expect(media).toHaveCount(2);
  await expect(media.last()).toHaveAttribute('data-renderer', 'three');
  const stats = () => youtube.locator(overlay).evaluate((h: HTMLElement) => JSON.parse(h.dataset.wwModelStats!));
  expect(await stats()).toMatchObject({ contexts: 1, assets: 1, instances: 2 });
  await panel.locator('.undo').click();
  await expect(media).toHaveCount(1);
  await panel.locator('.redo').click();
  await expect(media).toHaveCount(2);
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const saved = await popup.evaluate(
    async () =>
      (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
        'webWorldThemes.design.youtube'
      ] as DesignDocument,
  );
  expect(saved.schemaVersion).toBe(13);
  expect(saved.decorations[0]).toMatchObject({ kind: 'model3d', model: { rotationY: 35 } });
  expect(saved.decorations[0]!.assetId).toBe(saved.decorations[1]!.assetId);
  await closeEditorPages(youtube);
  await youtube.reload();
  await expect(media.first()).toHaveAttribute('data-renderer', 'three', { timeout: 20000 });
  expect(
    await youtube
      .locator(`${overlay} [data-image-id]`)
      .first()
      .evaluate((e) => getComputedStyle(e).pointerEvents),
  ).toBe('none');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(context.serviceWorkers().length).toBeGreaterThan(0);
});

test('arbitrary clips animate pixels, pause, crossfade, change speed and preserve playback settings', async ({
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  const { panel } = await openEditor(popup, youtube);
  await exposeEditorControls(panel);
  await panel
    .locator('.model-file')
    .setInputFiles({ name: 'Motion.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveAttribute('data-renderer', 'three');
  expect(await panel.getByLabel('3Dクリップ', { exact: true }).locator('option').allTextContents()).toContain(
    'Stride · 2.00s',
  );
  const pose = () => media.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const first = await pose();
  await expect.poll(pose).not.toBe(first);
  const state = () => media.evaluate((m: HTMLElement) => JSON.parse(m.dataset.modelFrame!) as ModelEvaluation);
  await panel.getByText('3Dアニメーションを再生', { exact: true }).uncheck();
  await expect(media).toHaveAttribute('data-playback', 'paused');
  const stopped = await state();
  await youtube.waitForTimeout(100);
  expect(await state()).toEqual(stopped);
  await panel.getByLabel('3Dクロスフェード', { exact: true }).fill('2000');
  await panel.getByLabel('3Dクロスフェード', { exact: true }).press('Tab');
  await panel.getByText('3Dアニメーションを再生', { exact: true }).check();
  await panel.getByLabel('3Dクリップ', { exact: true }).selectOption('2');
  await expect.poll(async () => (await state()).clip).toBe(2);
  const transition = await state();
  expect(transition.previousClip).toBe(0);
  expect(transition.blend).toBeLessThan(1);
  await panel.getByLabel('3D再生速度', { exact: true }).fill('1.5');
  await panel.getByLabel('3D再生速度', { exact: true }).press('Tab');
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await youtube.reload();
  await expect(media).toHaveAttribute('data-playback', 'playing');
  await expect.poll(async () => (await state()).clip).toBe(2);
  const saved = await popup.evaluate(
    async () =>
      (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
        'webWorldThemes.design.youtube'
      ] as DesignDocument,
  );
  expect(saved.decorations[0]).toMatchObject({ model: { clip: 2, speed: 1.5, crossFadeMs: 2000, inPlace: true } });
});

test('selected head bone adds a bounded look to the paused animated pose and OFF restores its pixels', async ({
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  const { panel } = await openEditor(popup, youtube);
  await exposeEditorControls(panel);
  await panel
    .locator('.model-file')
    .setInputFiles({ name: 'Look.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveAttribute('data-playback', 'playing');
  await panel.locator('[data-model="playing"]').uncheck();
  await expect(media).toHaveAttribute('data-playback', 'paused');
  const pixels = () => media.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL()),
    initial = await pixels();
  await panel.locator('.model-look summary').click();
  await panel.getByLabel('視線ボーン', { exact: true }).selectOption('3');
  await panel.locator('[data-model="look.enabled"]').check();
  await withCanvas(youtube, () => youtube.mouse.move(850, 230));
  const pose = () => media.evaluate((m: HTMLElement) => JSON.parse(m.dataset.modelFrame!) as ModelEvaluation);
  await expect.poll(async () => Math.abs((await pose()).lookYaw)).toBeGreaterThan(10);
  expect(Math.abs((await pose()).lookYaw)).toBeLessThanOrEqual(50);
  await expect.poll(pixels).not.toBe(initial);
  await panel.locator('[data-model="look.enabled"]').uncheck();
  await expect.poll(async () => (await pose()).lookYaw).toBe(0);
  await expect.poll(pixels).toBe(initial);
});

test('optional glTF node names are not required for cloned rig animation', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  const { panel } = await openEditor(popup, youtube);
  await panel.locator('.model-file').setInputFiles({
    name: 'Unnamed.glb',
    mimeType: 'model/gltf-binary',
    buffer: modelFixture((j) => {
      j.nodes.forEach((n: { name?: string }) => {
        delete n.name;
      });
    }),
  });
  const media = youtube.locator(`${overlay} .model-media`);
  await expect(media).toHaveAttribute('data-playback', 'playing');
  const pixels = () => media.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL()),
    first = await pixels();
  await expect.poll(pixels).not.toBe(first);
});
