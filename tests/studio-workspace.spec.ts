import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const overlay = '#web-world-themes-decorations', images = `${overlay} [data-image-id]`;
async function open(popup: Page, page: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await page.bringToFront(); await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toHaveAttribute('data-inpage', '');
  return panel;
}

test('one live workspace imports, directly moves, groups, masks and saves without a second window', async ({ context, popup, youtube }, info) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); const pages = context.pages().length;
  const panel = await open(popup, youtube); expect(context.pages().length).toBe(pages);
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-studio-layout', 'reserved');
  await expect(panel.locator('.inspector-pane')).toBeVisible(); await expect(panel.locator('.layers-pane')).toBeVisible();
  await expect(panel.getByLabel('画像のX位置', { exact: true })).toBeVisible(); await expect(panel.getByLabel('画像のX位置', { exact: true })).toBeDisabled();
  await panel.getByLabel('画像素材を追加').setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
  await expect(youtube.locator(images)).toHaveCount(3); await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click(); await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click(); await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  const first = youtube.locator(images).first(), before = (await first.boundingBox())!;
  await youtube.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await youtube.mouse.down();
  await youtube.mouse.move(before.x + before.width / 2 - 35, before.y + before.height / 2 + 20, { steps: 8 }); await youtube.mouse.up();
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 35, 2);
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click(); await panel.getByLabel('円形マスクを使う', { exact: true }).check();
  await panel.getByLabel('光の半径', { exact: true }).fill('180');
  await expect(youtube.locator(`${overlay} .group-content`)).toHaveCSS('mask-image', /radial-gradient/);
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await youtube.screenshot({ path: info.outputPath('inpage-1366.png') });
  await youtube.setViewportSize({ width: 1920, height: 1080 }); await youtube.screenshot({ path: info.outputPath('inpage-1920.png') });
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  await expect(panel).toHaveCount(0); await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-inpage-studio', '');
  await expect(youtube.locator('ytd-app')).toHaveCSS('margin-left', '0px');
});
