import { test, expect } from './fixtures';
import { vrmFixture } from './helpers/vrm-fixture';
import type { DesignDocument } from '../src/design/types';
import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  await panel.locator('.select-all').click(); await panel.locator('.group-layers').click(); await panel.getByLabel('円形マスクを使う', { exact: true }).check(); await expect(youtube.locator('#web-world-themes-decorations .group-content')).toHaveCSS('mask-image', /radial-gradient/);
  await panel.getByLabel('グループの不透明度', { exact: true }).fill('0'); await expect.poll(() => media.first().locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBe(1);
  await youtube.waitForTimeout(100); const frozen = await media.first().getAttribute('data-vrm-pose'); await youtube.waitForTimeout(100); expect(await media.first().getAttribute('data-vrm-pose')).toBe(frozen);
  await panel.locator('.undo').click(); await expect.poll(() => media.first().locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(1);
  await youtube.reload(); await expect(media).toHaveCount(2); await expect(media.first()).toHaveAttribute('data-renderer', 'three');
  expect(await youtube.locator('#web-world-themes-decorations [data-image-id]').first().evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
});

function largeVrmFixture() {
  const raw = vrmFixture(), json = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString()), bin = raw.subarray(28 + raw.readUInt32LE(12)), size = 33 * 1024 * 1024;
  json.buffers[0].byteLength = size;
  const text = Buffer.from(JSON.stringify(json)), header = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]), padded = Buffer.alloc(28 + header.length + size);
  padded.writeUInt32LE(0x46546c67); padded.writeUInt32LE(2, 4); padded.writeUInt32LE(padded.length, 8); padded.writeUInt32LE(header.length, 12); padded.writeUInt32LE(0x4e4f534a, 16); header.copy(padded, 20); padded.writeUInt32LE(size, 20 + header.length); padded.writeUInt32LE(0x004e4942, 24 + header.length); bin.copy(padded, 28 + header.length);
  return padded;
}

for (const large of [false, true]) test(`standalone Studio imports a ${large ? '33MiB' : 'small'} original VRM and references without duplicating the stored asset`, async ({ popup, youtube, context }, info) => {
  // SwiftShader CI covers rendering with the small original rig. Large imports
  // also stress browser memory/readback and require an explicitly opted-in real
  // GPU run: WW_REAL_GPU_VRM=1 npm run test:e2e -- tests/vrm-editor.spec.ts
  test.skip(large && process.env.WW_REAL_GPU_VRM !== '1', '33MiB VRM rendering requires WW_REAL_GPU_VRM=1 and a real GPU; SwiftShader uses the small fixture.');
  if (large) {
    test.setTimeout(60000);
    const renderer = await youtube.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl')!, debug = gl.getExtension('WEBGL_debug_renderer_info')!;
      const name = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)); gl.getExtension('WEBGL_lose_context')?.loseContext(); return name;
    });
    expect(renderer, 'Opt-in large VRM test must use a real GPU.').not.toMatch(/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i);
  }
  const file = info.outputPath(large ? 'original-padded.vrm' : 'original-small.vrm'); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, large ? largeVrmFixture() : vrmFixture());
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro'); await youtube.bringToFront();
  const opened = context.waitForEvent('page'); await popup.locator('#creator-studio-open').evaluate((b: HTMLButtonElement) => b.click()); const studio = await opened; await studio.setViewportSize({ width: 1440, height: 1000 }); await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.locator('#web-world-themes-creator'); await panel.locator('.model-file').setInputFiles(file); const media = youtube.locator('#web-world-themes-decorations .model-media'); await expect(media).toHaveAttribute('data-renderer', 'three', large ? { timeout: 40000 } : {});
  await panel.locator('.duplicate-image').click(); await expect(media).toHaveCount(2); await expect(media.last()).toHaveAttribute('data-renderer', 'three'); await panel.locator('.save').click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const saved = await popup.evaluate(async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'] as DesignDocument); expect(saved.decorations[0]!.assetId).toBe(saved.decorations[1]!.assetId);
  await youtube.reload(); await expect(media.first()).toHaveAttribute('data-renderer', 'three', large ? { timeout: 30000 } : {}); await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
});
