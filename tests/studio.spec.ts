import path from 'node:path';
import type { Page, BrowserContext, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import type { DesignDocument } from '../src/design/types';

const overlay = '#web-world-themes-decorations', images = `${overlay} [data-image-id]`, key = 'webWorldThemes.design.youtube';
async function launch(context: BrowserContext, popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await youtube.bringToFront();
  const opened = context.waitForEvent('page');
  await popup.locator('#creator-studio-open').evaluate((button: HTMLButtonElement) => button.click());
  const studio = await opened; await studio.setViewportSize({ width: 1440, height: 900 });
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toBeVisible();
  return { studio, panel };
}
async function importImages(panel: Locator, youtube: Page, count = 3) {
  await panel.getByLabel('画像素材を追加').setInputFiles(Array(count).fill(path.resolve('tests/fixtures/motion/petal.png')));
  await expect(youtube.locator(images)).toHaveCount(count);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
}
async function save(panel: Locator) { await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.status')).toHaveText('保存しました。'); }
async function stored(popup: Page) { return popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key); }

test('standalone Studio edits a real extension target using shared grouping, effects, history and direct selection', async ({ context, popup, youtube }, info) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await expect(panel.locator('.layers-pane')).toBeVisible(); await expect(panel.locator('.inspector-pane')).toBeVisible();
  await importImages(panel, youtube);
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  const first = youtube.locator(images).first(), before = (await first.boundingBox())!;
  await youtube.bringToFront();
  await youtube.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await youtube.mouse.down();
  await youtube.mouse.move(before.x + before.width / 2 - 30, before.y + before.height / 2 + 15, { steps: 8 }); await youtube.mouse.up();
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 2);
  await expect(panel.getByLabel('グループのX位置', { exact: true })).not.toHaveValue('0');
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x, 2);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 2);
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check(); await panel.getByLabel('光の半径', { exact: true }).fill('180');
  await expect.poll(() => youtube.locator(`${overlay} .group-content`).evaluate((node: HTMLElement) => node.style.maskImage)).toContain('180px');
  await panel.getByLabel('動画の一時停止で隠す', { exact: true }).check();
  await save(panel); const saved = await stored(popup); expect(saved.schemaVersion).toBe(7); expect(saved.groups?.[0]?.effects?.[0]).toMatchObject({ radiusPx: 180 });
  await studio.screenshot({ path: info.outputPath('studio-workspace.png') });
  // Quick editing shares the selected group and same Undo stack.
  await youtube.locator('#web-world-themes-studio-link button').first().click();
  const quick = youtube.getByRole('dialog', { name: 'デザインエディター' }); await expect(quick.locator('.selected-count')).toHaveText('1個選択中');
  await quick.getByRole('button', { name: 'グループを解除', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中'); await expect(panel.locator('[data-kind="group"]')).toHaveCount(0);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click(); await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0); await expect(quick).toHaveCount(0); await expect(youtube.locator('#web-world-themes-studio-link')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});

test('target and Studio reload restore unsaved assets, selection, Undo and workspace without saving the artwork', async ({ context, popup, youtube }) => {
  const { studio, panel } = await launch(context, popup, youtube); await importImages(panel, youtube, 1);
  const originalId = await panel.locator('[data-layer-id]').getAttribute('data-layer-id');
  await panel.getByLabel('レイヤー名', { exact: true }).fill('未保存の花'); await panel.getByLabel('レイヤー名', { exact: true }).press('Tab');
  await panel.getByRole('button', { name: '左右を入れ替える', exact: true }).click();
  await panel.getByRole('separator', { name: 'パネルの幅', exact: true }).focus(); await studio.keyboard.press('ArrowRight');
  await expect.poll(async () => ({ count: await popup.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith('webWorldThemes.studio.session.')).length), error: await studio.locator('.recovery-status').textContent() })).toEqual({ count: 1, error: '' });
  await youtube.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 15_000 });
  await expect(youtube.locator(images)).toHaveCount(1); await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('未保存の花');
  expect(await stored(popup)).toBeUndefined();
  await studio.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(panel).toHaveAttribute('data-ww-dock', 'left');
  await expect(panel).toHaveCSS('--panel-width', '340px');
  await expect(panel.locator('[data-layer-id]')).toHaveAttribute('data-layer-id', originalId!);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(youtube.locator(images)).toHaveCount(0);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect(youtube.locator(images)).toHaveCount(1);
  await save(panel); await youtube.reload(); await expect(youtube.locator(images)).toHaveCount(1);
});

test('multiple targets stay isolated and a second Studio cannot edit or overwrite the active recovery checkpoint', async ({ context, popup, youtube }) => {
  const other = await context.newPage(); await other.goto('https://www.youtube.com/watch?v=fixture');
  const { studio, panel } = await launch(context, popup, youtube); await importImages(panel, youtube, 1);
  const firstTarget = await studio.getByLabel('編集するYouTubeタブ').inputValue();
  const second = await context.newPage(); await second.goto(studio.url());
  await expect(second.locator('.connection-status')).toContainText('別のStudio');
  await expect(second.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
  await expect(second.getByRole('button', { name: '画像を追加', exact: true })).toBeDisabled();
  await expect(other.locator(images)).toHaveCount(0);
  await expect.poll(() => popup.evaluate(async (target) => ((await chrome.storage.session.get(`webWorldThemes.studio.session.${target}`))[`webWorldThemes.studio.session.${target}`] as { draft?: { decorations: unknown[] } })?.draft?.decorations.length, firstTarget)).toBe(1);
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', ''); await expect(youtube.locator(images)).toHaveCount(0);
  await second.getByRole('button', { name: '接続 / 再開', exact: true }).click();
  await expect(second.locator('.connection-status')).toHaveAttribute('data-connected', 'true'); await expect(youtube.locator(images)).toHaveCount(1);
  await studio.getByRole('button', { name: '接続 / 再開', exact: true }).click(); await expect(studio.locator('.connection-status')).toContainText('別のStudio');
  const anotherTarget = await studio.getByLabel('編集するYouTubeタブ').locator('option').evaluateAll((options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== current), firstTarget);
  await studio.getByLabel('編集するYouTubeタブ').selectOption(anotherTarget!);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true'); await expect(panel.locator('.layers .layer')).toHaveCount(0);
  await importImages(panel, other, 3); await expect(youtube.locator(images)).toHaveCount(1);
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  // Explicit save from another tab warns an existing dirty session instead of replacing its preview.
  await expect(second.getByRole('dialog', { name: 'デザインエディター' }).locator('.status')).toContainText('別のタブ');
  await expect(youtube.locator(images)).toHaveCount(1);
  await second.getByRole('button', { name: '変更を破棄', exact: true }).click(); await expect(youtube.locator(images)).toHaveCount(3);
});

test('Studio and canvas shortcuts share target geometry, input guards and direct selection', async ({ context, popup, youtube }) => {
  const { studio, panel } = await launch(context, popup, youtube); await importImages(panel, youtube, 1);
  await panel.getByLabel('レイヤー名', { exact: true }).focus(); await studio.keyboard.press('Control+d'); await expect(youtube.locator(images)).toHaveCount(1);
  await panel.getByRole('button', { name: 'petal.png', exact: true }).click();
  const first = youtube.locator(images).first(), start = (await first.boundingBox())!;
  await studio.keyboard.press('Shift+ArrowRight'); await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(start.x + 10, 2);
  await studio.keyboard.press('ArrowDown'); await expect.poll(async () => (await first.boundingBox())!.y).toBeCloseTo(start.y + 1, 2);
  await studio.keyboard.press('Control+d'); await expect(youtube.locator(images)).toHaveCount(2); await expect(panel.locator('.layers .layer')).toHaveCount(2);
  await studio.keyboard.press('Control+z'); await expect(youtube.locator(images)).toHaveCount(1);
  await expect(panel.locator('.selected-count')).toHaveText('0個選択中');
  await youtube.bringToFront(); await first.click(); await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel.locator('.layer').getByRole('button', { name: 'ロック', exact: true }).click();
  await studio.keyboard.press('Delete'); await expect(youtube.locator(images)).toHaveCount(1);
  await panel.locator('.layer').getByRole('button', { name: 'ロック解除', exact: true }).click();
  await studio.keyboard.press('Escape'); await expect(panel.locator('.selected-count')).toHaveText('0個選択中');
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', '');
  const keys = await youtube.locator('html').getAttribute('data-player-key-count'); await youtube.keyboard.press('ArrowDown');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', keys ?? '0');
});

test('animation playback, groups, player anchors, SPA, scrolling and strength zero remain usable from Studio', async ({ context, popup, youtube }) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(['gif', 'webm', 'json'].map((format) => path.resolve(`tests/fixtures/motion/${format === 'webm' ? 'alpha1080' : 'petal'}.${format}`)));
  await expect(youtube.locator(images)).toHaveCount(3); await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'アニメーションの再生', exact: true })).toBeVisible();
  await panel.getByLabel('アニメーションを再生', { exact: true }).uncheck(); await expect(youtube.locator(`${overlay} video`)).toHaveJSProperty('paused', true);
  await panel.getByLabel('再生速度', { exact: true }).fill('1.5'); await panel.getByLabel('アニメーションを再生', { exact: true }).check();
  await expect(youtube.locator(`${overlay} video`)).toHaveJSProperty('playbackRate', 1.5);
  await youtube.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click()); await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await expect.poll(async () => (await youtube.locator(`${overlay} video`).boundingBox())!.x).toBeGreaterThan(0);
  await youtube.evaluate(() => window.scrollTo(0, 200));
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('viewport');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click(); await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click(); await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check(); await save(panel);
  expect((await stored(popup)).decorations.map((layer) => layer.kind)).toEqual(['animation', 'animation', 'animation']);
  await youtube.reload(); await expect(youtube.locator(images)).toHaveCount(3); await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await popup.locator('#effect-strength').fill('0');
  await expect(youtube.locator(overlay)).toHaveCount(0); await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
});

test('the authenticated Port rejects stale revisions and unrecognized commands without changing the draft', async ({ context, popup, youtube, extensionId }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  // A Studio extension document supplies the real MV3 sender origin; no page-script bridge exists.
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/studio/index.html`);
  await expect(control.locator('.connection-status')).toHaveAttribute('data-connected', 'true'); await control.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
  const result = await control.evaluate(async () => {
    const tabs = await chrome.tabs.query({}), probe = 'web-world-themes:studio-probe'; let target: number | undefined;
    for (const tab of tabs) if (tab.id !== undefined) { try { if ((await chrome.tabs.sendMessage(tab.id, { type: probe }))?.siteId === 'youtube') target = tab.id; } catch { /* Unsupported tabs never receive editing commands. */ } }
    const port = chrome.tabs.connect(target!, { name: 'web-world-themes:studio-v1' }); let serial = 0;
    const request = (body: Record<string, unknown>) => new Promise<Record<string, any>>((resolve) => { const id = ++serial; const listener = (message: Record<string, any>) => { if (message.type === 'reply' && message.id === id) { port.onMessage.removeListener(listener); resolve(message); } }; port.onMessage.addListener(listener); port.postMessage({ id, ...body }); });
    const attached = await request({ type: 'attach', owner: 'studio-protocol-test' }), initial = attached.state;
    const changed = await request({ type: 'command', session: initial.sessionId, revision: initial.revision, command: { type: 'snap', value: true } });
    const stale = await request({ type: 'command', session: initial.sessionId, revision: initial.revision, command: { type: 'style', style: { backgroundColor: '#123456' } } });
    const unsafe = await request({ type: 'command', session: changed.state.sessionId, revision: changed.state.revision, command: { type: 'execute', script: 'alert(1)' } });
    const output = { attached: attached.ok, snap: changed.state.view.snapping, stale: stale.ok, unsafe: unsafe.ok, document: unsafe.state.document, before: initial.document }; port.disconnect(); return output;
  });
  expect(result).toMatchObject({ attached: true, snap: true, stale: false, unsafe: false }); expect(result.document).toEqual(result.before);
});
