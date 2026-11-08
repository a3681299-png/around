import path from 'node:path';
import { showArtwork } from './helpers/artwork';
import { readFile } from 'node:fs/promises';
import type { Page, BrowserContext, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import type { DesignDocument } from '../src/design/types';
import { observeImports, uploadLeases, type StudioImportProbe } from './helpers/studio-import';
import { unpackCheckpoint } from '../src/studio/checkpoint-codec';
import { createStudioStateDecoder } from '../src/studio/state-sync';
import type { StudioMessage } from '../src/studio/protocol';
import type { EditorRevision, EditorSnapshot } from '../src/editor-core/types';
import { beginCanvasGesture } from './helpers/editor-workspace';

const overlay = '#web-world-themes-decorations',
  presentation =
    ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
  images = `${presentation} [data-image-id]`,
  key = 'webWorldThemes.design.youtube';
async function launch(context: BrowserContext, popup: Page, youtube: Page) {
  await showArtwork(popup);
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await youtube.bringToFront();
  const opened = context.waitForEvent('page');
  await popup.locator('#creator-editor-window').evaluate((button: HTMLButtonElement) => button.click());
  const studio = await opened;
  await studio.setViewportSize({ width: 1440, height: 900 });
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  const panel = studio.getByRole('dialog', { name: 'デザインエディター' });
  await expect(panel).toBeVisible();
  return { studio, panel };
}
async function importImages(panel: Locator, youtube: Page, count = 3) {
  await panel
    .getByLabel('画像素材を追加')
    .setInputFiles(Array(count).fill(path.resolve('tests/fixtures/motion/petal.png')));
  await expect(youtube.locator(images)).toHaveCount(count);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
}
async function stored(popup: Page) {
  return popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
}

test('reopening Studio after save ignores a checkpoint from before that save', async ({ context, popup, youtube }) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await importImages(panel, youtube, 1);
  const recoveryKey = 'webWorldThemes.studio.session.' + new URL(studio.url()).searchParams.get('target');
  const readRecovery = () => popup.evaluate(async (key) => (await chrome.storage.session.get(key))[key], recoveryKey);
  await expect.poll(async () => unpackCheckpoint(await readRecovery())?.draft.decorations[0]?.name).toBe('petal.png');
  const beforeSave = await readRecovery();
  const name = panel.getByLabel('レイヤー名', { exact: true });
  await name.fill('保存した花');
  await name.press('Tab');
  await save(panel);
  const origin = unpackCheckpoint(beforeSave)?.origin;
  const savedThrough = await popup.evaluate(async () => {
    const key = 'webWorldThemes.studio.savedThrough.youtube';
    return (await chrome.storage.local.get(key))[key] as EditorRevision;
  });
  expect(savedThrough).toMatchObject({ sessionId: origin?.sessionId, revision: expect.any(Number) });
  expect(savedThrough.revision).toBeGreaterThan(origin!.revision);
  await studio.close();
  // Reproduce the checkpoint left behind when the Studio page disappears before
  // the debounced write, even though the artwork save has completed.
  await popup.evaluate(({ key, value }) => chrome.storage.session.set({ [key]: value }), {
    key: recoveryKey,
    value: beforeSave,
  });
  await youtube.reload();
  const reopened = await launch(context, popup, youtube);
  await expect(reopened.panel.getByRole('button', { name: '保存した花', exact: true })).toBeVisible();
  await expect(reopened.panel.locator('.dirty')).toHaveText('保存済み');
  expect((await stored(popup)).decorations[0]?.name).toBe('保存した花');
});

for (const decision of ['restore', 'keep saved'] as const)
  test(`a draft and a different saved artwork require an explicit recovery choice: ${decision}`, async ({
    context,
    popup,
    youtube,
  }, info) => {
    const { studio, panel } = await launch(context, popup, youtube);
    await importImages(panel, youtube, 1);
    await save(panel);
    const name = panel.getByLabel('レイヤー名', { exact: true });
    await name.fill('未保存の花');
    await name.press('Tab');
    const target = Number(new URL(studio.url()).searchParams.get('target'));
    const recoveryKey = 'webWorldThemes.studio.session.' + target;
    const readRecovery = () => popup.evaluate(async (key) => (await chrome.storage.session.get(key))[key], recoveryKey);
    await expect
      .poll(async () => unpackCheckpoint(await readRecovery())?.draft.decorations[0]?.name)
      .toBe('未保存の花');
    await studio.close();

    const other = await context.newPage();
    await other.goto('https://www.youtube.com/watch?v=other-recovery-target');
    const second = await launch(context, popup, other);
    await second.panel.getByRole('button', { name: 'petal.png', exact: true }).click();
    const secondName = second.panel.getByLabel('レイヤー名', { exact: true });
    await secondName.fill('別タブで保存した花');
    await secondName.press('Tab');
    await save(second.panel);
    await second.studio.close();
    // One choice uses the detached live session, the other a checkpoint
    // after the YouTube document and its in-memory editor have gone away.
    if (decision === 'keep saved') await youtube.reload();

    const reopened = await launch(context, popup, youtube);
    const choice = reopened.studio.getByRole('region', { name: '作業中のコピーの復旧' });
    await expect(choice).toBeVisible();
    await expect(reopened.panel.getByRole('button', { name: '別タブで保存した花', exact: true })).toBeVisible();
    expect(unpackCheckpoint(await readRecovery())?.draft.decorations[0]?.name).toBe('未保存の花');
    await expect(reopened.panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    if (decision === 'keep saved') {
      await reopened.studio.screenshot({ path: info.outputPath('recovery-choice.png') });
      await reopened.studio.close();
      await youtube.reload();
      const again = await launch(context, popup, youtube);
      const options = again.studio.getByRole('region', { name: '作業中のコピーの復旧' });
      await expect(options).toBeVisible();
      await options.getByRole('button', { name: '保存済みの作品を使う' }).click();
      await expect(options).toBeHidden();
      await expect
        .poll(async () => unpackCheckpoint(await readRecovery())?.draft.decorations[0]?.name)
        .toBe('別タブで保存した花');
      await again.studio.close();
      await youtube.reload();
      const final = await launch(context, popup, youtube);
      await expect(final.studio.getByRole('region', { name: '作業中のコピーの復旧' })).toBeHidden();
      await expect(final.panel.locator('.dirty')).toHaveText('保存済み');
      expect((await stored(popup)).decorations[0]?.name).toBe('別タブで保存した花');
      return;
    }
    await choice.getByRole('button', { name: '作業中のコピーを復元' }).click();
    await expect(choice).toBeHidden();
    await expect(reopened.panel.getByRole('button', { name: '未保存の花', exact: true })).toBeVisible();
    expect((await stored(popup)).decorations[0]?.name).toBe('別タブで保存した花');
    await expect(reopened.panel.locator('.dirty')).toHaveText('未保存');
  });

test('Studio uploads small files directly, sends only asset IDs and preserves saved history', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await observeImports(studio);
  await importImages(panel, youtube, 1);
  await expect.poll(() => uploadLeases(popup)).toEqual([]);
  const probe = await studio.evaluate(() => (globalThis as any).__studioImportProbe as StudioImportProbe);
  expect(probe.portImports).toHaveLength(1);
  expect(probe.portImports[0]).toMatchObject({ type: 'import-assets', assets: [expect.stringMatching(/^asset-/)] });
  expect(probe.portImports[0]!.keys.sort()).toEqual(['assets', 'id', 'revision', 'session', 'type']);
  expect(probe.uploads.map((entry) => entry.action)).toContain('studio-transfer-authorize');
  expect(probe.uploads.map((entry) => entry.action)).toContain('studio-transfer-confirm');
  expect(probe.uploads.map((entry) => entry.action)).not.toContain('import');
  expect(probe.nativeTransfers).toEqual([{ bytes: expect.any(Number), detached: true }]);
  await panel.locator('.undo').click();
  await expect(youtube.locator(images)).toHaveCount(0);
  await panel.locator('.redo').click();
  await expect(youtube.locator(images)).toHaveCount(1);
  await save(panel);
  await youtube.reload();
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
});

for (const action of ['disconnect', 'switch target'] as const)
  test(`Studio releases its stored upload when interrupted by ${action}`, async ({ context, popup, youtube }) => {
    const other = await context.newPage();
    await other.goto('https://www.youtube.com/watch?v=other-import-target');
    const { studio, panel } = await launch(context, popup, youtube);
    await observeImports(studio, true);
    await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await expect.poll(() => studio.evaluate(() => (globalThis as any).__studioImportProbe.stored)).toBe(true);
    expect(await uploadLeases(popup)).toHaveLength(1);
    if (action === 'disconnect') {
      await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
      await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
    } else {
      const select = studio.getByLabel('編集するYouTubeタブ'),
        current = await select.inputValue();
      const target = await select
        .locator('option')
        .evaluateAll(
          (options, previous) =>
            options.map((option) => (option as HTMLOptionElement).value).find((id) => id && id !== previous),
          current,
        );
      expect(target).toBeTruthy();
      await select.selectOption(target!);
      await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    }
    // Cleanup must finish even while the upload reply is still held in Studio.
    await expect.poll(() => uploadLeases(popup)).toEqual([]);
    await studio.evaluate(() => (globalThis as any).__studioImportProbe.resume());
    await expect.poll(() => uploadLeases(popup)).toEqual([]);
    expect(await studio.evaluate(() => (globalThis as any).__studioImportProbe.portImports)).toEqual([]);
    await expect(youtube.locator(images)).toHaveCount(0);
    await expect(other.locator(images)).toHaveCount(0);
  });

test('standalone Studio edits a real extension target using shared grouping, effects, history and direct selection', async ({
  context,
  popup,
  youtube,
}, info) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await expect(panel.locator('.layers-pane')).toBeVisible();
  await expect(panel.locator('.inspector-pane')).toBeVisible();
  await importImages(panel, youtube);
  for (const row of await panel.locator('[data-layer-id]').all()) {
    await row.locator('[data-action="select"]').click();
    await panel.getByLabel('画像のX位置', { exact: true }).fill('65');
  }
  await panel
    .locator('.layer')
    .last()
    .getByRole('button', { name: 'petal.png', exact: true })
    .click({ button: 'right' });
  await expect(panel.getByRole('menu', { name: 'レイヤーの操作' })).toBeVisible();
  await panel.getByRole('menuitem', { name: '複製', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(4);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(3);
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  const first = youtube.locator(images).first(),
    before = (await first.boundingBox())!;
  await youtube.bringToFront();
  await beginCanvasGesture(first);
  await youtube.mouse.move(before.x + before.width / 2 - 30, before.y + before.height / 2 + 15, { steps: 8 });
  await youtube.mouse.up();
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 2);
  await expect(panel.getByLabel('グループのX位置', { exact: true })).not.toHaveValue('0');
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x, 2);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 2);
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check();
  await panel.getByLabel('光の半径', { exact: true }).fill('180');
  await expect
    .poll(() => youtube.locator(`${overlay} .group-content`).evaluate((node: HTMLElement) => node.style.maskImage))
    .toContain('180px');
  await panel.getByLabel('動画の一時停止で隠す', { exact: true }).check();
  await save(panel);
  const saved = await stored(popup);
  expect(saved.schemaVersion).toBe(18);
  expect(saved.groups?.[0]?.effects?.[0]).toMatchObject({ radiusPx: 180 });
  await studio.screenshot({ path: info.outputPath('studio-workspace.png') });
  // The page says the edit is in a separate window and offers only ending it (UI0-d: the quick
  // editor it used to open is gone); nothing else of the editor stands on the page.
  const badge = youtube.locator('#web-world-themes-studio-link');
  await expect(badge).toContainText('別ウィンドウで編集中');
  await expect(badge.getByRole('button')).toHaveText(['編集を終了']);
  await expect(youtube.locator('#web-world-themes-creator')).toHaveCount(0);
  await panel.getByRole('button', { name: 'グループを解除', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(0);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});

test('target and Studio reload restore unsaved assets, selection, Undo and workspace without saving the artwork', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await importImages(panel, youtube, 1);
  const originalId = await panel.locator('[data-layer-id]').getAttribute('data-layer-id');
  await panel.getByLabel('レイヤー名', { exact: true }).fill('未保存の花');
  await panel.getByLabel('レイヤー名', { exact: true }).press('Tab');
  await panel.getByRole('button', { name: '左右を入れ替える', exact: true }).click();
  await panel.getByRole('separator', { name: 'パネルの幅', exact: true }).focus();
  await studio.keyboard.press('ArrowRight');
  await expect
    .poll(async () => ({
      count: await popup.evaluate(
        async () =>
          Object.keys(await chrome.storage.session.get(null)).filter((key) =>
            key.startsWith('webWorldThemes.studio.session.'),
          ).length,
      ),
      error: await studio.locator('.recovery-status').textContent(),
    }))
    .toEqual({ count: 1, error: '' });
  await youtube.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 15_000 });
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('未保存の花');
  expect(await stored(popup)).toBeUndefined();
  await studio.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(panel).toHaveAttribute('data-ww-dock', 'left');
  await expect(panel).toHaveCSS('--panel-width', '340px');
  await expect(panel.locator('[data-layer-id]')).toHaveAttribute('data-layer-id', originalId!);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(0);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(1);
  await save(panel);
  await youtube.reload();
  await expect(youtube.locator(images)).toHaveCount(1);
});

test('multiple targets stay isolated and a second Studio cannot edit or overwrite the active recovery checkpoint', async ({
  context,
  popup,
  youtube,
}) => {
  const other = await context.newPage();
  await other.goto('https://www.youtube.com/watch?v=fixture');
  const { studio, panel } = await launch(context, popup, youtube);
  await importImages(panel, youtube, 1);
  const firstTarget = await studio.getByLabel('編集するYouTubeタブ').inputValue();
  const second = await context.newPage();
  await second.goto(studio.url());
  await expect(second.locator('.connection-status')).toContainText('別のエディター');
  await expect(second.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
  await expect(second.getByRole('button', { name: '画像を追加', exact: true })).toBeDisabled();
  await expect(other.locator(images)).toHaveCount(0);
  await expect
    .poll(async () => {
      const value: unknown = await popup.evaluate(
        async (target) =>
          (await chrome.storage.session.get(`webWorldThemes.studio.session.${target}`))[
            `webWorldThemes.studio.session.${target}`
          ],
        firstTarget,
      );
      return unpackCheckpoint(value)?.draft.decorations.length;
    })
    .toBe(1);
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', '');
  await expect(youtube.locator(images)).toHaveCount(0);
  await second.getByRole('button', { name: '接続 / 再開', exact: true }).click();
  await expect(second.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(youtube.locator(images)).toHaveCount(1);
  await studio.getByRole('button', { name: '接続 / 再開', exact: true }).click();
  await expect(studio.locator('.connection-status')).toContainText('別のエディター');
  const anotherTarget = await studio
    .getByLabel('編集するYouTubeタブ')
    .locator('option')
    .evaluateAll(
      (options, current) =>
        options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== current),
      firstTarget,
    );
  await studio.getByLabel('編集するYouTubeタブ').selectOption(anotherTarget!);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await expect(panel.locator('.layers .layer')).toHaveCount(0);
  await importImages(panel, other, 3);
  await expect(youtube.locator(images)).toHaveCount(1);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  // Explicit save from another tab warns an existing dirty session instead of replacing its preview.
  await expect(second.getByRole('dialog', { name: 'デザインエディター' }).locator('.status')).toContainText('別のタブ');
  await expect(youtube.locator(images)).toHaveCount(1);
  await second.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(3);
});

test('Studio and canvas shortcuts share target geometry, input guards and direct selection', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await importImages(panel, youtube, 1);
  await panel.getByLabel('レイヤー名', { exact: true }).focus();
  await studio.keyboard.press('Control+d');
  await expect(youtube.locator(images)).toHaveCount(1);
  await panel.getByRole('button', { name: 'petal.png', exact: true }).click();
  const first = youtube.locator(images).first(),
    start = (await first.boundingBox())!;
  await studio.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(start.x + 10, 2);
  await studio.keyboard.press('ArrowDown');
  await expect.poll(async () => (await first.boundingBox())!.y).toBeCloseTo(start.y + 1, 2);
  await studio.keyboard.press('Control+d');
  await expect(youtube.locator(images)).toHaveCount(2);
  await expect(panel.locator('.layers .layer')).toHaveCount(2);
  await studio.keyboard.press('Control+z');
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(panel.locator('.selected-count')).toHaveText('0個選択中');
  await youtube.bringToFront();
  // Click the image where it is on top: native YouTube content (a comment avatar on the fixture)
  // can lie over part of it, and a click there is the page's own.
  const box = (await first.boundingBox())!;
  const position = await first.evaluate((image, box) => {
    const host = image.getRootNode() instanceof ShadowRoot ? (image.getRootNode() as ShadowRoot).host : image;
    for (let y = 0.2; y < 1; y += 0.2)
      for (let x = 0.2; x < 1; x += 0.2) {
        const top = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
        if (top === host || top === image) return { x: box.width * x, y: box.height * y };
      }
    return undefined;
  }, box);
  expect(position, 'some part of the image is on top').toBeDefined();
  await first.click({ position: position! });
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await expect(panel.getByLabel('レイヤー名', { exact: true })).toHaveValue('petal.png');
  await panel.locator('.layer').getByRole('button', { name: 'ロック', exact: true }).click();
  await studio.keyboard.press('Delete');
  await expect(youtube.locator(images)).toHaveCount(1);
  await panel.locator('.layer').getByRole('button', { name: 'ロック解除', exact: true }).click();
  await studio.keyboard.press('Escape');
  await expect(panel.locator('.selected-count')).toHaveText('0個選択中');
  await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', '');
  const keys = await youtube.locator('html').getAttribute('data-player-key-count');
  await youtube.keyboard.press('ArrowDown');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', keys ?? '0');
});

test('animation playback, groups, player anchors, SPA, scrolling and strength zero remain usable from Studio', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles(
      ['gif', 'webm', 'json'].map((format) =>
        path.resolve(`tests/fixtures/motion/${format === 'webm' ? 'alpha1080' : 'petal'}.${format}`),
      ),
    );
  await expect(youtube.locator(images)).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'alpha1080.webm', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'アニメーションの再生', exact: true })).toBeVisible();
  await panel.getByLabel('アニメーションを再生', { exact: true }).uncheck();
  await expect(youtube.locator(`${overlay} video`)).toHaveJSProperty('paused', true);
  await panel.getByLabel('再生速度', { exact: true }).fill('1.5');
  await panel.getByLabel('アニメーションを再生', { exact: true }).check();
  await expect(youtube.locator(`${overlay} video`)).toHaveJSProperty('playbackRate', 1.5);
  await youtube.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await expect.poll(async () => (await youtube.locator(`${presentation} video`).boundingBox())!.x).toBeGreaterThan(0);
  await youtube.evaluate(() => window.scrollTo(0, 200));
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('viewport');
  await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByLabel('円形マスクを使う', { exact: true }).check();
  await save(panel);
  expect((await stored(popup)).decorations.map((layer) => layer.kind)).toEqual(['animation', 'animation', 'animation']);
  await youtube.reload();
  await expect(youtube.locator(images)).toHaveCount(3);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
});

test('the authenticated Port rejects stale revisions and unrecognized commands without changing the draft', async ({
  context,
  popup,
  youtube,
  extensionId,
}) => {
  await showArtwork(popup);
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  // A Studio extension document supplies the real MV3 sender origin; no page-script bridge exists.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/studio/index.html`);
  await expect(control.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await control.getByRole('button', { name: '接続を解除', exact: true }).click();
  await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
  const decoder = createStudioStateDecoder();
  await control.exposeFunction('decodeStudioTestMessage', (message: StudioMessage) =>
    message.type === 'state' || message.type === 'reply' ? decoder.accept(message)?.state : undefined,
  );
  const result = await control.evaluate(
    async (base64) => {
      const tabs = await chrome.tabs.query({}),
        probe = 'web-world-themes:studio-probe';
      let target: number | undefined;
      for (const tab of tabs)
        if (tab.id !== undefined) {
          try {
            if ((await chrome.tabs.sendMessage(tab.id, { type: probe }))?.siteId === 'youtube') target = tab.id;
          } catch {
            /* Unsupported tabs never receive editing commands. */
          }
        }
      const port = chrome.tabs.connect(target!, { name: 'web-world-themes:studio-v1' });
      let serial = 0;
      let current: EditorSnapshot | undefined;
      let messages: Promise<void> = Promise.resolve();
      const pending = new Map<number, (message: Record<string, any>) => void>();
      const decode = (
        globalThis as unknown as {
          decodeStudioTestMessage(message: StudioMessage): Promise<EditorSnapshot | undefined>;
        }
      ).decodeStudioTestMessage;
      port.onMessage.addListener((message: StudioMessage) => {
        messages = messages.then(async () => {
          const next = await decode(message);
          if (next) current = next;
          if (message.type === 'reply') {
            pending.get(message.id)?.({ ...message, state: current });
            pending.delete(message.id);
          }
        });
      });
      const request = (body: Record<string, unknown>) =>
        new Promise<Record<string, any>>((resolve) => {
          const id = ++serial;
          pending.set(id, resolve);
          port.postMessage({ id, ...body });
        });
      const attached = await request({ type: 'attach', owner: 'studio-protocol-test' }),
        initial = attached.state;
      const changed = await request({
        type: 'command',
        session: initial.sessionId,
        revision: initial.revision,
        command: { type: 'snap', value: true },
      });
      const stale = await request({
        type: 'command',
        session: initial.sessionId,
        revision: initial.revision,
        command: { type: 'style', style: { backgroundColor: '#123456' } },
      });
      const unsafe = await request({
        type: 'command',
        session: changed.state.sessionId,
        revision: changed.state.revision,
        command: { type: 'execute', script: 'alert(1)' },
      });
      const legacyImport = await request({
        type: 'import',
        session: changed.state.sessionId,
        revision: changed.state.revision,
        files: [{ name: 'legacy.png', mime: 'image/png', base64 }],
      });
      // UI skin art arrives only as stored asset IDs for a known slot; nothing else is accepted.
      const skinSlot = await request({
        type: 'import-skin',
        session: changed.state.sessionId,
        revision: changed.state.revision,
        assets: ['asset-' + '0'.repeat(64)],
        slot: 'background',
      });
      const skinIds = await request({
        type: 'import-skin',
        session: changed.state.sessionId,
        revision: changed.state.revision,
        assets: ['javascript:alert(1)'],
        slot: 'normal',
      });
      const skinInline = await request({
        type: 'import-skin',
        session: changed.state.sessionId,
        revision: changed.state.revision,
        files: [{ name: 'skin.png', mime: 'image/png', base64 }],
        slot: 'normal',
      });
      const output = {
        attached: attached.ok,
        snap: changed.state.view.snapping,
        stale: stale.ok,
        unsafe: unsafe.ok,
        skin: [skinSlot.ok, skinIds.ok, skinInline.ok],
        skinErrors: [skinSlot.error, skinIds.error, skinInline.error],
        legacyImport: legacyImport.ok,
        legacyError: legacyImport.error,
        document: legacyImport.state.document,
        before: initial.document,
      };
      port.disconnect();
      return output;
    },
    (await readFile(path.resolve('tests/fixtures/motion/petal.png'))).toString('base64'),
  );
  expect(result).toMatchObject({ attached: true, snap: true, stale: false, unsafe: false, legacyImport: false });
  expect(result.legacyError).toBe('エディターの操作に対応していません。');
  expect(result.skin).toEqual([false, false, false]);
  expect(result.skinErrors).toEqual(['着せ替えの差し込み口が不正です。', '素材IDが不正です。', '素材IDが不正です。']);
  expect(result.document).toEqual(result.before);
});

test('a file read started before transport loss cannot import into the reconnected session; a closed target stops retries', async ({
  context,
  popup,
  youtube,
}) => {
  const { studio, panel } = await launch(context, popup, youtube);
  await studio.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        (globalThis as any).__releaseStudioRead = () => {
          File.prototype.arrayBuffer = original;
          return original.call(this).then(resolve, reject);
        };
      });
    };
  });
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect.poll(() => studio.evaluate(() => typeof (globalThis as any).__releaseStudioRead)).toBe('function');
  await youtube.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await studio.evaluate(() => (globalThis as any).__releaseStudioRead());
  // A new import completes after the old read in the serial command queue.
  await panel.getByLabel('画像素材を追加').setInputFiles({
    name: '接続後.png',
    mimeType: 'image/png',
    buffer: await readFile(path.resolve('tests/fixtures/motion/petal.png')),
  });
  await expect(panel.getByRole('button', { name: '接続後.png', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(panel.locator('.layers .layer')).toHaveCount(1);
  await youtube.close();
  await expect(studio.locator('.connection-status')).toContainText('閉じられました');
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
});
