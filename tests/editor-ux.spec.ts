import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';
import { beginCanvasGesture } from './helpers/editor-workspace';

// UI0-d 3.1: the editor's ease of use in its window (the workbench: both panes side by side, the
// guide in ヘルプ). The floating editor's own shell (its width, collapse, docking and low-window
// folding) went with it, and so did those checks (docs/ui0d-3.1.md).
const key = 'webWorldThemes.design.youtube',
  overlay = '#web-world-themes-decorations';
const layers = `${overlay} [data-image-id]`;
async function open(popup: Page, page: Page) {
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  return (await openEditor(popup, page)).panel;
}
/** The layer list's own thumbnails (the window's material library shows them too). */
const rowThumbnails = (panel: Locator) => panel.locator('.layers .thumbnail img');
/** ヘルプ holds the guide and the shortcut list in the window. */
async function openHelp(panel: Locator) {
  await panel.getByRole('button', { name: '使い方', exact: true }).click();
  const help = panel.getByRole('dialog', { name: 'エディターの使い方' });
  await expect(help).toBeVisible();
  return help;
}
async function add(panel: Locator, page: Page) {
  const buffers = await page.evaluate(() =>
    ['#e9a7df', '#74cbda', '#deb770'].map((color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(15, 15, 70, 70);
      return canvas.toDataURL().split(',')[1]!;
    }),
  );
  await panel.getByLabel('画像素材を追加').setInputFiles(
    buffers.map((data, i) => ({
      name: `素材${i + 1}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    })),
  );
  await expect(page.locator(layers)).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
}
async function selectThree(panel: Locator) {
  await panel.getByRole('button', { name: '選択解除', exact: true }).click();
  for (const check of await panel.locator('[data-multiselect]').all()) await check.check();
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key] as DesignDocument, key);
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
}

test('mouse-only first creation: import, check selection, group, mask, behavior, save, reload and ungroup', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube);
  await expect(panel.locator('.empty-layers')).toBeVisible();
  const help = await openHelp(panel);
  await expect(help.locator('.quick-guide')).toBeVisible();
  await help.getByRole('button', { name: 'ヘルプを閉じる', exact: true }).click();
  await expect(panel.getByRole('button', { name: '選択をグループ化', exact: true })).toBeDisabled();
  await expect(panel.locator('.grouping-help')).toContainText('2枚以上');
  await add(panel, youtube);
  // The owned canvas gesture must start outside native guide/chip columns.
  for (let i = 0; i < 3; i++) {
    await panel.getByRole('button', { name: `素材${i + 1}.png`, exact: true }).click();
    await panel.getByLabel('画像のX位置', { exact: true }).fill(String(60 + i * 10));
    await panel.getByLabel('画像のX位置', { exact: true }).press('Tab');
  }
  await selectThree(panel);
  await expect(rowThumbnails(panel)).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeInViewport();
  await youtube.screenshot({ path: info.outputPath('01-mouse-selection.png') });
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
  const first = youtube.locator(layers).first(),
    before = (await first.boundingBox())!;
  await beginCanvasGesture(first);
  await youtube.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 + 15, { steps: 8 });
  await youtube.mouse.up();
  expect((await first.boundingBox())!.x).toBeCloseTo(before.x - 40, 2);
  await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await panel.getByRole('checkbox', { name: '円形マスクを使う', exact: true }).check();
  await panel.getByLabel('光の半径', { exact: true }).fill('180');
  await panel.getByRole('checkbox', { name: 'マウスに追従', exact: true }).check();
  await panel.getByRole('checkbox', { name: '動画の一時停止で隠す', exact: true }).check();
  await expect(panel.getByLabel('画像の幅', { exact: true })).toBeHidden();
  await expect(panel.locator('.dirty')).toHaveText('未保存');
  await save(panel);
  const saved = await stored(popup);
  expect(saved.schemaVersion).toBe(14);
  expect(saved.groups?.[0]?.effects?.[0]).toMatchObject({ enabled: true, radiusPx: 180 });
  await panel.page().screenshot({ path: info.outputPath('02-group-inspector.png') });
  await youtube.reload();
  const again = await open(popup, youtube);
  await again.locator('[data-kind="group"] [data-action="select"]').click();
  await again.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
  await expect(again.getByLabel('光の半径', { exact: true })).toHaveValue('180');
  await again.getByRole('button', { name: 'グループを解除', exact: true }).click();
  await expect(again.locator('.selected-count')).toHaveText('3個選択中');
  await save(again);
  expect((await stored(popup)).decorations.map((x) => x.placement)).toEqual(saved.decorations.map((x) => x.placement));
});

test('group reasons stay visible for mixed anchors, interleaving and locks; menu preserves multi-selection', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await youtube.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click();
  await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
  await selectThree(panel);
  await expect(panel.locator('.grouping-help')).toContainText('画面基準');
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click();
  await panel.getByLabel('配置の基準').selectOption('viewport');
  await panel.getByRole('button', { name: '選択解除', exact: true }).click();
  await panel.getByLabel('素材1.pngを複数選択', { exact: true }).check();
  await panel.getByLabel('素材3.pngを複数選択', { exact: true }).check();
  await expect(panel.locator('.grouping-help')).toContainText('連続');
  await panel.getByLabel('素材2.pngを複数選択', { exact: true }).check();
  await panel.getByRole('button', { name: '素材2.png', exact: true }).click({ button: 'right' });
  await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
  await panel.getByRole('menuitem', { name: '選択をグループ化', exact: true }).click();
  const group = panel.locator('[data-kind="group"]');
  await group.getByRole('button', { name: 'ロック', exact: true }).click();
  await expect(panel.getByRole('button', { name: '画像を削除', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '複製', exact: true })).toBeDisabled();
  // Delete from the page and from the editor: the locked group stays.
  await youtube.bringToFront();
  await youtube.keyboard.press('Delete');
  await panel.page().keyboard.press('Delete');
  await expect(youtube.locator(layers)).toHaveCount(3);
  await group.getByRole('button', { name: 'ロック解除', exact: true }).click();
  await group.getByRole('button', { name: 'グループを折りたたむ' }).click();
  await expect(panel.locator('[data-parent-id]')).toHaveCount(0);
  await group.getByRole('button', { name: 'グループを展開' }).click();
  await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
});

test('renaming, typing, help and the row menu keys keep selection and page shortcuts independent', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  const editor = panel.page();
  await add(panel, youtube);
  await panel.getByRole('button', { name: '素材1.png', exact: true }).dblclick();
  await panel.getByLabel('一覧でレイヤー名を変更').fill('とても長い名前の花びらと光の装飾素材をキャンバスで使う.png');
  await panel.getByLabel('一覧でレイヤー名を変更').press('Enter');
  const row = panel.locator('[data-layer-id]').filter({ hasText: 'とても長い名前' });
  await expect(row).toHaveAttribute('title', /とても長い/);
  const selectedId = await row.getAttribute('data-layer-id');
  // Typing in a field keeps the editor's shortcuts out: Ctrl+D does not duplicate.
  await panel.getByLabel('レイヤー名', { exact: true }).fill('名前を入力中');
  await editor.keyboard.press('Control+d');
  await expect(youtube.locator(layers)).toHaveCount(3);
  await panel.getByLabel('レイヤー名', { exact: true }).press('Tab');
  const help = await openHelp(panel);
  await expect(help.getByText('Ctrl ＋ D', { exact: true })).toBeVisible();
  await help.getByRole('button', { name: 'ヘルプを閉じる', exact: true }).click();
  await panel.locator(`[data-layer-id="${selectedId}"]`).getByRole('button', { name: 'レイヤーの操作' }).click();
  await expect(panel.getByRole('menu', { name: 'レイヤーの操作' })).toBeVisible();
  await editor.keyboard.press('ArrowDown');
  await editor.keyboard.press('Escape');
  await expect(panel.getByRole('menu', { name: 'レイヤーの操作' })).toBeHidden();
  await expect(panel.locator('.selected-count')).toHaveText('1個選択中');
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
});

test('animation thumbnails are static and independent of playback; error feedback survives help', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles(
      ['gif', 'webm', 'json'].map((type) =>
        path.resolve(`tests/fixtures/motion/${type === 'webm' ? 'alpha1080' : 'petal'}.${type}`),
      ),
    );
  await expect(youtube.locator(layers)).toHaveCount(3);
  await expect(rowThumbnails(panel)).toHaveCount(3);
  await expect
    .poll(() =>
      rowThumbnails(panel).evaluateAll((nodes) =>
        nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  await expect(panel.locator('.thumbnail video, .thumbnail canvas')).toHaveCount(0);
  await expect(panel.getByRole('group', { name: 'アニメーションの再生', exact: true })).toBeVisible();
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('broken') });
  await expect(panel.locator('.status')).toHaveAttribute('role', 'alert');
  // The save chip carries the save state only; an operation error is told in the status line, and
  // read in full there or in its tooltip.
  await expect(panel.locator('.status')).toHaveAttribute('data-error', 'true');
  await expect(panel.locator('.status')).not.toBeEmpty();
  await expect(panel.locator('.dirty')).not.toContainText('保存済み');
  const help = await openHelp(panel);
  await help.getByRole('button', { name: 'ヘルプを閉じる', exact: true }).click();
  await expect(panel.locator('.status')).toHaveAttribute('data-error', 'true');
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
  await expect(youtube.locator(overlay)).toHaveCount(0);
});

test('32 layers keep one list scroll, shared thumbnails, lock protection, Undo/discard and dismissed onboarding', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube);
  await add(panel, youtube);
  await save(panel);
  const design = await stored(popup),
    source = design.decorations[0]!;
  const help = await openHelp(panel);
  await help.getByRole('button', { name: '操作ガイドを閉じる', exact: true }).click();
  await help.getByRole('button', { name: 'ヘルプを閉じる', exact: true }).click();
  await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
  design.decorations = Array.from({ length: 32 }, (_, i) => ({
    ...source,
    id: `ux-${i}`,
    name: `装飾素材 ${i + 1}`,
    zIndex: i,
    locked: i === 0,
    visible: i !== 1,
    placement: {
      ...source.placement,
      widthPx: 60,
      heightPx: 60,
      x: 0.15 + (i % 8) * 0.07,
      y: 0.3 + Math.floor(i / 8) * 0.12,
    },
  }));
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  const again = await open(popup, youtube);
  const editor = again.page();
  const againHelp = await openHelp(again);
  await expect(againHelp.locator('.quick-guide')).toBeHidden();
  await againHelp.getByRole('button', { name: 'ヘルプを閉じる', exact: true }).click();
  await again.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(again.locator('.selected-count')).toHaveText('32個選択中');
  await expect(again.locator('[data-multiselect]:checked')).toHaveCount(32);
  await expect(rowThumbnails(again)).toHaveCount(32);
  await expect(again.locator('.grouping-help')).toContainText('ロック解除');
  await again.locator('.layers').hover();
  await editor.mouse.wheel(0, 2000);
  await expect(again.getByRole('button', { name: '装飾素材 1', exact: true })).toBeInViewport();
  expect(await again.locator('.editor-body').evaluate((node) => node.scrollTop)).toBe(0);
  await expect(again.getByRole('button', { name: '元に戻す', exact: true })).toBeInViewport();
  await expect(again.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await editor.screenshot({ path: info.outputPath('04-32-layers.png') });
  await again.getByRole('button', { name: '画像を削除', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(1);
  await expect(youtube.locator(layers)).toHaveAttribute('data-image-id', 'ux-0');
  await again.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(32);
  await again.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await again.getByRole('button', { name: '画像を削除', exact: true }).click();
  await again.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(32);
  expect((await stored(popup)).decorations).toEqual(design.decorations);
  const shown = await openHelp(again);
  await shown.getByRole('button', { name: '操作ガイドをもう一度表示', exact: true }).click();
  await expect(shown.locator('.quick-guide')).toBeVisible();
});

test('dropping onto the editor places material in the visible page', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube);
  const editor = panel.page(),
    bytes = await readFile(path.resolve('tests/fixtures/motion/petal.png'));
  // A file dropped onto the window's live canvas arrives on the YouTube page, in its view.
  const canvas = (await panel.locator('.canvas-slot').boundingBox())!;
  await editor.evaluate(
    ({ data, x, y }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'panel-drop.png', { type: 'image/png' }),
      );
      document.elementFromPoint(x, y)!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: transfer,
          clientX: x,
          clientY: y,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    },
    { data: bytes.toString('base64'), x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 },
  );
  await expect(youtube.locator(layers)).toHaveCount(1);
  const image = (await youtube.locator(layers).boundingBox())!,
    view = await youtube.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(image.x).toBeGreaterThanOrEqual(0);
  expect(image.y).toBeGreaterThanOrEqual(0);
  expect(image.x + image.width).toBeLessThanOrEqual(view.width);
  expect(image.y + image.height).toBeLessThanOrEqual(view.height);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(0);
});
