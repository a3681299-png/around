import { exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import type { Page, Locator, CDPSession } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, launchExtension } from './fixtures';
import type { DesignDocument } from '../src/design/types';
import { defaultCircleMask } from '../src/effects/types';

const key = 'webWorldThemes.design.youtube', overlay = '#web-world-themes-decorations';
const layers = `${overlay} [data-image-id]`, media = `${layers} .media`;
async function open(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toBeVisible(); await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = youtube.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toBeVisible(); await exposeEditorControls(panel); return panel;
}
async function addImage(panel: Locator, youtube: Page) {
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'still');
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.status')).toHaveText('保存しました。');
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
}
async function setNumber(panel: Locator, label: string, value: number) { await panel.getByLabel(label, { exact: true }).fill(String(value)); }
async function watch(youtube: Page) {
  await youtube.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
}
async function nativeButton(youtube: Page, name: 'Play' | 'Pause') {
  await youtube.locator(`#movie_player [aria-label="${name}"]`).evaluate((button: HTMLButtonElement) => button.click());
}
async function intensity(youtube: Page) { return Number(await youtube.locator(media).first().getAttribute('data-mask-intensity')); }
async function maskCenter(youtube: Page) {
  return youtube.locator(media).first().evaluate((element: HTMLElement) => {
    const match = element.style.maskImage.match(/at ([\d.e+-]+)px ([\d.e+-]+)px/)!; return { x: Number(match[1]), y: Number(match[2]) };
  });
}
async function isolated(page: Page): Promise<{ session: CDPSession; id: number }> {
  const session = await page.context().newCDPSession(page);
  const worlds: { id: number; auxData?: { type?: string } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context)); await session.send('Runtime.enable');
  const world = worlds.find((entry) => entry.auxData?.type === 'isolated');
  if (!world) throw new Error('Extension isolated world not found'); return { session, id: world.id };
}
async function pixels(page: Page, png: Buffer, points: number[][]) {
  return page.evaluate(async ({ base64, points }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return points.map(([x, y]) => [...ctx.getImageData(x!, y!, 1, 1).data]);
  }, { base64: png.toString('base64'), points });
}

test('circle mask actually reveals pixels, feathers edges, follows the pointer and leaves handles usable', async ({ popup, youtube }, info) => {
  const panel = await open(popup, youtube), clip = { x: 185, y: 154, width: 400, height: 300 };
  const baseline = await withCanvas(youtube, () => youtube.screenshot({ clip }));
  const png = await youtube.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 400, 300); return canvas.toDataURL().split(',')[1]!;
  });
  await panel.getByLabel('画像素材を追加').setInputFiles({ name: 'alternate-world.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'still');
  for (const [label, value] of [['画像のX位置', 35], ['画像のY位置', 40], ['画像の幅', 400], ['画像の高さ', 300]] as const) await setNumber(panel, label, value);
  await panel.getByLabel('円形マスクを使う').check(); await setNumber(panel, '光の半径', 80); await setNumber(panel, '境界のぼかし', 20);
  await youtube.mouse.move(385, 304); await expect.poll(() => maskCenter(youtube)).toEqual({ x: 200, y: 150 });
  await panel.getByLabel('光の半径').hover(); await expect.poll(() => maskCenter(youtube)).toEqual({ x: 200, y: 150 });
  const masked = await withCanvas(youtube, () => youtube.screenshot({ clip })), points = [[200, 150], [320, 150], [270, 150]];
  const base = await pixels(youtube, baseline, points), actual = await pixels(youtube, masked, points);
  expect(actual[0]).toEqual([255, 0, 255, 255]); expect(actual[1]).toEqual(base[1]);
  expect(actual[2]).not.toEqual(base[2]); expect(actual[2]).not.toEqual(actual[0]);
  await info.attach('circle-reveal', { body: masked, contentType: 'image/png' });
  await setNumber(panel, '画像の角度', 90); await withCanvas(youtube, () => youtube.mouse.move(445, 304));
  await expect.poll(() => maskCenter(youtube)).toEqual({ x: 200, y: 90 });
  const handle = youtube.locator(`${overlay} [data-handle="se"]`); await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await withCanvas(youtube, async () => {
    await youtube.mouse.move(box.x + 7, box.y + 7); await youtube.mouse.down();
    await youtube.mouse.move(box.x - 33, box.y + 47, { steps: 5 }); await youtube.mouse.up();
  });
  expect(Number(await panel.getByLabel('画像の幅', { exact: true }).inputValue())).toBeGreaterThan(400);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(panel.getByLabel('画像の幅', { exact: true })).toHaveValue('400');
  await panel.getByLabel('マウスに追従').uncheck(); await youtube.mouse.move(10, 10);
  await expect.poll(() => maskCenter(youtube)).toEqual({ x: 200, y: 150 });
  await panel.getByLabel('円形マスクを使う').uncheck(); await expect(youtube.locator(media)).toHaveCSS('mask-image', 'none');
});

test('effect edits survive undo, redo, discard, tab sync, reload and a persistent-browser restart', async ({ popup, youtube, context, profile, extensionId }) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube); await addImage(panel, youtube);
  await panel.getByLabel('円形マスクを使う').check(); await setNumber(panel, '光の半径', 130); await setNumber(panel, '境界のぼかし', 25);
  await panel.getByLabel('マスクの表示強度').fill('65'); await panel.getByLabel('動画の一時停止で隠す').check(); await setNumber(panel, 'マスクのフェード時間', 220);
  await save(panel); const saved = await stored(popup);
  expect(saved).toMatchObject({ schemaVersion: 10, decorations: [{ effects: [{ kind: 'mask', radiusPx: 130, featherPx: 25, intensity: .65 }] }] });
  for (let i = 0; i < 8; i++) await youtube.mouse.move(200 + i * 20, 300);
  await expect(panel.locator('.dirty')).toHaveText('保存済み'); await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click(); await expect(panel.getByLabel('マスクのフェード時間')).toHaveValue('350');
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click(); await expect(panel.locator('.dirty')).toHaveText('保存済み');
  const second = await context.newPage(); await second.goto('https://www.youtube.com/'); await expect(second.locator(media)).toHaveAttribute('data-mask-intensity', '0');
  await youtube.bringToFront(); await setNumber(panel, '光の半径', 190);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await panel.locator('[data-action="select"]').click(); await expect(panel.getByLabel('光の半径')).toHaveValue('130');
  await setNumber(panel, '光の半径', 150); await save(panel);
  await expect.poll(() => second.locator(media).evaluate((el: HTMLElement) => el.style.maskImage)).toContain('150px');
  await second.reload(); await expect(second.locator(media)).toHaveAttribute('data-mask-intensity', '0');
  await panel.getByRole('button', { name: '編集を終了' }).click(); await context.close();
  const restarted = await launchExtension(profile);
  try {
    const page = await restarted.newPage(); await page.goto('https://www.youtube.com/');
    // Fully masked media is unloaded; it no longer decodes an invisible poster.
    await expect(page.locator(media)).toHaveAttribute('data-playback', 'hidden'); await expect(page.locator(media).locator('img')).toHaveCount(0); await expect(page.locator(media)).toHaveAttribute('data-mask-intensity', '0');
    const nextPopup = await restarted.newPage(); await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    const reopened = await open(nextPopup, page); await reopened.locator('[data-action="select"]').click();
    await expect(reopened.getByLabel('光の半径')).toHaveValue('150'); await expect(reopened.getByLabel('マスクの表示強度')).toHaveValue('65');
    await reopened.locator('[data-action="lock"]').click(); await expect(reopened.getByLabel('円形マスクを使う')).toBeDisabled();
    expect((await stored(nextPopup)).decorations[0]?.assetId).toBe(saved.decorations[0]?.assetId);
  } finally { await restarted.close(); }
});

test('native video play/pause drives a reversible fade, shares GIF effects and suspends invisible playback', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube); await watch(youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.gif'));
  await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'playing');
  await panel.getByLabel('円形マスクを使う').check(); await panel.getByLabel('動画の一時停止で隠す').check(); await setNumber(panel, 'マスクのフェード時間', 800);
  await expect.poll(() => intensity(youtube)).toBe(0); await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'hidden');
  // A playing hover-preview outside the main player does not drive this source.
  await youtube.evaluate(() => {
    for (const parent of [document.body, document.querySelector('#movie_player')!]) {
      const preview = document.createElement('video'); Object.defineProperty(preview, 'paused', { value: false });
      parent.prepend(preview); preview.dispatchEvent(new Event('play'));
    }
  });
  // Settle the adapter's asynchronous replacement scan before checking the source.
  await youtube.waitForTimeout(75);
  await expect.poll(() => intensity(youtube)).toBe(0);
  await nativeButton(youtube, 'Play'); await expect.poll(() => intensity(youtube)).toBe(1); await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'playing');
  await nativeButton(youtube, 'Pause'); await youtube.waitForTimeout(140); const mid = await intensity(youtube);
  expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
  await nativeButton(youtube, 'Play'); const reversed = await intensity(youtube); expect(reversed).toBeLessThan(1); expect(Math.abs(reversed - mid)).toBeLessThan(.2);
  await expect.poll(() => intensity(youtube)).toBe(1); await nativeButton(youtube, 'Pause'); await expect.poll(() => intensity(youtube)).toBe(0);
  const stoppedFrame = await youtube.locator(media).getAttribute('data-frame'); await youtube.waitForTimeout(180); expect(await youtube.locator(media).getAttribute('data-frame')).toBe(stoppedFrame);
  await youtube.emulateMedia({ reducedMotion: 'reduce' }); await nativeButton(youtube, 'Play');
  await expect.poll(() => intensity(youtube)).toBe(1); await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'reduced-motion');
  await nativeButton(youtube, 'Pause'); await expect.poll(() => intensity(youtube)).toBe(0);
  await panel.getByLabel('動画の一時停止で隠す').uncheck(); await expect.poll(() => intensity(youtube)).toBe(1);
});

test('semantic player anchor tracks resize, scroll and SPA without persisting runtime coordinates', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube); await addImage(panel, youtube); await watch(youtube);
  await panel.getByLabel('配置の基準').selectOption('video-player');
  for (const [label, value] of [['画像のX位置', 50], ['画像のY位置', 50], ['画像の幅', 200], ['画像の高さ', 120], ['画像の角度', 90]] as const) await setNumber(panel, label, value);
  await panel.getByLabel('円形マスクを使う').check(); await save(panel); const saved = await stored(popup);
  await panel.getByRole('button', { name: '編集を終了' }).click();
  const check = async (point: { x: number; y: number }) => {
    const rect = (await youtube.locator('#movie_player').boundingBox())!;
    const expected = { x: point.y - (rect.y + rect.height / 2) + 100, y: -point.x + rect.x + rect.width / 2 + 60 };
    await expect.poll(async () => { const actual = await maskCenter(youtube); return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y)); }).toBeLessThan(.0001);
  };
  const rect = (await youtube.locator('#movie_player').boundingBox())!, point = { x: rect.x + rect.width / 2 + 35, y: rect.y + rect.height / 2 };
  await youtube.mouse.move(point.x, point.y); await check(point);
  await youtube.setViewportSize({ width: 1250, height: 820 }); await check(point);
  await youtube.locator('#movie_player').evaluate((player: HTMLElement) => { player.style.width = '400px'; player.style.height = '250px'; }); await check(point);
  await youtube.evaluate(() => { document.body.style.minHeight = '1800px'; window.scrollTo(0, 80); }); await check(point);
  expect(await stored(popup)).toEqual(saved);
  await youtube.locator('ytd-guide-entry-renderer a[href="/"]').first().click(); await expect(youtube.locator(layers)).toBeHidden();
  await watch(youtube); await expect(youtube.locator(layers)).toBeVisible(); await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '1');
  expect(await stored(popup)).toEqual(saved);
});

test('32 masks share sources, stay idle, detach on background/OFF/zero and remain click-through', async ({ popup, youtube }, info) => {
  const panel = await open(popup, youtube), runtime = await isolated(youtube);
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: `
    globalThis.__effectRafs = 0; globalThis.__effectLateFrames = []; const registrations = new Map();
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const tracked = (target, type) => target === document && type === 'pointermove' || target instanceof HTMLVideoElement && ['play', 'playing', 'pause', 'ended', 'emptied'].includes(type);
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (tracked(this, type)) { let entries = registrations.get(this); if (!entries) registrations.set(this, entries = new Map()); let group = entries.get(type); if (!group) entries.set(type, group = new Set()); group.add(listener); }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { if (tracked(this, type)) registrations.get(this)?.get(type)?.delete(listener); return remove.call(this, type, listener, options); };
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (callback) => raf((time) => { globalThis.__effectRafs++; if (document.hidden) globalThis.__effectLateFrames.push(String(callback).slice(0, 200)); callback(time); });
    globalThis.__effectStats = () => { let pointer = 0, video = 0; registrations.forEach((entries, target) => entries.forEach((set) => { if (target === document) pointer += set.size; else video += set.size; })); return { pointer, video, rafs: globalThis.__effectRafs }; };
  ` });
  const stats = async (): Promise<{ pointer: number; video: number; rafs: number }> => (await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: '__effectStats()', returnByValue: true })).result.value;
  await addImage(panel, youtube); await save(panel); await panel.getByRole('button', { name: '編集を終了' }).click(); await watch(youtube);
  const source = (await stored(popup)).decorations[0]!, mask = defaultCircleMask();
  mask.bindings.push({ source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: 120 }, target: 'mask.intensity' });
  const design = { ...await stored(popup), decorations: Array.from({ length: 32 }, (_, i) => ({ ...source, id: `image-effect-${i}`, name: `world ${i}`, locked: i % 4 === 0, effects: [mask] })) };
  await popup.evaluate(async ({ key, design }) => chrome.storage.local.set({ [key]: design }), { key, design });
  await expect(youtube.locator(media)).toHaveCount(32); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  await nativeButton(youtube, 'Play'); await expect(youtube.locator(`${media}[data-mask-intensity="1"]`)).toHaveCount(32);
  // Replace the main video without navigation: old native listeners must be released.
  await youtube.locator('#movie_player video').evaluate((old: HTMLVideoElement) => { const next = document.createElement('video'); next.className = 'html5-main-video'; next.muted = true; next.srcObject = old.srcObject; old.pause(); old.replaceWith(next); });
  await expect(youtube.locator(`${media}[data-mask-intensity="0"]`)).toHaveCount(32); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  await runtime.session.send('Performance.enable'); await youtube.waitForTimeout(100);
  const first = await stats(), before = await runtime.session.send('Performance.getMetrics'); await youtube.waitForTimeout(250);
  const idle = await stats(), after = await runtime.session.send('Performance.getMetrics'); expect(idle.rafs - first.rafs).toBeLessThan(4);
  for (let i = 0; i < 16; i++) await youtube.mouse.move(240 + i * 4, 330);
  const moved = await stats(); expect(moved.rafs - idle.rafs).toBe(0);
  const metric = (value: typeof before, name: string) => value.metrics.find((entry) => entry.name === name)!.value;
  const report = { layers: 32, idleSampleMs: 250, idleRafs: idle.rafs - first.rafs, sharedSources: { pointer: idle.pointer, nativeVideoListeners: idle.video },
    scriptMs: Math.round((metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000), jsHeapMiB: Math.round(metric(after, 'JSHeapUsedSize') / 1024 / 1024 * 10) / 10 };
  await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/effect-performance.json', JSON.stringify(report, null, 2));
  await info.attach('effect-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: 'Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));' });
  await expect.poll(stats).toMatchObject({ pointer: 0, video: 0 });
  // A previously queued window-chrome footer measurement is independent of effects.
  // Settle layout in the page world, then require no continuing extension frames.
  await youtube.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const hidden = await stats(); await youtube.waitForTimeout(150);
  const lateFrames = (await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: 'JSON.stringify(__effectLateFrames)', returnByValue: true })).result.value;
  expect((await stats()).rafs, lateFrames).toBe(hidden.rafs);
  await runtime.session.send('Runtime.evaluate', { contextId: runtime.id, expression: 'delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));' }); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  // A decoration covering a page control remains pointer-transparent outside edit mode.
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  await youtube.locator('#movie_player [aria-label="Mute"]').click();
  for (const boundary of ['off', 'zero']) {
    if (boundary === 'off') await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    else await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator(overlay)).toHaveCount(0); await expect.poll(stats).toMatchObject({ pointer: 0, video: 0 });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
    await youtube.bringToFront(); await expect(youtube.locator(media)).toHaveCount(32); await expect.poll(stats).toMatchObject({ pointer: 1, video: 5 });
  }
});
