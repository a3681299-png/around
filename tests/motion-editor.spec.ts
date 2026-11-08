import { exposeEditorControls, withCanvas, beginCanvasGesture } from './helpers/editor-workspace';
import { showArtwork } from './helpers/artwork';
import type { Page, Locator, CDPSession } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect, launchExtension } from './fixtures';
import { closeEditorPages, openEditor } from './helpers/editor';
import type { DesignDocument } from '../src/design/types';
import { emptyDesign } from '../src/design/schema';

const key = 'webWorldThemes.design.youtube',
  overlay = '#web-world-themes-decorations';
const layers =
  ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) [data-image-id]';
const fixture = (extension: string) => path.resolve(`tests/fixtures/motion/petal.${extension}`);
async function open(popup: Page, page: Page) {
  await showArtwork(popup);
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible();
  await page.bringToFront();
  const { panel } = await openEditor(popup, page);
  await exposeEditorControls(panel);
  return panel;
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as DesignDocument, key);
}
async function signature(layer: Locator) {
  return layer
    .locator('.media')
    .evaluate(
      (node) => node.querySelector('canvas')?.toDataURL() ?? node.querySelector('svg')?.innerHTML ?? 'not-ready',
    );
}
async function ready(page: Page, count: number) {
  await expect(page.locator(layers)).toHaveCount(count);
  for (const node of await page.locator(`${layers} .media`).all())
    await expect(node).toHaveAttribute('data-playback', /playing|paused|reduced-motion/);
}
async function drag(page: Page, node: Locator, dx: number, dy: number) {
  await withCanvas(page, async () => {
    const b = (await node.boundingBox())!,
      x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await beginCanvasGesture(node, { x, y });
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  });
}

for (const [extension, format] of [
  ['gif', 'gif'],
  ['apng', 'apng'],
  ['webp', 'animated-webp'],
  ['json', 'lottie'],
] as const) {
  test(`${format}: import, paint actual frames, transform, pause, loop, save, reload and restart`, async ({
    popup,
    youtube,
    context,
    profile,
    extensionId,
  }) => {
    const panel = await open(popup, youtube);
    const errors: string[] = [];
    youtube.on('pageerror', (error) => errors.push(error.message));
    await panel.getByLabel('アニメーション素材を追加').setInputFiles(fixture(extension));
    await ready(youtube, 1);
    await panel.getByLabel('画像のX位置', { exact: true }).fill('65');
    if (format !== 'lottie') await panel.getByLabel('再生方式', { exact: true }).selectOption('controlled');
    const layer = youtube.locator(layers),
      media = layer.locator('.media');
    await expect(media).toHaveAttribute('data-format', format);
    const first = await signature(layer);
    expect(first).not.toBe('not-ready');
    await expect.poll(() => signature(layer)).not.toBe(first);
    if (format !== 'lottie')
      expect(
        await layer
          .locator('canvas')
          .evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]),
      ).toBe(0);
    const original = (await layer.boundingBox())!;
    await drag(youtube, layer, -70, 55);
    expect((await layer.boundingBox())!.x).toBeCloseTo(original.x - 70, 1);
    const id = await layer.getAttribute('data-image-id');
    const controls = youtube.locator(`${overlay} [data-frame-id="${id}"]`);
    await drag(youtube, controls.getByRole('button', { name: '右下でサイズ変更' }), 45, 34);
    expect((await layer.boundingBox())!.width).toBeGreaterThan(original.width + 30);
    await panel.getByLabel('画像の角度', { exact: true }).fill('25');
    await panel.getByLabel('画像の不透明度').fill('70');
    await expect(media).toHaveCSS('opacity', '0.7');
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
    await expect(media).toHaveAttribute('data-playback', 'paused');
    await youtube.waitForTimeout(50);
    const paused = await signature(layer);
    await youtube.waitForTimeout(180);
    expect(await signature(layer)).toBe(paused);
    await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).uncheck();
    if (format === 'lottie') await panel.getByLabel('再生速度', { exact: true }).fill('1.5');
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).check();
    await expect(media).toHaveAttribute('data-playback', 'finished');
    await expect(media).toHaveAttribute('data-frame', format === 'lottie' ? '23' : '2');
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
    await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).check();
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).check();
    await save(panel);
    const saved = await stored(popup);
    expect(saved).toMatchObject({
      schemaVersion: 18,
      decorations: [
        {
          kind: 'animation',
          format,
          opacity: 0.7,
          placement: { rotationDeg: 25 },
          playback: { playing: true, loop: true },
        },
      ],
    });
    expect(JSON.stringify(saved)).not.toMatch(/data:image|base64|blob:/);
    await closeEditorPages(youtube);
    await youtube.reload();
    await ready(youtube, 1);
    await expect(layer).not.toHaveAttribute('data-editable');
    const restartedFrame = await signature(layer);
    await expect.poll(() => signature(layer)).not.toBe(restartedFrame);
    expect(errors).toEqual([]);
    await context.close();
    const restarted = await launchExtension(profile);
    try {
      const page = await restarted.newPage();
      await page.goto('https://www.youtube.com/');
      await ready(page, 1);
      const before = await signature(page.locator(layers));
      await expect.poll(() => signature(page.locator(layers))).not.toBe(before);
      const nextPopup = await restarted.newPage();
      await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
      expect(await stored(nextPopup)).toEqual(saved);
    } finally {
      await restarted.close();
    }
  });
}

test('file/drop animation layers share image operations, playback history, locks, discard and tab synchronization', async ({
  popup,
  youtube,
  context,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(fixture('png'));
  await expect(youtube.locator(layers).locator('img')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await panel.getByLabel('アニメーション素材を追加').setInputFiles([fixture('gif'), fixture('json')]);
  await expect(youtube.locator(layers)).toHaveCount(3);
  await expect(youtube.locator(layers).first().locator('img')).toBeVisible();
  await expect(youtube.locator(layers).last().locator('.media')).toHaveAttribute('data-playback', 'playing');
  const webp = await readFile(fixture('webp'));
  await youtube.evaluate((encoded) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], 'drop.webp', { type: 'image/webp' }),
    );
    document.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, clientX: 250, clientY: 330, bubbles: true, cancelable: true }),
    );
  }, webp.toString('base64'));
  await expect(youtube.locator(layers)).toHaveCount(4);
  await save(panel);
  const saved = await stored(popup);
  const second = await context.newPage();
  await second.goto('https://www.youtube.com/');
  await expect(second.locator(layers)).toHaveCount(4);
  await youtube.bringToFront();
  await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(youtube.locator(layers).last().locator('.media')).toHaveAttribute('data-playback', 'playing');
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
  await save(panel);
  await expect(second.locator(layers).last().locator('.media')).toHaveAttribute('data-playback', 'paused');
  const row = panel.locator('[data-layer-id]').first();
  await row.locator('[data-action="select"]').click();
  await row.getByRole('button', { name: 'ロック', exact: true }).click();
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(layers)).toHaveCount(4);
  await expect(panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: 'ロック解除' }).click();
  await youtube.keyboard.press('Control+d');
  await expect(youtube.locator(layers)).toHaveCount(5);
  await youtube.keyboard.press('Delete');
  await expect(youtube.locator(layers)).toHaveCount(4);
  await youtube.keyboard.press('Control+z');
  await expect(youtube.locator(layers)).toHaveCount(5);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(4);
  await panel.locator('[data-layer-id]').last().locator('[data-action="select"]').click();
  await expect(panel.getByRole('group', { name: 'アニメーションの再生' })).toBeHidden();
  expect((await stored(popup)).decorations.map((layer) => layer.assetId)).toEqual(
    saved.decorations.map((layer) => layer.assetId),
  );
});

test('player anchors follow SPA; normal animation stays click-through and OFF/zero fully unmount it', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(fixture('gif'));
  await ready(youtube, 1);
  await youtube.locator('#navigate').evaluate((node: HTMLButtonElement) => node.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel.getByLabel('配置の基準').selectOption('video-player');
  await save(panel);
  await panel.getByRole('button', { name: '編集を終了' }).click();
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  await youtube.locator('ytd-guide-entry-renderer a[href="/"]').first().click();
  await expect(youtube.locator(layers)).toBeHidden();
  await youtube.locator('#navigate').click();
  await ready(youtube, 1);
  for (const boundary of ['off', 'emergency'] as const) {
    if (boundary === 'off') await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    else await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
    await expect(youtube.locator(overlay)).toHaveCount(0);
    if (boundary === 'off') await showArtwork(popup);
    else await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
    await youtube.bringToFront();
    await ready(youtube, 1);
  }
});

test('untrusted Lottie is rejected in content and worker; native page classes cannot start external loads', async ({
  popup,
  youtube,
  context,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  await context.route('https://untrusted.example/**', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  youtube.on('pageerror', (error) => errors.push(error.message));
  const panel = await open(popup, youtube);
  await youtube.evaluate(() => {
    const node = document.createElement('div');
    node.className = 'lottie';
    node.setAttribute('data-animation-path', 'https://untrusted.example/payload.json');
    document.body.append(node);
  });
  const source = JSON.parse(await readFile(fixture('json'), 'utf8'));
  const invalid = { ...source, assets: [{ id: 'image', u: 'https://untrusted.example/', p: 'asset.svg' }] };
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(panel.locator('.status')).toContainText(/外部|埋め込み/);
  await expect(youtube.locator(layers)).toHaveCount(0);
  const result = await popup.evaluate(
    async (base64) =>
      chrome.runtime.sendMessage({
        type: 'web-world-themes:assets',
        action: 'import',
        session: 'session-invalid',
        files: [{ name: 'bad.json', mime: 'application/json', base64 }],
      }),
    Buffer.from(JSON.stringify(invalid)).toString('base64'),
  );
  expect(result.ok).toBe(false);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(fixture('json'));
  await ready(youtube, 1);
  const first = await signature(youtube.locator(layers));
  await expect.poll(() => signature(youtube.locator(layers))).not.toBe(first);
  await youtube.waitForTimeout(180);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

/** Test-only instrumentation in the actual extension isolated world. */
async function isolated(page: Page): Promise<{ session: CDPSession; id: number }> {
  const session = await page.context().newCDPSession(page);
  const worlds: Array<{ id: number; auxData?: { type?: string } }> = [];
  session.on('Runtime.executionContextCreated', (event) => worlds.push(event.context));
  await session.send('Runtime.enable');
  const world = worlds.find((entry) => entry.auxData?.type === 'isolated');
  if (!world) throw new Error('Extension isolated world not found');
  return { session, id: world.id };
}

test('eight animations share decoders, stay bounded, respect reduced motion/hidden state and release playback on OFF', async ({
  popup,
  youtube,
}, info) => {
  const panel = await open(popup, youtube),
    runtime = await isolated(youtube);
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression: `
    globalThis.__motionCounts = { decoders: 0, closes: 0 };
    globalThis.__motionRaf = new Set();
    const requestFrame = globalThis.requestAnimationFrame.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = (callback) => { const id = requestFrame(time => { globalThis.__motionRaf.delete(id); callback(time); }); globalThis.__motionRaf.add(id); return id; };
    globalThis.cancelAnimationFrame = (id) => { globalThis.__motionRaf.delete(id); cancelFrame(id); };
    const OriginalDecoder = globalThis.ImageDecoder;
    globalThis.ImageDecoder = class extends OriginalDecoder {
      constructor(options) { super(options); globalThis.__motionCounts.decoders++; this.countedClosed = false; }
      close() { if (!this.countedClosed) { this.countedClosed = true; globalThis.__motionCounts.closes++; } super.close(); }
    };`,
  });
  const files = ['gif', 'webp', 'json', 'gif', 'webp', 'json', 'gif', 'json'];
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(files.map(fixture));
  await ready(youtube, 8);
  await expect(panel.getByRole('button', { name: 'アニメーションを追加', exact: true })).toBeEnabled();
  await expect(panel.getByRole('button', { name: '複製', exact: true })).toBeEnabled();
  for (const row of await panel.locator('[data-layer-id]').all()) {
    await row.locator('[data-action="select"]').click();
    if (await panel.getByLabel('再生方式', { exact: true }).isVisible())
      await panel.getByLabel('再生方式', { exact: true }).selectOption('controlled');
  }
  await youtube.evaluate((selector) => {
    document.documentElement.dataset.motionFrames = '0';
    const root = document.querySelector(selector)!.shadowRoot!;
    new MutationObserver((records) => {
      document.documentElement.dataset.motionFrames = String(
        Number(document.documentElement.dataset.motionFrames) + records.length,
      );
    }).observe(root, { attributes: true, subtree: true, attributeFilter: ['data-frame'] });
  }, overlay);
  await runtime.session.send('Performance.enable');
  const before = await runtime.session.send('Performance.getMetrics');
  await youtube.waitForTimeout(1500);
  const after = await runtime.session.send('Performance.getMetrics');
  const metric = (result: typeof before, name: string) => result.metrics.find((entry) => entry.name === name)!.value;
  const counts = (
    await runtime.session.send('Runtime.evaluate', {
      contextId: runtime.id,
      expression: 'globalThis.__motionCounts',
      returnByValue: true,
    })
  ).result.value;
  const performance = {
    layers: 8,
    uniqueAssets: 3,
    sampledMs: 1500,
    frames: Number(await youtube.locator('html').getAttribute('data-motion-frames')),
    scriptMs: Math.round((metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000),
    taskMs: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000),
    jsHeapMiB: Math.round((metric(after, 'JSHeapUsedSize') / 1024 / 1024) * 10) / 10,
    counts,
  };
  expect(performance.frames).toBeGreaterThan(16);
  expect(performance.frames).toBeLessThanOrEqual(8 * 48);
  expect(performance.jsHeapMiB).toBeLessThan(128);
  expect(counts.decoders - counts.closes).toBe(2);
  await mkdir('.work/verification', { recursive: true });
  await writeFile('.work/verification/motion-performance.json', JSON.stringify(performance, null, 2));
  await info.attach('motion-performance', {
    body: JSON.stringify(performance, null, 2),
    contentType: 'application/json',
  });
  await youtube.emulateMedia({ reducedMotion: 'reduce' });
  await expect(youtube.locator(`${layers} .media[data-playback="reduced-motion"]`)).toHaveCount(8);
  await youtube.waitForTimeout(50);
  const reduced = await youtube.locator('html').getAttribute('data-motion-frames');
  await youtube.waitForTimeout(180);
  expect(await youtube.locator('html').getAttribute('data-motion-frames')).toBe(reduced);
  await youtube.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(youtube.locator(`${layers} .media[data-playback="playing"]`)).toHaveCount(8);
  await expect.poll(() => youtube.locator('html').getAttribute('data-motion-frames')).not.toBe(reduced);
  // Simulate document.hidden inside the extension world, not the page's separate JS wrapper.
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression:
      'Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));',
  });
  await expect(youtube.locator(`${layers} .media[data-playback="hidden"]`)).toHaveCount(8);
  await youtube.waitForTimeout(50);
  const hidden = await youtube.locator('html').getAttribute('data-motion-frames');
  await youtube.waitForTimeout(180);
  expect(await youtube.locator('html').getAttribute('data-motion-frames')).toBe(hidden);
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression: 'delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));',
  });
  await expect(youtube.locator(`${layers} .media[data-playback="playing"]`)).toHaveCount(8);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  const stopped = (
    await runtime.session.send('Runtime.evaluate', {
      contextId: runtime.id,
      expression: 'globalThis.__motionCounts',
      returnByValue: true,
    })
  ).result.value;
  expect(stopped.closes).toBe(stopped.decoders);
  await expect
    .poll(
      async () =>
        (
          await runtime.session.send('Runtime.evaluate', {
            contextId: runtime.id,
            expression: 'globalThis.__motionRaf.size',
            returnByValue: true,
          })
        ).result.value,
    )
    .toBe(0);
});

test('an external save during asset preflight is preserved and the unfinished import is released', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube),
    runtime = await isolated(youtube);
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression: `
    const sendAssetMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message) => {
      const result = await sendAssetMessage(message);
      if (message.action === 'validate') await new Promise(resolve => { globalThis.releaseAssetCheck = resolve; });
      return result;
    };`,
  });
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(fixture('gif'));
  await expect
    .poll(
      async () =>
        (
          await runtime.session.send('Runtime.evaluate', {
            contextId: runtime.id,
            expression: 'typeof globalThis.releaseAssetCheck',
            returnByValue: true,
          })
        ).result.value,
    )
    .toBe('function');
  const foreign: DesignDocument = {
    ...emptyDesign('youtube', 'retro'),
    rules: [{ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#cceeff' } }],
  };
  await popup.evaluate(async ({ k, design }) => chrome.storage.local.set({ [k]: design }), { k: key, design: foreign });
  await expect(youtube.locator('[data-ww-surface~="video-card"]').first()).toHaveCSS(
    'background-color',
    'rgb(204, 238, 255)',
  );
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression: 'globalThis.releaseAssetCheck()',
  });
  await expect(panel.locator('.status')).toContainText('素材の追加を中止');
  await expect(youtube.locator(layers)).toHaveCount(0);
  expect(await stored(popup)).toEqual(foreign);
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  const assetId = `asset-${createHash('sha256')
    .update(await readFile(fixture('gif')))
    .digest('hex')}`;
  await expect
    .poll(() =>
      popup.evaluate(
        async (id) => (await chrome.runtime.sendMessage({ type: 'web-world-themes:assets', action: 'get', id })).ok,
        assetId,
      ),
    )
    .toBe(false);
});

test('a slow raster decoder still paints the terminal frame when looping is disabled', async ({ popup, youtube }) => {
  const panel = await open(popup, youtube),
    runtime = await isolated(youtube);
  await runtime.session.send('Runtime.evaluate', {
    contextId: runtime.id,
    expression: `
    const FastDecoder = globalThis.ImageDecoder;
    globalThis.ImageDecoder = class extends FastDecoder {
      async decode(options) {
        const result = await super.decode(options);
        if (options.frameIndex > 0) await new Promise(resolve => setTimeout(resolve, 300));
        return result;
      }
    };`,
  });
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(fixture('gif'));
  await ready(youtube, 1);
  await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).uncheck();
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-playback', 'finished');
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-frame', '2');
  expect(
    await youtube
      .locator(`${layers} canvas`)
      .evaluate((node: HTMLCanvasElement) => node.getContext('2d')!.getImageData(48, 20, 1, 1).data[3]),
  ).toBe(255);
});
