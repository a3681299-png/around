import path from 'node:path';
import { showArtwork } from './helpers/artwork';
import { mkdir } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { closeEditorPages, openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';
import { createTakeSampler, type SignalTake } from '../src/world/takes';

test('mouse-driven X/rotation lanes edit offsets, custom ranges and curves with Undo and reload', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  let { panel } = await openEditor(popup, youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.locator('.timeline-toggle').click();
  await panel.getByLabel('キーの対象プロパティ').selectOption('position.x');
  await panel.getByLabel('駆動元シグナル').selectOption('mouse-x');
  await panel.locator('.timeline-connect').click();
  await expect(panel.locator('.timeline-key')).toHaveCount(2);
  await panel.locator('[data-key-id="key-end"]').click();
  await panel.locator('.timeline-key-value').fill('300');
  await panel.locator('.timeline-key-value').press('Tab');
  await panel.locator('.timeline-key-value').fill('350');
  await panel.locator('.timeline-key-value').press('Tab');
  await panel.locator('.undo').click();
  await expect(panel.locator('.timeline-key-value')).toHaveValue('300');
  await panel.getByLabel('入力範囲の終了').fill('150');
  await panel.getByLabel('入力範囲の終了').press('Tab');
  await panel.locator('.undo').click();
  await expect(panel.getByLabel('入力範囲の終了')).toHaveValue('100');
  await panel.getByLabel('キーの対象プロパティ').selectOption('rotation');
  await panel.getByLabel('駆動元シグナル').selectOption('layer-distance');
  await panel.locator('.timeline-connect').click();
  await panel.getByLabel('キーの対象プロパティ').selectOption('position.x');
  await expect(panel.locator('.timeline-key-value')).toHaveValue('');
  await panel.locator('[data-key-id="key-end"]').click();
  await expect(panel.locator('.timeline-key-value')).toHaveValue('300');
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const design = await popup.evaluate(
    async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'] as DesignDocument,
  );
  expect(design.signalRules).toHaveLength(2);
  expect(design.decorations[0]!.placement.rotationDeg).toBe(0);
  await panel.locator('.take-live').click();
  await youtube.mouse.move(650, 380);
  const image = youtube.locator('#around-decorations .image');
  await expect
    .poll(() => image.evaluate((node: HTMLElement) => Number.parseFloat(node.style.left)))
    .toBeCloseTo(design.decorations[0]!.placement.x * 1100 - 200 + (650 * 500) / 1100, 3);
  await mkdir('.work/verification', { recursive: true });
  await panel.screenshot({ path: '.work/verification/signal-v2-key-editor.png' });
  // The editor closes with the reload, as before; then it is opened again on the saved work.
  await closeEditorPages(youtube);
  await youtube.reload();
  ({ panel } = await openEditor(popup, youtube));
  await panel.locator('.layer [data-action="select"]').click();
  await panel.getByLabel('キーの対象プロパティ').selectOption('rotation');
  await expect(panel.getByLabel('駆動元シグナル')).toHaveValue('layer-distance');
  await expect(panel.locator('.timeline-key')).toHaveCount(2);
});

test('GIF/image group pursuit with a shared mask records full history, replays/seeks, isolates input and reloads artwork/take', async ({
  popup,
  youtube,
}) => {
  await showArtwork(popup);
  let { panel } = await openEditor(popup, youtube);
  await panel
    .getByLabel('画像素材を追加')
    .setInputFiles(Array(2).fill(path.resolve('tests/fixtures/motion/petal.png')));
  await expect(panel.locator('.layer')).toHaveCount(2);
  await expect(panel.locator('.add-animation')).toBeEnabled();
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.gif'));
  await expect(panel.locator('.layer')).toHaveCount(3);
  await panel.locator('.select-all').click();
  await panel.locator('.group-layers').click();
  await panel.getByLabel('レイヤーのマウス追跡').check();
  await panel.getByLabel('円形マスクを使う').check();
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const design = await popup.evaluate(
    async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'] as DesignDocument,
  );
  await panel.locator('.timeline-toggle').click();
  await panel.locator('.take-record').click();
  await expect(panel.locator('.signal-timeline')).toHaveAttribute('data-recording', '');
  for (const p of [
    [420, 220],
    [570, 320],
    [400, 440],
    [560, 500],
    [450, 250],
  ]) {
    await youtube.mouse.move(p[0]!, p[1]!, { steps: 8 });
    await youtube.waitForTimeout(70);
  }
  await panel.locator('.take-stop').click();
  await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
  await expect(panel.locator('.take-pointer-x')).toHaveCount(1);
  await expect(panel.locator('.take-pointer-y')).toHaveCount(1);
  await panel.locator('.take-store').click();
  await expect(panel.locator('.take-saved')).toHaveText('テイク保存済み');
  const takes = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: 'around:signal-takes', action: 'list', siteId: 'youtube' })).value as {
        id: string;
      }[],
  );
  const take = await popup.evaluate(
    async (id) =>
      (
        await chrome.runtime.sendMessage({
          type: 'around:signal-takes',
          action: 'get',
          siteId: 'youtube',
          id,
        })
      ).value as SignalTake,
    takes[0]!.id,
  );
  expect(take.inputs.length).toBeGreaterThan(25);
  expect(take.inputs.some((input) => input.signals.pointerTimeMs !== undefined)).toBe(true);
  const sampler = createTakeSampler(design, take),
    sample = take.inputs[Math.floor(take.inputs.length / 2)]!,
    at = sample.timeMs - take.inputs[0]!.timeMs;
  const expected = sampler.at(at).frame.layout.groups[0]!,
    p = expected.layer.placement,
    frame = expected.frame!;
  const composition = youtube.locator('#around-decorations .composition');
  const position = () =>
    composition.evaluate((node: HTMLElement) => ({
      x: Number.parseFloat(node.style.left),
      y: Number.parseFloat(node.style.top),
      transform: node.style.transform,
    }));
  await panel.locator('.take-position').fill(String(at / 1000));
  await panel.locator('.take-position').press('Tab');
  await expect.poll(async () => (await position()).x).toBeCloseTo(frame.left + frame.width * p.x - p.widthPx / 2, 3);
  const paused = await position();
  await youtube.mouse.move(610, 600);
  await youtube.waitForTimeout(100);
  expect(await position()).toEqual(paused);
  await panel.locator('.take-position').fill('0');
  await panel.locator('.take-position').press('Tab');
  await panel.locator('.take-position').fill(String(at / 1000));
  await panel.locator('.take-position').press('Tab');
  await expect.poll(position).toEqual(paused);
  await panel.screenshot({ path: '.work/verification/signal-v2-motion-take.png' });
  // The editor closes with the reload, as before; then it is opened again on the saved work.
  await closeEditorPages(youtube);
  await youtube.reload();
  ({ panel } = await openEditor(popup, youtube));
  await panel.locator('.take-library-select').selectOption(take.id);
  await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
  await panel.locator('.take-position').fill(String(at / 1000));
  await panel.locator('.take-position').press('Tab');
  await expect.poll(position).toEqual(paused);
  await panel.locator('.take-live').click();
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator('#around-decorations')).toHaveCount(0);
});
