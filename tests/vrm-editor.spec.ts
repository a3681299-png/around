import { test, expect } from './fixtures';
import { vrmFixture } from './helpers/vrm-fixture';
import type { DesignDocument } from '../src/design/types';
import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';

test('VRM1 renders MToon with alpha, follows the pointer, edits expressions and shares save/history/group operations', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await youtube.bringToFront(); await popup.locator('#creator-editor-open').evaluate((b: HTMLButtonElement) => b.click()); const panel = youtube.locator('#web-world-themes-creator'); await exposeEditorControls(panel);
  await panel.locator('.model-file').setInputFiles({ name: 'original.vrm', mimeType: 'model/vrm', buffer: vrmFixture() });
  const media = youtube.locator('#web-world-themes-decorations .model-media'); await expect(media).toHaveAttribute('data-renderer', 'three'); await expect(media).toHaveAttribute('data-format', 'vrm');
  const pixels = await media.locator('canvas').evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; return { corner: d[3], painted: d.filter((v, i) => i % 4 === 3 && v > 0).length }; }); expect(pixels.corner).toBe(0); expect(pixels.painted).toBeGreaterThan(100);
  const pose = () => media.first().evaluate((e: HTMLElement) => JSON.parse(e.dataset.vrmPose!)), frame = () => media.first().evaluate((e: HTMLElement) => JSON.parse(e.dataset.modelFrame!));
  const initial = await pose(); await withCanvas(youtube, async () => { await youtube.mouse.move(850, 350); await expect.poll(async () => (await frame()).lookYaw).toBeGreaterThan(1); await expect.poll(async () => JSON.stringify((await pose()).head)).not.toBe(JSON.stringify(initial.head)); });
  await panel.getByLabel('VRM表情', { exact: true }).selectOption('happy'); await panel.getByLabel('VRM表情の強さ', { exact: true }).fill('.6'); await panel.getByLabel('VRM表情の強さ', { exact: true }).press('Tab'); await expect.poll(async () => (await pose()).expressions.happy).toBe(.6);
  await panel.locator('.undo').click(); await expect(panel.getByLabel('VRM表情の強さ', { exact: true })).toHaveValue('0'); await panel.locator('.redo').click(); await expect(panel.getByLabel('VRM表情の強さ', { exact: true })).toHaveValue('0.6');
  await panel.getByLabel('3D回転Y', { exact: true }).fill('20'); await panel.getByLabel('3D回転Y', { exact: true }).press('Tab');
  await panel.locator('.duplicate-image').click(); await expect(media).toHaveCount(2); await expect(media.last()).toHaveAttribute('data-renderer', 'three');
  await panel.getByLabel('VRM表情の強さ', { exact: true }).fill('.2'); await panel.getByLabel('VRM表情の強さ', { exact: true }).press('Tab'); await expect.poll(async () => (await pose()).expressions.happy).toBe(.6); await expect.poll(() => media.last().evaluate((e: HTMLElement) => JSON.parse(e.dataset.vrmPose!).expressions.happy)).toBe(.2);
  await panel.locator('.save').click(); await expect(panel.locator('.dirty')).toHaveText('保存済み'); const saved = await popup.evaluate(async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'] as DesignDocument);
  expect(saved.schemaVersion).toBe(11); expect(saved.decorations[0]).toMatchObject({ kind: 'model3d', source: { format: 'vrm', vrm: { version: '1.0' } }, model: { rotationY: 20, look: { enabled: true }, vrm: { expressions: { happy: .6 } } } }); expect(saved.decorations[0]!.assetId).toBe(saved.decorations[1]!.assetId);
  await youtube.reload(); await expect(media).toHaveCount(2); await expect(media.first()).toHaveAttribute('data-renderer', 'three');
  expect(await youtube.locator('#web-world-themes-decorations [data-image-id]').first().evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
});
