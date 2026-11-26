import path from 'node:path';
import { showArtwork } from './helpers/artwork';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';

const overlay = '#around-decorations',
  images =
    ':is(#around-decorations, #around-video-decorations, #around-page-decorations, #around-atmosphere-decorations) [data-image-id]';
async function open(popup: Page, page: Page) {
  await showArtwork(popup);
  await expect(page.locator('[data-around-surface~="video-card"]').first()).toBeVisible();
  // UI0-d round 3: the in-page Studio's workbench is the editor page's own (its window).
  return (await openEditor(popup, page)).panel;
}

test('tools preserve native playback/navigation and numeric scrubbing is one cancellable Undo step', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 900 });
  const panel = await open(popup, youtube);
  await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  await youtube.locator('[data-around-surface~="video-card"]').first().click();
  expect(new URL(youtube.url()).pathname).toBe('/');
  await panel.getByLabel('背景色を変更', { exact: true }).check();
  await panel.getByLabel('背景色', { exact: true }).fill('#123456');
  await expect(youtube.locator('[data-around-surface~="video-card"]').first()).toHaveCSS(
    'background-color',
    'rgb(18, 52, 86)',
  );
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
  await youtube.locator('[data-around-surface~="video-card"]').first().locator('a').first().click();
  await expect(youtube.locator('#movie_player')).toBeVisible();
  await youtube.locator('#movie_player [aria-label="Play"]').click();
  await expect(youtube.locator('#movie_player video')).toHaveJSProperty('paused', false);
  const keys = Number((await youtube.locator('html').getAttribute('data-player-key-count')) ?? 0);
  await youtube.keyboard.press('ArrowRight');
  expect(Number(await youtube.locator('html').getAttribute('data-player-key-count'))).toBeGreaterThan(keys);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(panel.getByRole('button', { name: '選択・変形', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const width = panel.getByLabel('画像の幅', { exact: true }),
    label = width.locator('..');
  // Import publishes its selection before the final asset lease finishes. Raw
  // pointer gestures need the same enabled check that fill/click provide.
  await expect(width).toBeEnabled();
  await label.scrollIntoViewIfNeeded();
  // UI0-d round 3: the panel is the editor page's; its pointer and keys are that page's.
  const editor = panel.page();
  const before = Number(await width.inputValue()),
    box = (await label.boundingBox())!;
  await editor.mouse.move(box.x + 5, box.y + box.height / 2);
  await editor.mouse.down();
  await editor.mouse.move(box.x + 25, box.y + box.height / 2, { steps: 10 });
  await editor.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20);
  const newBox = (await label.boundingBox())!;
  await editor.mouse.move(newBox.x + 5, newBox.y + newBox.height / 2);
  await editor.mouse.down();
  await editor.mouse.move(newBox.x + 35, newBox.y + newBox.height / 2, { steps: 8 });
  await editor.keyboard.press('Escape');
  await editor.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBe(before + 20);
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await panel.getByLabel('レイヤー名', { exact: true }).fill('v h c');
  await expect(panel.getByRole('button', { name: '選択・変形', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
  await editor.keyboard.press('Control+z');
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel
    .locator('.studio-menu-item > summary')
    .filter({ hasText: /^編集$/ })
    .click();
  await editor.keyboard.press('ArrowDown');
  await expect(panel.getByRole('menuitem', { name: '元に戻す', exact: true })).toBeFocused();
  await editor.keyboard.press('Escape');
  await expect(panel.locator('.studio-menu-item[open]')).toHaveCount(0);
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
});

test('all current animation kinds use the live panels, inherited locks, groups, masks and save/discard', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 900 });
  await youtube.locator('#navigate').click();
  const panel = await open(popup, youtube);
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles(
      ['petal.gif', 'petal.apng', 'petal.webp', 'alpha1080.webm', 'petal.json'].map((name) =>
        path.resolve('tests/fixtures/motion', name),
      ),
    );
  await expect(youtube.locator(images)).toHaveCount(5);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await expect(panel.locator('.layer[data-kind="animation"]')).toHaveCount(5);
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click();
  await panel.getByLabel('再生速度', { exact: true }).fill('1.5');
  await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('playbackRate', 1.5);
  await panel.getByLabel('アニメーションを再生', { exact: true }).uncheck();
  await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('paused', true);
  await panel.getByLabel('アニメーションを再生', { exact: true }).check();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(panel.getByRole('button', { name: '選択をグループ化', exact: true })).toBeDisabled();
  await expect(panel.locator('.grouping-help')).toContainText(/基準/);
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('viewport');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('.playback-section')).not.toBeVisible();
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check();
  await expect(youtube.locator(overlay + ' .group-content')).toHaveCSS('mask-image', /radial-gradient/);
  const group = panel.locator('.layer[data-kind="group"]');
  await group.locator('[data-action="lock"]').click();
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click();
  await expect(panel.getByLabel('画像の幅', { exact: true })).toBeDisabled();
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(images)).toHaveCount(5);
  await group.locator('[data-action="lock"]').click();
  const oldVideo = await youtube.locator(overlay + ' video').elementHandle();
  await group.locator('[data-action="visible"]').click();
  await expect(youtube.locator(overlay + ' video')).toHaveCount(0);
  await expect.poll(() => oldVideo!.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await group.locator('[data-action="visible"]').click();
  await expect(youtube.locator(overlay + ' video')).toHaveJSProperty('playbackRate', 1.5);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByLabel('画像の幅', { exact: true }).fill('250');
  await expect(panel.locator('.dirty')).toHaveText('未保存');
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(panel.getByLabel('画像の幅', { exact: true })).not.toHaveValue('250');
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  await youtube.reload();
  await expect(youtube.locator(images)).toHaveCount(5);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
});

test('ending immediately after resizing flushes the final workspace preference without changing artwork', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 900 });
  const panel = await open(popup, youtube);
  await panel.evaluate((host) => {
    const shadow = host.shadowRoot!;
    shadow
      .querySelector('.resize-right')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    shadow.querySelector<HTMLButtonElement>('.close')!.click();
  });
  // UI0-d round 3: the editor page stays; ending the edit ends it on the page.
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
  await expect
    .poll(() =>
      popup.evaluate(
        async () => (await chrome.storage.local.get('around.studio.workbench.v2'))['around.studio.workbench.v2'],
      ),
    )
    .toMatchObject({ rightWidth: 340 });
  expect(
    await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'],
    ),
  ).toBeUndefined();
  const reopened = await open(popup, youtube);
  await expect(reopened).toHaveCSS('--inspector-width', '340px');
  await reopened.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(reopened.getByRole('button', { name: '編集を終了', exact: true })).toHaveAttribute(
    'title',
    /未保存の変更を破棄/,
  );
});
