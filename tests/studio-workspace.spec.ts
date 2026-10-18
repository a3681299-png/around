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
  await youtube.reload(); await expect(youtube.locator(images)).toHaveCount(3); await open(popup, youtube);
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(1); await expect(panel.locator('.dirty')).toHaveText('保存済み');
});


test('panes resize, mirror, persist and fold into a safe narrow workspace', async ({ popup, youtube }, info) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); const panel = await open(popup, youtube);
  await expect.poll(async () => (await youtube.locator('ytd-app').boundingBox())!.width).toBe(862);
  const inspector = (await panel.locator('.inspector-pane').boundingBox())!, layers = (await panel.locator('.layers-pane').boundingBox())!;
  expect(inspector.x).toBe(layers.x); expect(inspector.y + inspector.height).toBeLessThanOrEqual(layers.y);
  expect((await panel.locator('.toolbar').boundingBox())!.height).toBe(28); expect((await panel.locator('.studio-menu').boundingBox())!.height).toBe(28);
  await panel.getByRole('separator', { name: 'パネルの幅', exact: true }).focus(); await youtube.keyboard.press('ArrowRight');
  await expect(panel).toHaveCSS('--inspector-width', '340px');
  await panel.getByRole('separator', { name: 'プロパティとレイヤーの高さ', exact: true }).focus(); await youtube.keyboard.press('ArrowDown');
  await expect(panel).toHaveCSS('--inspector-ratio', '61%');
  await panel.locator('.transform-section > summary').click();
  await panel.getByRole('button', { name: '左右を入れ替える', exact: true }).click();
  await expect.poll(async () => (await youtube.locator('ytd-app').boundingBox())!.x).toBe(344);
  await expect.poll(() => popup.evaluate(async () => (await chrome.storage.local.get('webWorldThemes.studio.workbench.v2'))['webWorldThemes.studio.workbench.v2'])).toMatchObject({ rightWidth: 340, ratio: expect.closeTo(.61), dock: 'left', folds: expect.arrayContaining([['transform-section', false]]) });
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click(); await open(popup, youtube);
  await expect(panel).toHaveCSS('--inspector-width', '340px'); await expect(panel).toHaveAttribute('data-dock-flip', '');
  await expect(panel.locator('.transform-section')).not.toHaveAttribute('open', '');
  await youtube.setViewportSize({ width: 430, height: 760 });
  await expect(panel).toHaveAttribute('data-left-closed', ''); await expect(panel).toHaveAttribute('data-right-closed', '');
  await expect(panel).not.toHaveAttribute('data-dock-flip', ''); await expect(panel.locator('.studio-inspectors')).not.toBeVisible();
  await expect.poll(async () => (await youtube.locator('ytd-app').boundingBox())!.width).toBe(390);
  await youtube.screenshot({ path: info.outputPath('inpage-narrow-folded.png') });
  await panel.getByRole('button', { name: 'プロパティとレイヤーを開閉', exact: true }).click(); await expect(panel).toHaveAttribute('data-overlay-right', '');
  await expect(panel.locator('.layers-pane')).toBeVisible(); await expect(panel.locator('.inspector-pane')).toBeVisible();
  expect(await youtube.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await panel.locator('.transform-section > summary').click();
  await youtube.screenshot({ path: info.outputPath('inpage-narrow-properties.png') });
});

test('tools preserve native playback/navigation and numeric scrubbing is one cancellable Undo step', async ({ popup, youtube }) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); const panel = await open(popup, youtube);
  await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  await youtube.locator('[data-ww-surface~="video-card"]').first().click(); expect(new URL(youtube.url()).pathname).toBe('/');
  await panel.getByLabel('背景色を変更', { exact: true }).check(); await panel.getByLabel('背景色', { exact: true }).fill('#123456');
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
  await youtube.locator('[data-ww-surface~="video-card"]').first().locator('a').first().click();
  await expect(youtube.locator('#movie_player')).toBeVisible();
  await youtube.locator('#movie_player [aria-label="Play"]').click(); await expect(youtube.locator('#movie_player video')).toHaveJSProperty('paused', false);
  const keys = Number(await youtube.locator('html').getAttribute('data-player-key-count') ?? 0);
  await youtube.keyboard.press('ArrowRight'); expect(Number(await youtube.locator('html').getAttribute('data-player-key-count'))).toBeGreaterThan(keys);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(panel.getByRole('button', { name: '選択・変形', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const width = panel.getByLabel('画像の幅', { exact: true }), label = width.locator('..'), before = Number(await width.inputValue()), box = (await label.boundingBox())!;
  await youtube.mouse.move(box.x + 5, box.y + box.height / 2); await youtube.mouse.down(); await youtube.mouse.move(box.x + 25, box.y + box.height / 2, { steps: 10 }); await youtube.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect.poll(async () => Number(await width.inputValue())).toBe(before);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20);
  const newBox = (await label.boundingBox())!; await youtube.mouse.move(newBox.x + 5, newBox.y + newBox.height / 2); await youtube.mouse.down();
  await youtube.mouse.move(newBox.x + 35, newBox.y + newBox.height / 2, { steps: 8 }); await youtube.keyboard.press('Escape'); await youtube.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20); await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await panel.getByLabel('レイヤー名', { exact: true }).fill('v h c'); await expect(panel.getByRole('button', { name: '選択・変形', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click(); await youtube.keyboard.press('Control+z'); await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel.locator('.studio-menu-item > summary').filter({ hasText: /^編集$/ }).click(); await youtube.keyboard.press('ArrowDown');
  await expect(panel.getByRole('menuitem', { name: '元に戻す', exact: true })).toBeFocused();
  await youtube.keyboard.press('Escape'); await expect(panel.locator('.studio-menu-item[open]')).toHaveCount(0); await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
});

test('fullscreen suspends authoring and help, then SPA/scroll and strength zero restore safely', async ({ popup, youtube }) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); await youtube.locator('#navigate').click();
  const player = await youtube.locator('#movie_player').elementHandle(), video = await youtube.locator('#movie_player video').elementHandle();
  const panel = await open(popup, youtube); await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await panel.getByRole('button', { name: '使い方', exact: true }).click(); await expect(panel.locator('.studio-help')).toBeVisible();
  await youtube.locator('#movie_player').evaluate((node) => node.requestFullscreen());
  await expect(youtube.locator('#web-world-themes-creator')).toHaveAttribute('data-fullscreen', ''); await expect(panel).not.toBeVisible();
  await expect(youtube.locator('#web-world-themes-creator').locator('.studio-help')).not.toHaveAttribute('open', '');
  const count = await youtube.locator(images).count(), keys = Number(await youtube.locator('html').getAttribute('data-player-key-count') ?? 0);
  await youtube.keyboard.press('Delete'); await youtube.keyboard.press('ArrowLeft'); expect(await youtube.locator(images).count()).toBe(count);
  expect(Number(await youtube.locator('html').getAttribute('data-player-key-count'))).toBeGreaterThan(keys);
  await youtube.evaluate(() => document.exitFullscreen()); await expect(panel).toBeVisible();
  expect(await player!.evaluate((node) => node === document.querySelector('#movie_player'))).toBe(true);
  expect(await video!.evaluate((node) => node === document.querySelector('#movie_player video'))).toBe(true);
  await youtube.locator('ytd-watch-flexy').evaluate((node) => node.toggleAttribute('theater', true));
  await youtube.evaluate(() => window.scrollTo(0, 150)); await expect(panel.locator('.layers-pane')).toBeVisible();
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
  await youtube.locator('ytd-masthead input').first().fill('world'); await youtube.locator('ytd-masthead input').first().press('Enter');
  await expect(youtube).toHaveURL(/results/); await expect(panel).toBeVisible(); await expect(youtube.locator(images)).toHaveCount(1);
  await popup.locator('#effect-strength').fill('0'); await expect(panel).toHaveCount(0); await expect(youtube.locator(overlay)).toHaveCount(0);
  await expect(youtube.locator('#web-world-themes-studio-layout')).toHaveCount(0); await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-inpage-studio', '');
  await expect(youtube.locator('ytd-app')).toHaveCSS('margin-left', '0px');
});

test('standalone opens the same live Core; selection, scrubbing, history and reload recovery synchronize', async ({ context, popup, youtube }) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); const inline = await open(popup, youtube);
  const opened = context.waitForEvent('page'); await popup.locator('#creator-studio-open').evaluate((button: HTMLButtonElement) => button.click()); const studio = await opened;
  await studio.setViewportSize({ width: 1440, height: 900 }); await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const remote = studio.getByRole('dialog', { name: 'デザインエディター' });
  await inline.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png')); await expect(remote.locator('.selected-count')).toHaveText('1個選択中');
  await remote.getByLabel('画像のX位置', { exact: true }).fill('45'); await expect(inline.getByLabel('画像のX位置', { exact: true })).toHaveValue('45');
  await youtube.bringToFront(); const first = youtube.locator(images).first(), box = (await first.boundingBox())!;
  await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await youtube.mouse.down(); await youtube.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 6 }); await youtube.mouse.up();
  await expect.poll(async () => Number(await remote.getByLabel('画像のX位置', { exact: true }).inputValue())).toBeGreaterThan(45);
  await remote.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(inline.getByLabel('画像のX位置', { exact: true })).toHaveValue('45');
  // Recovery checkpoint contains the active draft and shared Undo stack, never a second editor.
  await expect.poll(() => popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith('webWorldThemes.studio.session.')).length)).toBe(1);
  await youtube.reload(); await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 15_000 }); await expect(youtube.locator(images)).toHaveCount(1);
  await studio.getByRole('button', { name: 'YouTubeでStudioを開く', exact: true }).click(); await expect(inline).toBeVisible(); await expect(inline.getByLabel('画像のX位置', { exact: true })).toHaveValue('45');
  await inline.getByRole('button', { name: '保存', exact: true }).click(); await expect(remote.locator('.dirty')).toHaveText('保存済み');
});


test('all current animation kinds use the live panels, inherited locks, groups, masks and save/discard', async ({ popup, youtube }) => {
  await youtube.setViewportSize({ width: 1366, height: 900 }); await youtube.locator('#navigate').click(); const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(['petal.gif', 'petal.apng', 'petal.webp', 'alpha1080.webm', 'petal.json'].map((name) => path.resolve('tests/fixtures/motion', name)));
  await expect(youtube.locator(images)).toHaveCount(5); await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await expect(panel.locator('.layer[data-kind="animation"]')).toHaveCount(5);
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click(); await panel.getByLabel('再生速度', { exact: true }).fill('1.5');
  await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('playbackRate', 1.5);
  await panel.getByLabel('アニメーションを再生', { exact: true }).uncheck(); await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('paused', true);
  await panel.getByLabel('アニメーションを再生', { exact: true }).check(); await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click(); await expect(panel.getByRole('button', { name: '選択をグループ化', exact: true })).toBeDisabled();
  await expect(panel.locator('.grouping-help')).toContainText(/基準/);
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click(); await panel.getByLabel('配置の基準', { exact: true }).selectOption('viewport');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click(); await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('.playback-section')).not.toBeVisible(); await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check(); await expect(youtube.locator(overlay + ' .group-content')).toHaveCSS('mask-image', /radial-gradient/);
  const group = panel.locator('.layer[data-kind="group"]'); await group.locator('[data-action="lock"]').click();
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click(); await expect(panel.getByLabel('画像の幅', { exact: true })).toBeDisabled();
  await youtube.keyboard.press('Delete'); await expect(youtube.locator(images)).toHaveCount(5); await group.locator('[data-action="lock"]').click();
  const oldVideo = await youtube.locator(overlay + ' video').elementHandle();
  await group.locator('[data-action="visible"]').click(); await expect(youtube.locator(overlay + ' video')).toHaveCount(0); await expect.poll(() => oldVideo!.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await group.locator('[data-action="visible"]').click(); await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('playbackRate', 1.5);
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByLabel('画像の幅', { exact: true }).fill('250'); await expect(panel.locator('.dirty')).toHaveText('未保存の変更');
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click(); await expect(panel.getByLabel('画像の幅', { exact: true })).not.toHaveValue('250'); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click(); await youtube.reload(); await expect(youtube.locator(images)).toHaveCount(5);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator(overlay)).toHaveCount(0);
});
