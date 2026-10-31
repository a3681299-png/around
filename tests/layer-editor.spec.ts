import { exposeEditorControls, withCanvas, clickCanvas, beginCanvasGesture } from './helpers/editor-workspace';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';

const key = 'webWorldThemes.design.youtube';
const overlay = '#web-world-themes-decorations';
const images =
  ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) [data-image-id]';
const rows = '[data-layer-id]';

async function open(popup: Page, page: Page) {
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  const dialog = (await openEditor(popup, page)).panel;
  await exposeEditorControls(dialog);
  return dialog;
}
async function importOne(dialog: Locator, page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e877aa';
    context.fillRect(10, 0, 50, 40);
    return canvas.toDataURL();
  });
  await dialog
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'petal.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1]!, 'base64') });
  await expect(page.locator(images)).toHaveCount(1);
  await expect(page.locator(images).locator('img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(
    async (designKey) => (await chrome.storage.local.get(designKey))[designKey] as DesignDocument,
    key,
  );
}
async function save(dialog: Locator) {
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
}
async function seed(popup: Page, page: Page, count = 3) {
  const dialog = await open(popup, page);
  await importOne(dialog, page);
  await save(dialog);
  const doc = await stored(popup),
    original = doc.decorations[0]!;
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  doc.decorations = Array.from({ length: count }, (_, i) => ({
    ...original,
    id: `image-${i}`,
    name: `Layer ${i + 1}`,
    zIndex: i,
    placement: {
      ...original.placement,
      widthPx: 60,
      heightPx: 40,
      // Do not start a canvas gesture inside a protected native operation path.
      x: 0.52 + (i % 8) * 0.05,
      y: 0.4 + Math.floor(i / 8) * 0.12,
    },
  }));
  await popup.evaluate(async ({ designKey, design }) => chrome.storage.local.set({ [designKey]: design }), {
    designKey: key,
    design: doc,
  });
  await expect(page.locator(images)).toHaveCount(count);
  return open(popup, page);
}
const image = (page: Page, id: number) => page.locator(`${images}[data-image-id="image-${id}"]`);
const row = (dialog: Locator, id: number) => dialog.locator(`${rows}[data-layer-id="image-${id}"]`);
async function point(node: Locator) {
  const b = (await node.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, node: Locator, dx: number, dy: number) {
  await withCanvas(page, async () => {
    const p = await point(node);
    await beginCanvasGesture(node, p);
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 15 });
    await page.mouse.up();
  });
}
async function assetExists(popup: Page, id: string) {
  return popup.evaluate(
    async (assetId) =>
      (await chrome.runtime.sendMessage({ type: 'web-world-themes:assets', action: 'get', id: assetId })).ok as boolean,
    id,
  );
}

test('layer panel renames, reorders by drag, synchronizes selection, locks, duplicates and persists visibility', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube);
  await row(dialog, 0).getByRole('button', { name: 'Layer 1', exact: true }).click();
  await expect(image(youtube, 0)).toHaveAttribute('data-selected', '');
  await dialog.getByLabel('レイヤー名', { exact: true }).fill('花びら');
  await dialog.getByLabel('レイヤー名', { exact: true }).press('Tab');
  await expect(row(dialog, 0).getByRole('button', { name: '花びら', exact: true })).toBeVisible();
  await row(dialog, 0)
    .getByRole('button', { name: 'レイヤーを並び替え' })
    .dragTo(row(dialog, 2), { targetPosition: { x: 40, y: 2 } });
  await expect(dialog.locator(rows).first()).toHaveAttribute('data-layer-id', 'image-0');
  await youtube.keyboard.press('Control+z');
  await expect(dialog.locator(rows).first()).toHaveAttribute('data-layer-id', 'image-2');
  await youtube.keyboard.press('Control+Shift+z');
  await expect(dialog.locator(rows).first()).toHaveAttribute('data-layer-id', 'image-0');
  await row(dialog, 0).getByRole('button', { name: 'ロック', exact: true }).click();
  const before = await point(image(youtube, 0));
  await expect(dialog.getByLabel('画像の幅', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '画像を削除', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '複製', exact: true })).toBeDisabled();
  await youtube.keyboard.press('ArrowRight');
  await youtube.keyboard.press('Delete');
  await youtube.keyboard.press('Control+d');
  expect(await point(image(youtube, 0))).toEqual(before);
  await expect(youtube.locator(images)).toHaveCount(3);
  await row(dialog, 0).getByRole('button', { name: '非表示にする' }).click();
  await expect(image(youtube, 0)).toBeHidden();
  await save(dialog);
  await youtube.reload();
  const persisted = (await stored(popup)).decorations.find((l) => l.id === 'image-0')!;
  expect(persisted).toMatchObject({ name: '花びら', locked: true, visible: false, zIndex: 2 });
  const again = await open(popup, youtube);
  await row(again, 0).getByRole('button', { name: '表示する' }).click();
  await row(again, 0).getByRole('button', { name: 'ロック解除' }).click();
  await row(again, 0).getByRole('button', { name: '花びら', exact: true }).click();
  await again.getByRole('button', { name: '複製', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(4);
  await expect(again.locator('.selection')).toContainText('花びら コピー');
});

test('canvas Ctrl/Shift selection moves a group, nudges by pixels, duplicates, deletes, undoes and deselects', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube);
  await clickCanvas(image(youtube, 0));
  await clickCanvas(image(youtube, 1), { modifiers: ['Control'] });
  await expect(dialog.locator(`${rows}[data-selected]`)).toHaveCount(2);
  await expect(youtube.locator(`${images}[data-selected]`)).toHaveCount(2);
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  const a = await point(image(youtube, 0)),
    b = await point(image(youtube, 1));
  await drag(youtube, image(youtube, 0), 30, 25);
  expect((await point(image(youtube, 0))).x).toBeCloseTo(a.x + 30, 3);
  expect((await point(image(youtube, 1))).y).toBeCloseTo(b.y + 25, 3);
  await youtube.keyboard.press('Control+z');
  expect((await point(image(youtube, 0))).x).toBeCloseTo(a.x, 3);
  await youtube.keyboard.press('Control+y');
  await youtube.keyboard.press('ArrowRight');
  await youtube.keyboard.press('Shift+ArrowDown');
  expect((await point(image(youtube, 0))).x).toBeCloseTo(a.x + 31, 3);
  expect((await point(image(youtube, 1))).y).toBeCloseTo(b.y + 35, 3);
  await clickCanvas(image(youtube, 2), { modifiers: ['Shift'] });
  await expect(dialog.locator(`${rows}[data-selected]`)).toHaveCount(3);
  await youtube.keyboard.press('Control+d');
  await expect(youtube.locator(images)).toHaveCount(6);
  await expect(youtube.locator(`${images}[data-selected]`)).toHaveCount(3);
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(images)).toHaveCount(3);
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator(images)).toHaveCount(6);
  await youtube.keyboard.press('Escape');
  await expect(youtube.locator(`${images}[data-selected]`)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await save(dialog);
});

test('32 layers combine hidden and locked selection without moving or deleting protected layers', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 32);
  await row(dialog, 0).getByRole('button', { name: 'ロック', exact: true }).click();
  await row(dialog, 1).getByRole('button', { name: '非表示にする' }).click();
  for (const id of [0, 1, 2, 31])
    await row(dialog, id)
      .locator('[data-action="select"]')
      .click({ modifiers: ['Control'] });
  await expect(dialog.locator(`${rows}[data-selected]`)).toHaveCount(4);
  await expect(dialog.locator('.duplicate-image')).toBeDisabled();
  const locked = await point(image(youtube, 0)),
    movable = await point(image(youtube, 2)),
    last = await point(image(youtube, 31));
  await youtube.keyboard.press('Shift+ArrowRight');
  expect(await point(image(youtube, 0))).toEqual(locked);
  expect((await point(image(youtube, 2))).x).toBeCloseTo(movable.x + 10, 3);
  await drag(youtube, image(youtube, 2), 10, 15);
  expect((await point(image(youtube, 31))).y).toBeCloseTo(last.y + 15, 3);
  expect(await point(image(youtube, 0))).toEqual(locked);
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(images)).toHaveCount(29);
  await expect(image(youtube, 0)).toBeVisible();
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator(images)).toHaveCount(32);
  await save(dialog);
  const design = await stored(popup);
  expect(design.decorations[0]?.locked).toBe(true);
  expect(design.decorations[1]?.visible).toBe(false);
  expect(design.decorations[1]?.placement.x).toBe(0.5700000000000001);
  await expect(dialog.getByRole('button', { name: '元に戻す', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await youtube.screenshot({ path: '.work/verification/layer-editor-32.png' });
  // UI0-d round 3: the floating editor's last step here folded its layer list; the editor page's list
  // does not fold, so that step went with it (docs/ui0d-3.md).
});

test('optional snapping shows guides at screen/player/other layer bounds and Alt keeps free placement', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 2);
  const first = image(youtube, 0),
    other = image(youtube, 1);
  await clickCanvas(first);
  await dialog.getByRole('checkbox', { name: 'スナップを有効にする' }).check();
  const initial = await point(first);
  await withCanvas(youtube, async () => {
    await beginCanvasGesture(first, initial);
    await youtube.mouse.move(546, 432, { steps: 15 });
    expect((await point(first)).x).toBeCloseTo(550, 3);
    await expect(youtube.locator(`${overlay} [data-snap-guide="x"]:visible`)).toHaveCount(1);
    await youtube.mouse.up();
  });
  await expect(youtube.locator(`${overlay} .guide:visible`)).toHaveCount(0);
  await youtube.keyboard.press('Control+z');
  expect((await point(first)).x).toBeCloseTo(initial.x, 3);
  const secondPoint = await point(other);
  await drag(youtube, first, secondPoint.x - 60 - initial.x + 3, 110);
  expect((await first.boundingBox())!.x + 60).toBeCloseTo((await other.boundingBox())!.x, 3);
  await youtube.keyboard.press('Control+z');
  await youtube.keyboard.down('Alt');
  await drag(youtube, first, 546 - initial.x, 432 - initial.y);
  await youtube.keyboard.up('Alt');
  expect((await point(first)).x).toBeCloseTo(546, 3);
  await youtube.keyboard.press('Control+z');
  await dialog.getByRole('checkbox', { name: 'スナップを有効にする' }).uncheck();
  await drag(youtube, first, 546 - initial.x, 432 - initial.y);
  expect((await point(first)).x).toBeCloseTo(546, 3);
  // Start outside the player; pointer capture then exercises snapping *to*
  // its geometry without stealing a native player's initial pointerdown.
  await dialog.getByLabel('画像のX位置', { exact: true }).fill('90');
  await youtube.locator('#navigate').evaluate((node: HTMLButtonElement) => node.click());
  await expect(youtube).toHaveURL(/\/watch\?/);
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'スナップを有効にする' }).check();
  const player = (await youtube.locator('[data-ww-surface~="player-window"]').boundingBox())!;
  const from = await point(first),
    target = { x: player.x + player.width / 2, y: player.y + player.height / 2 };
  await drag(youtube, first, target.x - from.x + 4, target.y - from.y - 3);
  expect((await point(first)).x).toBeCloseTo(target.x, 3);
  expect((await point(first)).y).toBeCloseTo(target.y, 3);
  await save(dialog);
  const persisted = (await stored(popup)).decorations[0]!.placement;
  await youtube.reload();
  expect((await point(first)).x).toBeCloseTo(1100 * persisted.x, 3);
});

test('alignment and equal gaps filter locked/hidden layers and each undo as one operation', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 5);
  await row(dialog, 3).getByRole('button', { name: 'ロック', exact: true }).click();
  await row(dialog, 4).getByRole('button', { name: '非表示にする' }).click();
  await clickCanvas(image(youtube, 1));
  await dialog.getByLabel('画像のX位置').fill('55');
  await dialog.getByLabel('画像のY位置').fill('60');
  for (const id of [0, 2, 3, 4])
    await row(dialog, id)
      .locator('[data-action="select"]')
      .click({ modifiers: ['Control'] });
  const locked = await point(image(youtube, 3)),
    a = await point(image(youtube, 0)),
    b = await point(image(youtube, 1)),
    c = await point(image(youtube, 2));
  await dialog.getByRole('button', { name: '上揃え', exact: true }).click();
  expect((await point(image(youtube, 1))).y).toBeCloseTo(a.y, 3);
  expect(await point(image(youtube, 3))).toEqual(locked);
  await youtube.keyboard.press('Control+z');
  expect((await point(image(youtube, 1))).y).toBeCloseTo(b.y, 3);
  await dialog.getByRole('button', { name: '横に等間隔', exact: true }).click();
  expect((await point(image(youtube, 1))).x).toBeCloseTo((a.x + c.x) / 2, 3);
  await youtube.keyboard.press('Control+z');
  expect((await point(image(youtube, 1))).x).toBeCloseTo(b.x, 3);
  await youtube.keyboard.press('Control+y');
  await save(dialog);
});

test('Escape and pointer cancellation restore an in-flight drag without consuming earlier Undo history', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 1);
  const first = image(youtube, 0);
  await clickCanvas(first);
  await youtube.keyboard.press('ArrowRight');
  const afterNudge = await point(first);
  await youtube.mouse.move(afterNudge.x, afterNudge.y);
  await youtube.mouse.down();
  await youtube.mouse.move(afterNudge.x + 80, afterNudge.y + 45, { steps: 10 });
  await youtube.keyboard.press('Escape');
  await youtube.mouse.up();
  expect(await point(first)).toEqual(afterNudge);
  await expect(youtube.locator(`${images}[data-selected]`)).toHaveCount(0);
  await youtube.keyboard.press('Control+z');
  expect((await point(first)).x).toBeCloseTo(afterNudge.x - 1, 3);
  await clickCanvas(first);
  const initial = await point(first);
  await youtube.mouse.move(initial.x, initial.y);
  await youtube.mouse.down();
  await youtube.mouse.move(initial.x + 80, initial.y + 45, { steps: 10 });
  await first.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await youtube.mouse.up();
  expect(await point(first)).toEqual(initial);
  await expect(dialog).toBeVisible();
});

test('resize and rotation each undo as one gesture; save baseline and discard stay consistent', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 1);
  await clickCanvas(image(youtube, 0));
  const frame = youtube.locator(`${overlay} [data-frame-id="image-0"]`);
  const original = (await stored(popup)).decorations[0]!.placement;
  await drag(youtube, frame.getByRole('button', { name: '右下でサイズ変更' }), 60, 40);
  await youtube.keyboard.press('Control+z');
  expect(Number(await dialog.getByLabel('画像の幅', { exact: true }).inputValue())).toBe(original.widthPx);
  await youtube.keyboard.press('Control+y');
  await save(dialog);
  const resized = (await stored(popup)).decorations[0]!.placement;
  const origin = await point(image(youtube, 0)),
    grip = await point(frame.getByRole('button', { name: '画像を回転' }));
  await withCanvas(youtube, async () => {
    await beginCanvasGesture(frame.getByRole('button', { name: '画像を回転' }), grip);
    await youtube.mouse.move(origin.x + 80, origin.y, { steps: 12 });
    await youtube.mouse.up();
  });
  expect(Number(await dialog.getByLabel('画像の角度', { exact: true }).inputValue())).toBeGreaterThan(60);
  await youtube.keyboard.press('Control+z');
  expect(Number(await dialog.getByLabel('画像の角度', { exact: true }).inputValue())).toBe(0);
  await expect(dialog.locator('.dirty')).toHaveText('保存済み');
  await youtube.keyboard.press('Control+z');
  await expect(dialog.locator('.dirty')).toHaveText('未保存');
  await dialog.getByRole('button', { name: '変更を破棄', exact: true }).click();
  expect(Number(await dialog.getByLabel('画像の幅', { exact: true }).inputValue())).toBe(resized.widthPx);
  await expect(dialog.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
});

test('Undo of imports and saved deletions retains immutable asset bytes until the editor closes', async ({
  popup,
  youtube,
}) => {
  const dialog = await open(popup, youtube);
  await importOne(dialog, youtube);
  await save(dialog);
  const assetId = (await stored(popup)).decorations[0]!.assetId;
  await dialog.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(0);
  expect(await assetExists(popup, assetId)).toBe(true);
  await dialog.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(youtube.locator(images).locator('img')).toBeVisible();
  await dialog.locator('[data-layer-id] [data-action="select"]').click();
  await youtube.keyboard.press('Delete');
  await save(dialog);
  expect(await assetExists(popup, assetId)).toBe(true);
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator(images).locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(0);
  await expect.poll(() => assetExists(popup, assetId)).toBe(false);
});

test('input editing and normal YouTube keyboard events remain independent of layer shortcuts', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 1);
  await clickCanvas(image(youtube, 0));
  const before = await point(image(youtube, 0));
  await youtube.evaluate(() => {
    document.documentElement.dataset.arrowEvents = '';
    for (const type of ['keydown', 'keyup'])
      document.addEventListener(type, (event) => {
        if ((event as KeyboardEvent).key === 'ArrowRight') document.documentElement.dataset.arrowEvents += type;
      });
  });
  await youtube.keyboard.press('ArrowRight');
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator('html')).toHaveAttribute('data-arrow-events', '');
  const name = dialog.getByLabel('レイヤー名', { exact: true });
  await name.focus();
  await name.press('ArrowRight');
  await name.press('Delete');
  await name.press('Control+d');
  await name.press('Escape');
  expect(await point(image(youtube, 0))).toEqual(before);
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(image(youtube, 0)).toHaveAttribute('data-selected', '');
  await name.fill('入力中');
  await name.press('Tab');
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  await youtube.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      document.documentElement.dataset.lastKey = `${event.key}:${event.defaultPrevented}`;
    });
  });
  await youtube.locator('body').click({ position: { x: 10, y: 10 } });
  await youtube.keyboard.press('ArrowRight');
  await expect(youtube.locator('html')).toHaveAttribute('data-last-key', 'ArrowRight:false');
  await expect(youtube.locator('html')).toHaveAttribute('data-arrow-events', 'keydownkeyup');
  await expect(youtube.locator(`${overlay} .selection-frame:visible`)).toHaveCount(0);
  await expect(youtube.locator(images)).not.toHaveAttribute('data-editable');
});

test('Undo restores equal-z painting order even when a deleted node is recreated', async ({ popup, youtube }) => {
  let dialog = await seed(popup, youtube, 3);
  const design = await stored(popup);
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  design.decorations.forEach((layer) => {
    layer.zIndex = 0;
    layer.placement.x = 0.6;
  });
  await popup.evaluate(async ({ designKey, doc }) => chrome.storage.local.set({ [designKey]: doc }), {
    designKey: key,
    doc: design,
  });
  dialog = await open(popup, youtube);
  await row(dialog, 0).locator('[data-action="select"]').click();
  await youtube.keyboard.press('Delete');
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator(images)).toHaveCount(3);
  await youtube.keyboard.press('Escape');
  await clickCanvas(image(youtube, 2));
  await expect(image(youtube, 2)).toHaveAttribute('data-selected', '');
  await expect(dialog.locator(`${rows}[data-selected]`)).toHaveAttribute('data-layer-id', 'image-2');
});

test('history retains more than 32 distinct assets while the active document stays within 32 layers', async ({
  popup,
  youtube,
}) => {
  const dialog = await open(popup, youtube);
  const payloads = await youtube.evaluate(() =>
    Array.from({ length: 33 }, (_, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d')!;
      context.fillStyle = `rgb(${i * 7},40,80)`;
      context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL().split(',')[1]!;
    }),
  );
  for (let batch = 0; batch < 4; batch++) {
    await dialog.getByLabel('画像素材を追加').setInputFiles(
      payloads.slice(batch * 8, batch * 8 + 8).map((data, i) => ({
        name: `asset-${batch * 8 + i}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(data, 'base64'),
      })),
    );
    await expect(youtube.locator(images)).toHaveCount((batch + 1) * 8);
    await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  }
  await youtube.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'すべて選択', exact: true }).click();
  await expect(dialog.locator('.selected-count')).toHaveText('32個選択中');
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(images)).toHaveCount(0);
  await dialog
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'asset-32.png', mimeType: 'image/png', buffer: Buffer.from(payloads[32]!, 'base64') });
  await expect(youtube.locator(images)).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(0);
  await dialog.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(images)).toHaveCount(32);
  for (const node of await youtube.locator(images).all()) await expect(node.locator('img')).toBeVisible();
  await save(dialog);
  expect(new Set((await stored(popup)).decorations.map((layer) => layer.assetId)).size).toBe(32);
});

test('mixed player/viewport selections share pixel movement and resizing cancels a gesture without saving drift', async ({
  popup,
  youtube,
}) => {
  const dialog = await seed(popup, youtube, 2);
  await youtube.locator('#navigate').evaluate((node: HTMLButtonElement) => node.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await row(dialog, 0).locator('[data-action="select"]').click();
  await dialog.getByLabel('画像のX位置').fill('40');
  await dialog.getByLabel('画像のY位置').fill('40');
  const beforeAnchor = await point(image(youtube, 0));
  await dialog.getByLabel('配置の基準').selectOption('video-player');
  expect((await point(image(youtube, 0))).x).toBeCloseTo(beforeAnchor.x, 2);
  await row(dialog, 1)
    .locator('[data-action="select"]')
    .click({ modifiers: ['Control'] });
  const a = await point(image(youtube, 0)),
    b = await point(image(youtube, 1));
  await drag(youtube, image(youtube, 0), 20, 10);
  expect((await point(image(youtube, 0))).x).toBeCloseTo(a.x + 20, 2);
  expect((await point(image(youtube, 1))).y).toBeCloseTo(b.y + 10, 2);
  await youtube.keyboard.press('Control+z');
  await youtube.keyboard.press('ArrowRight');
  expect((await point(image(youtube, 0))).x).toBeCloseTo(a.x + 1, 2);
  expect((await point(image(youtube, 1))).x).toBeCloseTo(b.x + 1, 2);
  await save(dialog);
  const persisted = await stored(popup);
  const p = await point(image(youtube, 0));
  await youtube.mouse.move(p.x, p.y);
  await youtube.mouse.down();
  await youtube.mouse.move(p.x + 30, p.y + 10, { steps: 8 });
  await youtube.setViewportSize({ width: 1200, height: 800 });
  await youtube.mouse.up();
  await expect(dialog.locator('.dirty')).toHaveText('保存済み');
  expect(await stored(popup)).toEqual(persisted);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});
