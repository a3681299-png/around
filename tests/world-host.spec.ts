import { build } from 'esbuild';
import path from 'node:path';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import type { WorldFrame } from '../src/world/types';
import type { WorldRecording } from '../src/world/recording';
import type { DesignDocument } from '../src/design/types';

const overlay = '#web-world-themes-decorations', media = `${overlay} .media`;
async function isolate(page: Page, extensionId: string) {
  const session = await page.context().newCDPSession(page), contexts: { id: number; auxData?: { type?: string } }[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context)); await session.send('Runtime.enable');
  let id: number | undefined;
  for (const context of contexts.filter((context) => context.auxData?.type === 'isolated')) {
    const result = await session.send('Runtime.evaluate', { contextId: context.id, expression: 'globalThis.chrome?.runtime?.id', returnByValue: true });
    if (result.result.value === extensionId) { id = context.id; break; }
  }
  if (id === undefined) throw new Error('Extension isolated world not found');
  return { session, async evaluate<T>(expression: string): Promise<T> {
    const result = await session.send('Runtime.evaluate', { contextId: id, expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value as T;
  } };
}
async function reinject(runtime: Awaited<ReturnType<typeof isolate>>, mode: 'legacy' | 'compare' | 'runtime', devtools: boolean) {
  const bundle = await build({ entryPoints: ['src/content/index.ts'], bundle: true, write: false, target: 'chrome120', format: 'iife', loader: { '.css': 'text' },
    define: { __WW_WORLD_MODE__: JSON.stringify(mode), __WW_WORLD_DEVTOOLS__: String(devtools) }, logLevel: 'silent' });
  await runtime.evaluate(bundle.outputFiles[0]!.text);
}
async function open(popup: Page, page: Page): Promise<Locator> {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await page.bringToFront();
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toBeVisible(); return panel;
}
async function image(panel: Locator, page: Page) {
  await panel.getByLabel('画像素材を追加', { exact: true }).setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(page.locator(media)).toHaveAttribute('data-playback', 'still');
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.status')).toHaveText('保存しました。');
  await panel.getByRole('button', { name: '編集を終了' }).click();
}
async function watch(page: Page) {
  await page.locator('#navigate').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible();
}

test('explicit isolated developer recording replays live fixture evaluations and contains no page/form text', async ({ popup, youtube, extensionId }) => {
  test.setTimeout(60_000);
  const panel = await open(popup, youtube); await image(panel, youtube);
  await panel.getByLabel('円形マスクを使う').check(); await panel.getByLabel('動画の一時停止で隠す').check(); await panel.getByLabel('マスクのフェード時間').fill('100'); await save(panel); await watch(youtube);
  const runtime = await isolate(youtube, extensionId);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined');
  await reinject(runtime, 'compare', true); await expect(youtube.locator(media)).toHaveAttribute('data-playback', 'still');
  await expect.poll(() => runtime.evaluate('Boolean(globalThis.__wwWorldRuntime?.frame())')).toBe(true);
  expect(await youtube.evaluate(() => typeof (globalThis as typeof globalThis & { __wwWorldRuntime?: unknown }).__wwWorldRuntime)).toBe('undefined');
  expect(await runtime.evaluate<{ active: boolean }>('__wwWorldRuntime.status()')).toMatchObject({ active: false });
  await runtime.evaluate('__wwWorldRuntime.startRecording()');
  await youtube.mouse.move(240, 330); await youtube.mouse.move(320, 350);
  await youtube.locator('#movie_player [aria-label="Play"]').click(); await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '1');
  await youtube.getByRole('textbox', { name: 'Search' }).fill('PRIVATE_FORM_VALUE_123');
  await youtube.locator('#movie_player [aria-label="Pause"]').click(); await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '0');
  await youtube.setViewportSize({ width: 900, height: 700 }); await youtube.mouse.move(400, 300);
  await expect.poll(() => runtime.evaluate<number>('__wwWorldRuntime.frame().layout.layers[0].frame.width')).toBe(900);
  const value = await runtime.evaluate<{ recording: WorldRecording; expected: WorldFrame; replayed: WorldFrame }>(`(() => {
    const expected = __wwWorldRuntime.frame(), recording = __wwWorldRuntime.stopRecording();
    return { recording, expected, replayed: __wwWorldRuntime.replay(JSON.stringify(recording)).frames.at(-1) };
  })()`);
  expect(value.replayed).toEqual(value.expected); expect(value.recording.inputs.length).toBeGreaterThan(3);
  expect(value.recording.inputs.flatMap((input) => input.events).map((event) => event.type)).toEqual(expect.arrayContaining(['video.play', 'video.pause', 'pointer.click']));
  expect(JSON.stringify(value.recording)).not.toMatch(/PRIVATE_FORM_VALUE|https?:|cookie|authorization|innerHTML|keyCode/);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined'); await runtime.session.detach();
});

test('recording-only listeners stop after artwork changes and idle/OFF leaves no recording loop', async ({ popup, youtube, extensionId }) => {
  const panel = await open(popup, youtube); await image(panel, youtube); await save(panel); await watch(youtube);
  const runtime = await isolate(youtube, extensionId); await reinject(runtime, 'runtime', true);
  await expect.poll(() => runtime.evaluate('Boolean(globalThis.__wwWorldRuntime?.frame())')).toBe(true);
  await runtime.evaluate(`(() => {
    const listeners = new Map(), add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    globalThis.__worldRafs = 0;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this === document && ['pointermove', 'click'].includes(type)) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { if (this === document) listeners.get(type)?.delete(listener); return remove.call(this, type, listener, options); };
    const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = callback => raf(time => { __worldRafs++; callback(time); });
    globalThis.__worldStats = () => ({ pointer: listeners.get('pointermove')?.size ?? 0, click: listeners.get('click')?.size ?? 0, rafs: __worldRafs });
  })()`);
  const stats = () => runtime.evaluate<{ pointer: number; click: number; rafs: number }>('__worldStats()');
  expect(await stats()).toMatchObject({ pointer: 0, click: 0 });
  await runtime.evaluate('__wwWorldRuntime.startRecording()'); await expect.poll(stats).toMatchObject({ pointer: 1, click: 1 });
  await popup.evaluate(async () => {
    const key = 'webWorldThemes.design.youtube', value = (await chrome.storage.local.get(key))[key] as DesignDocument;
    value.decorations[0]!.name = 'Renamed world'; await chrome.storage.local.set({ [key]: value });
  });
  await expect.poll(() => runtime.evaluate('__wwWorldRuntime.status().reason')).toBe('scene-changed');
  await expect.poll(stats).toMatchObject({ pointer: 0, click: 0 });
  await youtube.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = (await stats()).rafs; await youtube.waitForTimeout(150); expect((await stats()).rafs).toBe(before);
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home'); await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(await runtime.evaluate('typeof globalThis.__wwWorldRuntime')).toBe('undefined'); await runtime.session.detach();
});

test('legacy rollback build preserves mask editing and normal click-through', async ({ popup, youtube, extensionId }) => {
  const panel = await open(popup, youtube); await image(panel, youtube); await panel.getByLabel('円形マスクを使う').check(); await save(panel); await watch(youtube);
  const runtime = await isolate(youtube, extensionId); await reinject(runtime, 'legacy', false);
  await expect(youtube.locator(media)).toHaveAttribute('data-mask-intensity', '1'); await youtube.mouse.move(300, 320);
  await expect(youtube.locator(media)).toHaveCSS('mask-image', /radial-gradient/);
  await youtube.locator('#movie_player [aria-label="Mute"]').click();
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(youtube.locator(overlay)).toHaveCount(0); await runtime.session.detach();
});
