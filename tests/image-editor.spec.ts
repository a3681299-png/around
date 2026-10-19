import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import type { Page, Locator, BrowserContext } from '@playwright/test';
import { test, expect, launchExtension } from './fixtures';
import type { DesignDocument } from '../src/design/types';

const key = 'webWorldThemes.design.youtube';
const overlay = '#web-world-themes-decorations';
const layers = `${overlay} [data-image-id]`;

async function open(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const dialog = youtube.getByRole('dialog', { name: 'デザインエディター' });
  await expect(dialog).toBeVisible();
  await exposeEditorControls(dialog);
  return dialog;
}

async function raster(youtube: Page, mime: 'image/png' | 'image/webp' = 'image/png') {
  const data = await youtube.evaluate((format) => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d')!; context.clearRect(0, 0, 64, 48);
    context.fillStyle = '#e84f83'; context.fillRect(16, 0, 48, 48);
    return canvas.toDataURL(format);
  }, mime);
  return { name: mime === 'image/png' ? 'flower.png' : 'sticker.webp', mimeType: mime, buffer: Buffer.from(data.split(',')[1]!, 'base64') };
}

async function importImage(dialog: Locator, youtube: Page, mime: 'image/png' | 'image/webp' = 'image/png') {
  const count = await youtube.locator(layers).count();
  await dialog.getByLabel('画像素材を追加').setInputFiles(await raster(youtube, mime));
  await expect(youtube.locator(layers)).toHaveCount(count + 1);
  const image = youtube.locator(layers).last();
  await expect(image.locator('img')).toBeVisible();
  await expect(image).toHaveAttribute('data-selected', '');
  return image;
}

async function save(dialog: Locator) {
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
}

async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(async (designKey) => (await chrome.storage.local.get(designKey))[designKey] as DesignDocument, key);
}

async function drag(youtube: Page, element: Locator, dx: number, dy: number) {
  await withCanvas(youtube, async () => {
    const box = (await element.boundingBox())!;
    await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await youtube.mouse.down();
    await youtube.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    await youtube.mouse.up();
  });
}

async function controls(page: Page, image: Locator) {
  return page.locator(`${overlay} [data-frame-id="${await image.getAttribute('data-image-id')}"]`);
}

async function assets(context: BrowserContext) {
  const worker = context.serviceWorkers().find((entry) => entry.url().includes('background/index.js')) ?? await context.waitForEvent('serviceworker');
  return worker.evaluate(async () => new Promise<Array<{ id: string; bytes: number; mime: string; leases: number }>>((resolve, reject) => {
    const request = indexedDB.open('web-world-themes-assets', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, rows = db.transaction('assets').objectStore('assets').getAll();
      rows.onsuccess = () => { resolve(rows.result.map((row) => ({ id: row.id as string, bytes: (row.blob as Blob).size, mime: row.mime as string, leases: (row.leases as unknown[]).length }))); db.close(); };
      rows.onerror = () => { reject(rows.error); db.close(); };
    };
  }));
}

test('import a transparent image, drag and resize it, save, reload and restart with extension-owned image data', async ({ popup, youtube, context, profile, extensionId }) => {
  const dialog = await open(popup, youtube);
  const image = await importImage(dialog, youtube);
  const alpha = await image.locator('img').evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(node, 0, 0);
    return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(32, 20, 1, 1).data[3]];
  });
  expect(alpha).toEqual([0, 255]);
  const original = (await image.boundingBox())!;
  await drag(youtube, image, -100, 90);
  const moved = (await image.boundingBox())!;
  expect(moved.x).toBeCloseTo(original.x - 100, 0);
  expect(moved.y).toBeCloseTo(original.y + 90, 0);
  await drag(youtube, (await controls(youtube, image)).getByRole('button', { name: '右下でサイズ変更' }), 65, 49);
  const resized = (await image.boundingBox())!;
  expect(resized.width).toBeGreaterThan(original.width + 50);
  expect(resized.width / resized.height).toBeCloseTo(original.width / original.height, 2);
  await save(dialog);
  const design = await stored(popup);
  expect(design.schemaVersion).toBe(11);
  expect(design.decorations).toHaveLength(1);
  expect(JSON.stringify(design)).not.toMatch(/data:image|base64|blob:/);
  expect(await assets(context)).toHaveLength(1);
  const persisted = design.decorations[0]!;
  await youtube.reload();
  await expect(youtube.locator(layers).locator('img')).toBeVisible();
  await expect(youtube.locator(layers)).not.toHaveAttribute('data-editable');
  expect((await youtube.locator(layers).boundingBox())!.width).toBeCloseTo(persisted.placement.widthPx, 0);
  await context.close();
  const restarted = await launchExtension(profile);
  try {
    const page = await restarted.newPage(); await page.goto('https://www.youtube.com/');
    await expect(page.locator(layers).locator('img')).toBeVisible();
    expect((await page.locator(layers).boundingBox())!.width).toBeCloseTo(persisted.placement.widthPx, 0);
    const nextPopup = await restarted.newPage(); await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    expect((await stored(nextPopup)).decorations[0]).toEqual(persisted);
  } finally { await restarted.close(); }
});

test('file selection and drop accept multiple PNG/WebP layers and each edits independently', async ({ popup, youtube, context }) => {
  const dialog = await open(popup, youtube);
  const png = await raster(youtube), webp = await raster(youtube, 'image/webp');
  await dialog.getByLabel('画像素材を追加').setInputFiles([png, webp]);
  await expect(youtube.locator(layers)).toHaveCount(2);
  await expect(youtube.locator(layers).last().locator('img')).toBeVisible();
  await dialog.getByLabel('画像の不透明度').fill('40');
  await dialog.locator('[data-layer-id]').first().getByRole('button', { name: 'レイヤーを並び替え' }).dragTo(dialog.locator('[data-layer-id]').last(), { targetPosition: { x: 40, y: 40 } });
  await dialog.getByLabel('画像の角度').fill('35');
  await expect(youtube.locator(layers).last().locator('.media')).toHaveCSS('opacity', '0.4');
  await expect(youtube.locator(layers).first().locator('.media')).toHaveCSS('opacity', '1');
  await dialog.locator('[data-layer-id][data-selected]').getByRole('button', { name: '非表示にする', exact: true }).click();
  await expect(youtube.locator(layers).last()).toBeHidden();
  await dialog.locator('[data-layer-id][data-selected]').getByRole('button', { name: '表示する', exact: true }).click();
  await expect(youtube.locator(layers).last()).toBeVisible();
  await youtube.evaluate(({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
  }, { base64: png.buffer.toString('base64') });
  await expect(youtube.locator(layers)).toHaveCount(3);
  await expect(youtube.locator(layers).last().locator('img')).toBeVisible();
  expect(await assets(context)).toHaveLength(2); // The duplicate PNG shares one immutable asset.
  await save(dialog);
  expect((await stored(popup)).decorations.map(({ opacity, zIndex, placement }) => [opacity, zIndex, placement.rotationDeg])).toEqual([[1, 1, 0], [.4, 0, 35], [1, 2, 0]]);
});

test('rotation handle, Delete, discard and close preserve saved layers and collect abandoned imports', async ({ popup, youtube, context }) => {
  const dialog = await open(popup, youtube);
  let image = await importImage(dialog, youtube);
  await save(dialog);
  const handle = (await controls(youtube, image)).getByRole('button', { name: '画像を回転' });
  const box = (await image.boundingBox())!, grip = (await handle.boundingBox())!;
  await withCanvas(youtube, async () => {
    await youtube.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await youtube.mouse.down();
    await youtube.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 8 }); await youtube.mouse.up();
  });
  expect(Number(await dialog.getByLabel('画像の角度').inputValue())).toBeGreaterThan(60);
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(layers)).toHaveCount(0);
  await dialog.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(1);
  image = await importImage(dialog, youtube, 'image/webp');
  await expect(image.locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  await expect(youtube.locator(layers)).toHaveCount(1);
  await expect.poll(async () => (await assets(context)).length).toBe(1);
  const again = await open(popup, youtube);
  await again.getByRole('group', { name: '画像レイヤー' }).getByRole('button').first().click();
  await again.getByRole('button', { name: '画像を削除' }).click(); await save(again);
  await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(await assets(context)).toHaveLength(1); // Retained for Undo even after saving.
  await again.getByRole('button', { name: '編集を終了' }).click();
  await expect.poll(async () => (await assets(context)).length).toBe(0);
});

test('normal decoration is click-through; OFF and zero remove images and ON restores saved geometry', async ({ popup, youtube }) => {
  const dialog = await open(popup, youtube);
  await importImage(dialog, youtube);
  const link = youtube.locator('[data-ww-surface~="video-card"]').first().locator('a').first();
  const box = (await link.boundingBox())!;
  await dialog.getByLabel('画像のX位置').fill(String(Math.round((box.x + box.width / 2) / 1100 * 10_000) / 100));
  await dialog.getByLabel('画像のY位置').fill(String(Math.round((box.y + box.height / 2) / 760 * 10_000) / 100));
  await save(dialog);
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  await expect(youtube.locator(`${overlay} .handle`).first()).toBeHidden();
  await link.click(); await expect(youtube).toHaveURL(/\/watch\?/);
  await expect(youtube.locator(layers).locator('img')).toBeVisible();
  for (const boundary of ['off', 'zero'] as const) {
    if (boundary === 'off') await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    else await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator(overlay)).toHaveCount(0);
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
    await expect(youtube.locator(layers).locator('img')).toBeVisible();
  }
});

test('viewport placement follows resizing without scroll drift; player anchors follow SPA and disappear when absent', async ({ popup, youtube }) => {
  const dialog = await open(popup, youtube);
  const image = await importImage(dialog, youtube);
  await save(dialog);
  const placement = (await stored(popup)).decorations[0]!.placement;
  await youtube.setViewportSize({ width: 1360, height: 920 });
  await expect.poll(async () => { const box = (await image.boundingBox())!; return Math.round(box.x + box.width / 2); }).toBe(Math.round(1360 * placement.x));
  const resized = (await image.boundingBox())!;
  await youtube.evaluate(() => window.scrollTo(0, 300));
  expect((await image.boundingBox())!.y).toBeCloseTo(resized.y, 0);
  await dialog.getByRole('button', { name: 'パネルを左へ' }).click();
  await youtube.locator('#navigate').click(); await expect(youtube).toHaveURL(/\/watch\?/);
  const beforeAnchor = (await image.boundingBox())!;
  await dialog.getByLabel('配置の基準').selectOption('video-player');
  await save(dialog);
  expect((await image.boundingBox())!.x).toBeCloseTo(beforeAnchor.x, 0);
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  await youtube.locator('ytd-guide-entry-renderer a[href="/"]').first().click();
  await expect(youtube).toHaveURL('https://www.youtube.com/');
  await expect(image).toBeHidden();
});

test('invalid files and missing assets fail without saving corrupt JSON or disturbing existing content', async ({ popup, youtube }) => {
  const dialog = await open(popup, youtube);
  await dialog.getByLabel('画像素材を追加').setInputFiles({ name: 'script.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"></svg>') });
  await expect(dialog.locator('.status')).toContainText('静止PNG');
  await expect(youtube.locator(layers)).toHaveCount(0);
  await dialog.getByLabel('画像素材を追加').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(32 * 1024 * 1024 + 1) });
  await expect(dialog.locator('.status')).toContainText('32MB');
  expect(await popup.evaluate(async (designKey) => (await chrome.storage.local.get(designKey))[designKey], key)).toBeUndefined();
  const response = await popup.evaluate(async () => chrome.runtime.sendMessage({ type: 'web-world-themes:assets', action: 'save', session: 'session-test', design: {
    schemaVersion: 2, id: 'missing', siteId: 'youtube', baseThemeId: 'retro', rules: [], decorations: [{
      kind: 'image', id: 'image-missing', assetId: `asset-${'0'.repeat(64)}`, name: 'missing.png',
      placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 100, heightPx: 100, rotationDeg: 0 }, opacity: 1, zIndex: 0, visible: true,
    }],
  } }));
  expect(response.ok).toBe(false);
  expect(await popup.evaluate(async (designKey) => (await chrome.storage.local.get(designKey))[designKey], key)).toBeUndefined();
});

test('saved images sync across tabs and a foreign deletion cannot collect another tab draft', async ({ popup, youtube, context }) => {
  const first = await open(popup, youtube);
  await importImage(first, youtube); await save(first);
  const secondPage = await context.newPage(); await secondPage.goto('https://www.youtube.com/');
  await expect(secondPage.locator(layers).locator('img')).toBeVisible();
  const second = await open(popup, secondPage);
  await second.getByRole('group', { name: '画像レイヤー' }).getByRole('button').first().click();
  await second.getByLabel('画像の不透明度').fill('60');
  await first.getByRole('button', { name: '画像を削除' }).click(); await save(first);
  await expect(second.locator('.status')).toContainText('別のタブで保存されました');
  await expect(secondPage.locator(layers).locator('.media')).toHaveCSS('opacity', '0.6');
  expect(await assets(context)).toHaveLength(1);
  await second.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(secondPage.locator(overlay)).toHaveCount(0);
  expect(await assets(context)).toHaveLength(1); // The first tab still owns its deletion history.
  await first.getByRole('button', { name: '編集を終了' }).click();
  await expect.poll(async () => (await assets(context)).length).toBe(0);
});

test('turning the theme OFF while a save waits for asset retention still completes that save', async ({ popup, youtube, context }) => {
  const dialog = await open(popup, youtube);
  await dialog.getByLabel('画像素材を追加').setInputFiles([await raster(youtube), await raster(youtube, 'image/webp')]);
  await expect(youtube.locator(layers)).toHaveCount(2);
  await save(dialog);
  const worker = context.serviceWorkers().find((entry) => entry.url().includes('background/index.js'))!;
  await worker.evaluate(() => {
    const original = chrome.tabs.query.bind(chrome.tabs);
    let held = false;
    chrome.tabs.query = (async (query: chrome.tabs.QueryInfo) => {
      if (!held) {
        held = true;
        await new Promise<void>((resolve) => { (globalThis as typeof globalThis & { resumeAssetPrune?: () => void }).resumeAssetPrune = resolve; });
      }
      return original(query);
    }) as typeof chrome.tabs.query;
  });
  await dialog.getByRole('button', { name: '画像を削除' }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => worker.evaluate(() => Boolean((globalThis as typeof globalThis & { resumeAssetPrune?: () => void }).resumeAssetPrune))).toBe(true);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  await worker.evaluate(() => { (globalThis as typeof globalThis & { resumeAssetPrune?: () => void }).resumeAssetPrune?.(); });
  await expect.poll(async () => (await stored(popup)).decorations.length).toBe(1);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator(layers)).toHaveCount(1);
  await expect(youtube.locator(layers).locator('img')).toBeVisible();
});
