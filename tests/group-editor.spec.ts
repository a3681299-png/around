import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, launchExtension } from './fixtures';
import type { DesignDocument, GroupLayer } from '../src/design/types';
import { defaultCircleMask } from '../src/effects/types';

const key = 'webWorldThemes.design.youtube', overlay = '#web-world-themes-decorations';
const images = `${overlay} [data-image-id]`, compositions = `${overlay} [data-group-id]`;
const colors = ['#f04a50', '#3caf78', '#4276ed'], names = ['red.png', 'green.png', 'blue.png'];
async function open(popup: Page, page: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await page.bringToFront();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toBeVisible(); await exposeEditorControls(panel); return panel;
}
const row = (panel: Locator, name: string) => panel.locator('[data-layer-id]').filter({ has: panel.page().getByRole('button', { name, exact: true }) });
async function number(panel: Locator, label: string, value: number) { await panel.getByLabel(label, { exact: true }).fill(String(value)); }
async function save(panel: Locator) { await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.status')).toHaveText('保存しました。'); }
async function stored(popup: Page): Promise<DesignDocument> { return popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key); }
async function watch(page: Page) { await page.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click()); await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible(); }
async function play(page: Page, action: 'Play' | 'Pause') { await page.locator(`#movie_player [aria-label="${action}"]`).evaluate((button: HTMLButtonElement) => button.click()); }
async function ready(page: Page, count: number) {
  await expect(page.locator(images)).toHaveCount(count);
  for (const item of await page.locator(`${images} .media`).all()) await expect(item).toHaveAttribute('data-playback', /still|playing|paused|hidden|reduced-motion/);
}
async function addThree(panel: Locator, page: Page, overlap = false) {
  const buffers = await page.evaluate((colors) => colors.map((color) => {
    const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 220, 160); return canvas.toDataURL().split(',')[1]!;
  }), colors);
  await panel.getByLabel('画像素材を追加').setInputFiles(buffers.map((base64, i) => ({ name: names[i]!, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') })));
  await ready(page, 3);
  for (const [i, name] of names.entries()) {
    await row(panel, name).locator('[data-action="select"]').click();
    for (const [label, value] of [['画像のX位置', overlap ? 35 : 35 + i * 15], ['画像のY位置', 40], ['画像の幅', 220], ['画像の高さ', 160]] as const) await number(panel, label, value);
  }
}
async function selectAll(panel: Locator) {
  const buttons = panel.locator('[data-kind="image"], [data-kind="animation"]').locator('[data-action="select"]');
  for (let i = 0; i < await buttons.count(); i++) await buttons.nth(i).click(i ? { modifiers: ['Control'] } : {});
}
async function groupThree(panel: Locator, page: Page) {
  await selectAll(panel); await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await expect(page.locator(compositions)).toHaveCount(1); await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
}
async function boxes(page: Page) {
  return page.locator(images).evaluateAll((nodes) => nodes.map((node: Element) => { const rect = node.getBoundingClientRect(); return { id: (node as HTMLElement).dataset.imageId!, x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }).sort((a, b) => a.id.localeCompare(b.id)));
}
async function pixel(page: Page, png: Buffer, x: number, y: number) {
  return page.evaluate(async ({ base64, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0); bitmap.close(); return [...ctx.getImageData(x, y, 1, 1).data];
  }, { base64: png.toString('base64'), x, y });
}
async function assetCount(popup: Page) {
  return popup.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('web-world-themes-assets'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const count = db.transaction('assets').objectStore('assets').count();
      count.onsuccess = () => { db.close(); resolve(count.result); }; count.onerror = () => { db.close(); reject(count.error); }; };
  }));
}
async function isolated(page: Page): Promise<{ session: CDPSession; id: number }> {
  const session = await page.context().newCDPSession(page), worlds: { id: number; auxData?: { type?: string } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context)); await session.send('Runtime.enable');
  const world = worlds.find((context) => context.auxData?.type === 'isolated'); if (!world) throw new Error('Extension world missing'); return { session, id: world.id };
}

test('three images group, move as one, share a mouse/video mask, save, restart and ungroup without a position jump', async ({ popup, youtube, context, profile, extensionId }, info) => {
  test.setTimeout(90_000);
  const panel = await open(popup, youtube); await watch(youtube); await addThree(panel, youtube);
  const original = await boxes(youtube);
  await youtube.locator(`${images} .media`).evaluateAll((nodes) => nodes.forEach((node, i) => (node as HTMLElement).dataset.identity = `original-${i}`));
  await groupThree(panel, youtube); expect(await boxes(youtube)).toEqual(original);
  expect(await youtube.locator(`${images} .media`).evaluateAll((nodes) => nodes.every((node) => (node as HTMLElement).dataset.identity?.startsWith('original-')))).toBe(true);
  await panel.getByLabel('レイヤー名').fill('海の世界'); await panel.getByLabel('レイヤー名').press('Tab');
  await expect(panel.getByRole('group', { name: 'グループのプロパティ', exact: true })).toBeVisible();
  await expect(youtube.locator(`${overlay} [data-group] .handle`)).toHaveCount(0);
  const box = (await youtube.locator(images).first().boundingBox())!;
  await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await youtube.mouse.down();
  await youtube.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 28, { steps: 6 }); await youtube.mouse.up();
  const moved = await boxes(youtube);
  moved.forEach((item, i) => { expect(item.x - original[i]!.x).toBeCloseTo(45, 3); expect(item.y - original[i]!.y).toBeCloseTo(28, 3); });
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); expect(await boxes(youtube)).toEqual(original);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); expect(await boxes(youtube)).toEqual(moved);
  await panel.getByLabel('円形マスクを使う').check(); await number(panel, '光の半径', 120); await number(panel, '境界のぼかし', 25);
  await panel.getByRole('button', { name: 'パネルを左へ', exact: true }).click();
  const content = youtube.locator(`${compositions} .group-content`);
  for (const image of await youtube.locator(images).all()) {
    const rect = (await image.boundingBox())!, point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await withCanvas(youtube, () => youtube.mouse.move(point.x, point.y));
    await expect.poll(() => content.evaluate((element: HTMLElement, point) => {
      const match = element.style.maskImage.match(/at ([\d.e+-]+)px ([\d.e+-]+)px/)!, rect = element.getBoundingClientRect();
      return Math.abs(rect.left + Number(match[1]) - point.x) + Math.abs(rect.top + Number(match[2]) - point.y);
    }, point)).toBeLessThan(.04);
  }
  await panel.getByLabel('動画の一時停止で隠す').check(); await number(panel, 'マスクのフェード時間', 500);
  await expect(content).toHaveAttribute('data-mask-intensity', '0'); await play(youtube, 'Play'); await expect(content).toHaveAttribute('data-mask-intensity', '1');
  await info.attach('group-reveal', { body: await youtube.screenshot(), contentType: 'image/png' });
  await play(youtube, 'Pause'); await youtube.waitForTimeout(120); const middle = Number(await content.getAttribute('data-mask-intensity')); expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(1);
  await expect(content).toHaveAttribute('data-mask-intensity', '0'); await save(panel); const saved = await stored(popup);
  expect(saved).toMatchObject({ schemaVersion: 10, groups: [{ name: '海の世界', effects: [{ radiusPx: 120, featherPx: 25 }] }] });
  expect(saved.decorations).toHaveLength(3); expect(saved.groups![0]!.children).toHaveLength(3); expect(await assetCount(popup)).toBe(3);
  await youtube.reload(); await ready(youtube, 3); await expect(youtube.locator(`${compositions} .group-content`)).toHaveAttribute('data-mask-intensity', '0');
  expect(await boxes(youtube)).toEqual(moved); await context.close();
  const restarted = await launchExtension(profile);
  try {
    const page = await restarted.newPage(); await page.goto('https://www.youtube.com/watch?v=fixture'); await ready(page, 3);
    await expect(page.locator(`${compositions} .group-content`)).toHaveAttribute('data-mask-intensity', '0'); expect(await boxes(page)).toEqual(moved);
    const nextPopup = await restarted.newPage(); await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    const editor = await open(nextPopup, page); await row(editor, '海の世界').locator('[data-action="select"]').click();
    await editor.getByRole('button', { name: 'グループを解除', exact: true }).click(); await expect(page.locator(compositions)).toHaveCount(0);
    expect(await boxes(page)).toEqual(moved); await save(editor); const ungrouped = await stored(nextPopup);
    expect(ungrouped.groups).toBeUndefined(); expect(ungrouped.decorations.map((layer) => layer.assetId)).toEqual(saved.decorations.map((layer) => layer.assetId));
  } finally { await restarted.close(); }
});

test('group opacity and mask are applied once to overlapping pixels, with child effects composed inside', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube); await youtube.mouse.move(20, 20); const baseline = await withCanvas(youtube, () => youtube.screenshot());
  await addThree(panel, youtube, true); await groupThree(panel, youtube);
  await panel.getByLabel('グループの不透明度').fill('50'); await panel.getByLabel('円形マスクを使う').check(); await panel.getByLabel('マウスに追従').uncheck();
  await number(panel, '光の半径', 65); await number(panel, '境界のぼかし', 10); await panel.getByLabel('マスクの表示強度').fill('50');
  await expect(panel.getByRole('button', { name: 'グループを解除', exact: true })).toBeDisabled();
  await youtube.mouse.move(20, 20); const masked = await withCanvas(youtube, () => youtube.screenshot());
  const background = await pixel(youtube, baseline, 385, 304), actual = await pixel(youtube, masked, 385, 304), top = [66, 118, 237];
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(Math.round(top[i]! * .25 + background[i]! * .75), -1);
  expect(await pixel(youtube, masked, 485, 304)).toEqual(await pixel(youtube, baseline, 485, 304));
  expect(await youtube.locator(`${images} .media`).evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).maskImage === 'none'))).toBe(true);
  await row(panel, 'blue.png').locator('[data-action="select"]').click(); await panel.getByLabel('円形マスクを使う').check(); await number(panel, '光の半径', 30);
  await expect(youtube.locator(`${compositions} .group-content`)).toHaveAttribute('data-mask-intensity', '0.5');
  await expect(youtube.locator(`${images}[aria-label="blue.png"] .media`)).not.toHaveCSS('mask-image', 'none');
  await row(panel, 'グループ').locator('[data-action="select"]').click(); await expect(panel.getByLabel('光の半径')).toHaveValue('65');
});

test('hierarchy folding, independent edits, protected descendants, hidden motion, copying and saved deletion history keep assets intact', async ({ popup, youtube }) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube); await addThree(panel, youtube); await groupThree(panel, youtube);
  const groupRow = row(panel, 'グループ'); await groupRow.getByRole('button', { name: 'グループを折りたたむ' }).click();
  await expect(panel.locator('[data-parent-id]')).toHaveCount(0); await expect(youtube.locator(images)).toHaveCount(3);
  await groupRow.getByRole('button', { name: 'グループを展開' }).click(); await expect(panel.locator('[data-parent-id]')).toHaveCount(3);
  await panel.getByLabel('円形マスクを使う').check(); await number(panel, '光の半径', 120);
  await youtube.locator(`${images}[aria-label="red.png"]`).click({ modifiers: ['Control'] }); await expect(row(panel, 'red.png')).toHaveAttribute('data-selected', '');
  await expect(panel.getByRole('group', { name: '画像のプロパティ', exact: true })).toBeVisible(); await number(panel, '画像の角度', 20);
  await expect(youtube.locator(`${compositions} .group-content`)).not.toHaveCSS('mask-image', 'none');
  await groupRow.locator('[data-action="lock"]').click(); await row(panel, 'green.png').locator('[data-action="select"]').click();
  await expect(panel.getByLabel('画像の幅', { exact: true })).toBeDisabled(); const protectedBoxes = await boxes(youtube);
  await youtube.keyboard.press('Delete'); await youtube.keyboard.press('Control+d'); await youtube.keyboard.press('ArrowRight'); expect(await boxes(youtube)).toEqual(protectedBoxes);
  await expect(youtube.locator(images)).toHaveCount(3); await groupRow.locator('[data-action="lock"]').click();
  await row(panel, 'green.png').locator('[data-action="lock"]').click(); await groupRow.locator('[data-action="select"]').click();
  await expect(panel.getByRole('button', { name: '画像を削除', exact: true })).toBeDisabled(); await expect(panel.getByLabel('グループのX位置')).toBeDisabled();
  await row(panel, 'green.png').locator('[data-action="lock"]').click(); await row(panel, 'green.png').locator('[data-action="visible"]').click();
  await save(panel); const before = await stored(popup); await groupRow.locator('[data-action="select"]').click(); await youtube.keyboard.press('Shift+ArrowRight'); await save(panel);
  const moved = await stored(popup); moved.decorations.forEach((layer, i) => expect((layer.placement.x - before.decorations[i]!.placement.x) * 1100).toBeCloseTo(10, 4));
  await groupRow.locator('[data-action="visible"]').click(); await save(panel); expect((await stored(popup)).decorations.map((layer) => layer.visible)).toEqual(before.decorations.map((layer) => layer.visible));
  await expect(youtube.locator(compositions)).toBeHidden(); await groupRow.locator('[data-action="visible"]').click(); await row(panel, 'green.png').locator('[data-action="visible"]').click();
  await groupRow.locator('[data-action="select"]').click(); await youtube.keyboard.press('Control+d'); await expect(youtube.locator(images)).toHaveCount(6); await expect(youtube.locator(compositions)).toHaveCount(2);
  await save(panel); expect(await assetCount(popup)).toBe(3); expect(new Set((await stored(popup)).decorations.map((layer) => layer.assetId)).size).toBe(3);
  await youtube.keyboard.press('Delete'); await expect(youtube.locator(images)).toHaveCount(3);
  await groupRow.locator('[data-action="select"]').click(); await youtube.keyboard.press('Delete'); await expect(youtube.locator(overlay)).toHaveCount(0); await save(panel);
  expect(await assetCount(popup)).toBe(3); await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await ready(youtube, 3); await expect(youtube.locator(compositions)).toHaveCount(1);
  await save(panel); expect(await assetCount(popup)).toBe(3);
});

test('mixed anchors and interleaved selection are refused; player groups follow resize, scroll and SPA with click-through cleanup', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube); await addThree(panel, youtube); await watch(youtube);
  await row(panel, 'green.png').locator('[data-action="select"]').click(); await panel.getByLabel('配置の基準').selectOption('video-player'); await selectAll(panel);
  await expect(panel.getByRole('button', { name: '選択をグループ化', exact: true })).toBeDisabled(); await expect(panel.locator('.grouping-help')).toContainText('画面基準');
  await row(panel, 'red.png').locator('[data-action="select"]').click(); await row(panel, 'blue.png').locator('[data-action="select"]').click({ modifiers: ['Control'] });
  await expect(panel.locator('.grouping-help')).toContainText('連続'); await expect(youtube.locator(compositions)).toHaveCount(0);
  for (const [i, name] of names.entries()) {
    await row(panel, name).locator('[data-action="select"]').click(); await panel.getByLabel('配置の基準').selectOption('video-player');
    await number(panel, '画像のX位置', 30 + i * 20); await number(panel, '画像のY位置', 50); await number(panel, '画像の幅', 100); await number(panel, '画像の高さ', 80);
  }
  await groupThree(panel, youtube); await panel.getByLabel('円形マスクを使う').check(); await save(panel); const saved = await stored(popup);
  await panel.getByRole('button', { name: '編集を終了' }).click();
  const point = { x: 410, y: 300 }; await youtube.mouse.move(point.x, point.y);
  const check = async () => {
    const player = (await youtube.locator('#movie_player').boundingBox())!;
    const actual = await boxes(youtube);
    for (const layer of saved.decorations) { const rect = actual.find((item) => item.id === layer.id)!; expect(Math.abs(rect.x + rect.width / 2 - player.x - player.width * layer.placement.x)).toBeLessThan(.04); }
    await expect.poll(() => youtube.locator(`${compositions} .group-content`).evaluate((node: HTMLElement, point) => { const match = node.style.maskImage.match(/at ([\d.e+-]+)px ([\d.e+-]+)px/)!, rect = node.getBoundingClientRect(); return Math.abs(rect.x + Number(match[1]) - point.x) + Math.abs(rect.y + Number(match[2]) - point.y); }, point)).toBeLessThan(.04);
  };
  await youtube.setViewportSize({ width: 1250, height: 820 }); await expect.poll(async () => (await boxes(youtube))[0]!.width).toBe(100); await youtube.waitForTimeout(50); await check();
  await youtube.locator('#movie_player').evaluate((player: HTMLElement) => { player.style.width = '400px'; player.style.height = '250px'; }); await youtube.waitForTimeout(50); await check();
  await youtube.evaluate(() => { document.body.style.minHeight = '1800px'; window.scrollTo(0, 80); }); await youtube.waitForTimeout(50); await check(); expect(await stored(popup)).toEqual(saved);
  await youtube.locator('ytd-guide-entry-renderer a[href="/"]').first().click(); await expect(youtube.locator(compositions)).toBeHidden(); await watch(youtube); await ready(youtube, 3);
  await expect(youtube.locator(compositions)).toBeVisible(); expect(await stored(popup)).toEqual(saved); await youtube.locator('#movie_player [aria-label="Play"]').click();
  await expect(youtube.locator('#movie_player video')).toHaveJSProperty('paused', false);
  for (const boundary of ['off', 'zero']) {
    if (boundary === 'off') await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); else await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator(overlay)).toHaveCount(0);
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await popup.getByRole('slider', { name: 'Effect Strength' }).press('End'); await youtube.bringToFront(); await ready(youtube, 3);
  }
});

test('PNG, GIF and Lottie share one group; parent mask/opacity/visibility suspend descendant playback', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube); await watch(youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await ready(youtube, 1);
  await expect(panel.getByRole('button', { name: 'アニメーションを追加', exact: true })).toBeEnabled();
  await panel.getByLabel('アニメーション素材を追加').setInputFiles([path.resolve('tests/fixtures/motion/petal.gif'), path.resolve('tests/fixtures/motion/petal.json')]); await ready(youtube, 3);
  await groupThree(panel, youtube); await panel.getByLabel('円形マスクを使う').check(); await panel.getByLabel('動画の一時停止で隠す').check(); await number(panel, 'マスクのフェード時間', 120);
  const animation = youtube.locator(`${images} .media[data-format="gif"], ${images} .media[data-format="lottie"]`);
  await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['hidden', 'hidden']); await play(youtube, 'Play'); await expect(youtube.locator(`${compositions} .group-content`)).toHaveAttribute('data-mask-intensity', '1');
  await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['playing', 'playing']);
  const frames = async () => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.frame).join(',')); const initial = await frames(); await expect.poll(frames).not.toBe(initial);
  await panel.getByLabel('グループの不透明度').fill('0'); await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['hidden', 'hidden']); const paused = await frames(); await youtube.waitForTimeout(160); expect(await frames()).toBe(paused);
  await panel.getByLabel('グループの不透明度').fill('100'); await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['playing', 'playing']);
  await play(youtube, 'Pause'); await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['hidden', 'hidden']);
  await save(panel); await youtube.reload(); await ready(youtube, 3); await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['hidden', 'hidden']);
  await play(youtube, 'Play'); await expect.poll(() => animation.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.playback))).toEqual(['playing', 'playing']);
});

test('grouping, scoped drag ordering, ungrouping and effect edits undo/redo, discard and synchronize across tabs', async ({ popup, youtube, context }) => {
  const panel = await open(popup, youtube); await addThree(panel, youtube); const original = await boxes(youtube);
  await row(panel, 'red.png').locator('[data-action="select"]').click(); await row(panel, 'green.png').locator('[data-action="select"]').click({ modifiers: ['Control'] });
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(1);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(0); expect(await boxes(youtube)).toEqual(original);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(1);
  const groupRow = row(panel, 'グループ'); await groupRow.locator('[data-action="select"]').click();
  await panel.getByLabel('円形マスクを使う').check(); await number(panel, '光の半径', 140); await save(panel); const initial = await stored(popup);
  const second = await context.newPage(); await second.goto('https://www.youtube.com/'); await ready(second, 3); await expect(second.locator(compositions)).toHaveCount(1); await youtube.bringToFront();
  await groupRow.locator('[data-reorder]').dragTo(row(panel, 'blue.png'), { targetPosition: { x: 10, y: 2 } });
  await expect(panel.locator('.dirty')).toHaveText('未保存の変更'); await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await save(panel); const front = await stored(popup);
  expect(front.groups![0]!.zIndex).toBeGreaterThan(front.decorations.find((layer) => layer.name === 'blue.png')!.zIndex);
  await expect(second.locator(compositions)).toHaveCSS('z-index', String(front.groups![0]!.zIndex + 100));
  await row(panel, 'red.png').locator('[data-reorder]').dragTo(row(panel, 'green.png'), { targetPosition: { x: 10, y: 2 } });
  await save(panel); const reordered = await stored(popup);
  expect(reordered.decorations.find((layer) => layer.name === 'red.png')!.zIndex).toBeGreaterThan(reordered.decorations.find((layer) => layer.name === 'green.png')!.zIndex);
  await groupRow.locator('[data-action="select"]').click(); await number(panel, '光の半径', 200);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click(); await groupRow.locator('[data-action="select"]').click(); await expect(panel.getByLabel('光の半径')).toHaveValue('140');
  await panel.getByRole('button', { name: 'グループを解除', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(0); expect(await boxes(youtube)).toEqual(original);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(1);
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(0);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click(); await expect(youtube.locator(compositions)).toHaveCount(1);
  expect((await stored(popup)).decorations.map((layer) => layer.assetId)).toEqual(initial.decorations.map((layer) => layer.assetId));
});

test('16 groups / 32 media share effect sources and become idle or fully detached at lifecycle boundaries', async ({ popup, youtube }, info) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube); await addThree(panel, youtube); await save(panel); await panel.getByRole('button', { name: '編集を終了' }).click(); await watch(youtube);
  const runtime = await isolated(youtube);
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: `
    const registrations = new Map(); globalThis.__groupRafs = 0;
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const tracked = (target, type) => target === document && type === 'pointermove' || target instanceof HTMLVideoElement && ['play','playing','pause','ended','emptied'].includes(type);
    EventTarget.prototype.addEventListener = function(type, listener, options) { if (tracked(this, type)) { let entries = registrations.get(this); if (!entries) registrations.set(this, entries = new Map()); let set = entries.get(type); if (!set) entries.set(type, set = new Set()); set.add(listener); } return add.call(this, type, listener, options); };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { if (tracked(this, type)) registrations.get(this)?.get(type)?.delete(listener); return remove.call(this, type, listener, options); };
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (callback) => raf((time) => { globalThis.__groupRafs++; callback(time); });
    globalThis.__groupStats = () => { let pointer = 0, video = 0; registrations.forEach((entries, target) => entries.forEach((set) => { if (target === document) pointer += set.size; else video += set.size; })); return { pointer, video, rafs: globalThis.__groupRafs }; };
  ` });
  const stats = async (): Promise<{ pointer: number; video: number; rafs: number }> => (await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: '__groupStats()', returnByValue: true })).result.value;
  const base = await stored(popup), mask = defaultCircleMask(); mask.bindings.push({ source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: 40 }, target: 'mask.intensity' });
  const media = Array.from({ length: 32 }, (_, i) => ({ ...base.decorations[i % 3]!, id: `image-world-${i}`, visible: i !== 3, locked: i === 17,
    placement: { ...base.decorations[i % 3]!.placement, x: .18 + i % 8 * .08, y: .2 + Math.floor(i / 8) * .12, widthPx: 64, heightPx: 48 }, ...(i % 3 === 0 ? { effects: [defaultCircleMask()] } : {}) }));
  const groups = Array.from({ length: 16 }, (_, i): GroupLayer => ({ kind: 'group', id: `group-world-${i}`, name: `世界${i}`, children: media.slice(i * 2, i * 2 + 2).map((layer) => layer.id), visible: i !== 3, locked: i === 2, opacity: i === 5 ? 0 : 1, zIndex: i, effects: [mask] }));
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design: { ...base, decorations: media, groups } });
  await ready(youtube, 32); await expect(youtube.locator(compositions)).toHaveCount(16); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  await play(youtube, 'Play'); await expect(youtube.locator(`${compositions} .group-content[data-mask-intensity="1"]`)).toHaveCount(14);
  await play(youtube, 'Pause'); await expect(youtube.locator(`${compositions} .group-content[data-mask-intensity="0"]`)).toHaveCount(16); await youtube.waitForTimeout(100);
  await runtime.session.send('Performance.enable'); const metrics = await runtime.session.send('Performance.getMetrics'), first = await stats(); await youtube.waitForTimeout(250); const idle = await stats();
  expect(idle.rafs - first.rafs).toBe(0); for (let i = 0; i < 16; i++) await youtube.mouse.move(240 + i * 4, 330); expect((await stats()).rafs).toBe(idle.rafs);
  const heap = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')!.value / 1024 / 1024;
  const report = { groups: 16, media: 32, sharedPointer: idle.pointer, nativeVideoListeners: idle.video, idleSampleMs: 250, idleRafs: idle.rafs - first.rafs, jsHeapMiB: Math.round(heap * 10) / 10 };
  await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/group-performance.json', JSON.stringify(report, null, 2)); await info.attach('group-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: 'Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));' }); await expect.poll(stats).toMatchObject({ pointer: 0, video: 0 });
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: 'delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));' }); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  for (const boundary of ['off', 'zero']) {
    if (boundary === 'off') await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); else await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator(overlay)).toHaveCount(0); await expect.poll(stats).toMatchObject({ pointer: 0, video: 0 });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await popup.getByRole('slider', { name: 'Effect Strength' }).press('End'); await youtube.bringToFront(); await ready(youtube, 32);
  }
});
