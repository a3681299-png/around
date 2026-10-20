import path from 'node:path';
import { test, expect } from './fixtures';

test('signal space keys edit with mouse/numbers, one-step drag history, key-only Delete, locks, save and reload', async ({
  context,
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.bringToFront();
  await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  const panel = youtube.locator('#web-world-themes-creator');
  await expect(panel).toBeVisible();
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.locator('.timeline-toggle').click();
  await panel.locator('.timeline-connect').click();
  await expect(panel.locator('.timeline-key')).toHaveCount(3);
  await expect(panel.locator('.opacity-value')).toHaveText('スクロールに接続');
  await panel.locator('.take-record').focus();
  await youtube.keyboard.press('Space');
  await expect(panel.locator('.signal-timeline')).toHaveAttribute('data-recording', '');
  await panel.locator('.take-stop').click();
  await expect(panel.locator('.take-source')).toHaveText('PREVIEW');
  await panel.locator('.timeline-view').selectOption('signal');
  await panel.locator('.take-live').click();
  const middle = panel.locator('.timeline-key[data-key-id="key-middle"]');
  await middle.click();
  await panel.getByLabel('キーの不透明度', { exact: true }).fill('80');
  await panel.getByLabel('キーの不透明度', { exact: true }).press('Tab');
  await panel.getByLabel('キーから次への補間', { exact: true }).selectOption('ease-in-out');
  const box = (await middle.boundingBox())!,
    canvas = (await panel.locator('.timeline-canvas').boundingBox())!;
  await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await youtube.mouse.down();
  await youtube.mouse.move(box.x + box.width / 2 + (canvas.width - 44) * 0.1, box.y + box.height / 2 + 18, {
    steps: 8,
  });
  await youtube.mouse.up();
  await expect(panel.getByLabel('キーのスクロール進捗', { exact: true })).toHaveValue(/^(59|60|61)/);
  await panel.locator('.undo').click();
  await expect(panel.getByLabel('キーのスクロール進捗', { exact: true })).toHaveValue('50');
  await expect(panel.getByLabel('キーの不透明度', { exact: true })).toHaveValue('80');
  await panel.locator('.redo').click();
  await middle.focus();
  await youtube.keyboard.press('Delete');
  await expect(panel.locator('.timeline-key')).toHaveCount(2);
  await expect(youtube.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(1);
  await panel.locator('.undo').click();
  await expect(panel.locator('.timeline-key')).toHaveCount(3);
  await panel.locator('.layer [data-action="lock"]').click();
  await expect(panel.locator('.timeline-key').first()).toBeDisabled();
  await panel.locator('.layer [data-action="lock"]').click();
  await panel.getByLabel('タイムラインのズーム').fill('3');
  await expect
    .poll(() => panel.locator('.timeline-scroll').evaluate((node) => node.scrollWidth > node.clientWidth * 2))
    .toBe(true);
  await panel.getByRole('separator', { name: 'タイムラインの高さ', exact: true }).focus();
  await youtube.keyboard.press('ArrowUp');
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await youtube.reload();
  await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  await expect(panel.locator('.timeline-key')).toHaveCount(0);
  await panel.locator('.layer [data-action="select"]').click();
  await expect(panel.locator('.timeline-key')).toHaveCount(3);
  await expect(panel.locator('.timeline-toggle')).toHaveAttribute('aria-expanded', 'true');
  const opened = context.waitForEvent('page');
  await panel.getByRole('button', { name: '独立Studioへ切替', exact: true }).click();
  const studio = await opened;
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const remote = studio.locator('#web-world-themes-creator');
  await expect(remote.locator('.timeline-key')).toHaveCount(3);
  await remote.locator('.timeline-remove').click();
  await expect(remote.locator('.timeline-key')).toHaveCount(0);
  await remote.locator('.discard').click();
  await expect(remote.locator('.timeline-key')).toHaveCount(3);
});
