import { exposeEditorControls } from './helpers/editor-workspace';
import { showArtwork } from './helpers/artwork';
import path from 'node:path';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { test, expect, launchExtension } from './fixtures';
import { openEditor } from './helpers/editor';
import type { Page, Locator } from '@playwright/test';
import type { DesignDocument } from '../src/design/types';

const overlay = '#web-world-themes-decorations',
  presentation =
    ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
  layers = `${presentation} [data-image-id]`;
const file = (name: string) => path.resolve(`tests/fixtures/motion/${name}`);
async function open(popup: Page, page: Page) {
  await showArtwork(popup);
  await page.bringToFront();
  const { panel } = await openEditor(popup, page);
  await exposeEditorControls(panel);
  return panel;
}
async function ready(page: Page, count: number) {
  await expect(page.locator(layers)).toHaveCount(count);
  await expect
    .poll(() =>
      page
        .locator(`${layers} .media`)
        .evaluateAll((nodes) =>
          nodes.every((n) =>
            ['still', 'playing', 'paused', 'reduced-motion'].includes((n as HTMLElement).dataset.playback!),
          ),
        ),
    )
    .toBe(true);
}
async function save(panel: Locator) {
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.locator('.status')).toHaveText('保存しました。');
}
async function stored(popup: Page): Promise<DesignDocument> {
  return popup.evaluate(
    async () =>
      (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
        'webWorldThemes.design.youtube'
      ] as DesignDocument,
  );
}

test('GIF/APNG/WebP use actual native img animation and promote to controlled pause/rate without changing assets', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  for (const [i, name] of ['petal.gif', 'petal.apng', 'petal.webp'].entries()) {
    await panel.getByLabel('アニメーション素材を追加').setInputFiles(file(name));
    await ready(youtube, i + 1);
    const media = youtube.locator(`${layers} .media`).last();
    await expect(media).toHaveAttribute('data-renderer', 'native');
    await expect(media.locator('img')).toHaveCount(1);
    const first = (await media.screenshot()).toString('base64');
    await expect.poll(async () => (await media.screenshot()).toString('base64')).not.toBe(first);
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
    await expect(media).toHaveAttribute('data-playback', 'paused');
    await expect(media).toHaveAttribute('data-renderer', 'controlled');
    const frame = await media.locator('canvas').evaluate((n: HTMLCanvasElement) => n.toDataURL());
    await youtube.waitForTimeout(170);
    expect(await media.locator('canvas').evaluate((n: HTMLCanvasElement) => n.toDataURL())).toBe(frame);
    await panel.getByLabel('再生速度', { exact: true }).fill('2');
    await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).check();
    await expect(media).toHaveAttribute('data-playback', 'playing');
  }
  await save(panel);
  const saved = await stored(popup);
  expect(new Set(saved.decorations.map((n) => n.assetId)).size).toBe(3);
  await youtube.reload();
  await ready(youtube, 3);
  await expect(youtube.locator(`${layers} canvas`)).toHaveCount(3);
});

test('303-frame 36-second GIF imports without predecoding all frames and restores playback settings', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('long.gif'));
  await ready(youtube, 1);
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-renderer', 'native');
  await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
  await panel.getByLabel('再生速度', { exact: true }).fill('3');
  await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).uncheck();
  await save(panel);
  const saved = await stored(popup);
  expect(saved.decorations[0]).toMatchObject({
    format: 'gif',
    playback: { playing: false, speed: 3, loop: false, mode: 'auto' },
  });
  await youtube.reload();
  await ready(youtube, 1);
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-playback', 'paused');
});

test('1080px GIF exceeding the old total-frame pixel limit uses native playback and controlled sampling', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('large.gif'));
  await ready(youtube, 1);
  const media = youtube.locator(`${layers} .media`);
  await expect(media).toHaveAttribute('data-renderer', 'native');
  await expect(media.locator('img')).toHaveJSProperty('naturalWidth', 1080);
  await panel.getByLabel('再生方式', { exact: true }).selectOption('controlled');
  await expect(media.locator('canvas')).toHaveJSProperty('width', 1080);
  const first = await media.getAttribute('data-frame');
  await expect.poll(() => media.getAttribute('data-frame')).not.toBe(first);
});

test('4K APNG downscales explicitly when ImageDecoder ignores desired dimensions and keeps its original asset', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('large.apng'));
  await ready(youtube, 1);
  const media = youtube.locator(`${layers} .media`);
  await expect(media).toHaveAttribute('data-renderer', 'controlled');
  await expect(media.locator('canvas')).toHaveJSProperty('width', 2048);
  await expect(media.locator('canvas')).toHaveJSProperty('height', 1536);
  const first = await media.getAttribute('data-frame');
  await expect.poll(() => media.getAttribute('data-frame')).not.toBe(first);
  const stats = JSON.parse((await youtube.locator(overlay).getAttribute('data-ww-media-stats'))!);
  expect(stats.peakDecodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  expect(stats.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  await save(panel);
  const id = (await stored(popup)).decorations[0]!.assetId;
  expect(
    await popup.evaluate(async (id) => {
      const response = await chrome.runtime.sendMessage({ type: 'web-world-themes:assets', action: 'get', id });
      const bytes = Uint8Array.from(atob(response.value.base64), (c) => c.charCodeAt(0)),
        hash = await crypto.subtle.digest('SHA-256', bytes);
      return {
        width: response.value.metadata.width,
        height: response.value.metadata.height,
        id: `asset-${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('')}`,
      };
    }, id),
  ).toEqual({ width: 4096, height: 3072, id });
});

test('1080p alpha WebM plays, transforms, pauses/rates/loops, saves and survives reload and browser restart', async ({
  popup,
  youtube,
  context,
  profile,
  extensionId,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('alpha1080.webm'));
  await ready(youtube, 1);
  const video = youtube.locator(`${layers} video`);
  await expect(video).toHaveJSProperty('videoWidth', 1920);
  await expect(video).toHaveJSProperty('muted', true);
  const before = await video.evaluate((n: HTMLVideoElement) => n.currentTime);
  await expect.poll(() => video.evaluate((n: HTMLVideoElement) => n.currentTime)).not.toBe(before);
  const alpha = await video.evaluate((n: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(n, 0, 0);
    const data = ctx.getImageData(0, 0, 1920, 1080).data;
    let clear = 0,
      translucent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (!data[i]) clear++;
      if (data[i]! > 0 && data[i]! < 255) translucent++;
    }
    return { clear, translucent };
  });
  expect(alpha.clear).toBeGreaterThan(1_000_000);
  expect(alpha.translucent).toBeGreaterThan(100_000);
  await panel.getByLabel('画像の角度', { exact: true }).fill('25');
  await panel.getByLabel('画像の幅', { exact: true }).fill('320');
  await panel.getByLabel('再生速度', { exact: true }).fill('1.5');
  await expect(video).toHaveJSProperty('playbackRate', 1.5);
  await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).uncheck();
  await expect(video).toHaveJSProperty('paused', true);
  const paused = await video.evaluate((n: HTMLVideoElement) => n.currentTime);
  await youtube.waitForTimeout(180);
  expect(await video.evaluate((n: HTMLVideoElement) => n.currentTime)).toBe(paused);
  await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).uncheck();
  await panel.getByRole('checkbox', { name: 'アニメーションを再生', exact: true }).check();
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-playback', 'finished');
  await panel.getByLabel('画像の角度', { exact: true }).fill('30');
  await youtube.waitForTimeout(100);
  await expect(video).toHaveJSProperty('paused', true);
  await expect(youtube.locator(`${layers} .media`)).toHaveAttribute('data-playback', 'finished');
  await panel.getByLabel('画像の角度', { exact: true }).fill('25');
  await panel.getByRole('checkbox', { name: 'ループ再生', exact: true }).check();
  await save(panel);
  const saved = await stored(popup);
  expect(saved).toMatchObject({
    schemaVersion: 17,
    decorations: [
      { format: 'webm', placement: { rotationDeg: 25, widthPx: 320 }, playback: { speed: 1.5, loop: true } },
    ],
  });
  await youtube.reload();
  await ready(youtube, 1);
  await expect(video).toHaveJSProperty('paused', false);
  expect(await stored(popup)).toEqual(saved);
  await context.close();
  const restarted = await launchExtension(profile);
  try {
    const page = await restarted.newPage();
    await page.goto('https://www.youtube.com/');
    await ready(page, 1);
    await expect(page.locator(`${layers} video`)).toHaveJSProperty('paused', false);
    const nextPopup = await restarted.newPage();
    await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    expect(await stored(nextPopup)).toEqual(saved);
  } finally {
    await restarted.close();
  }
});

test('native video sampler rejects stale time requests, reports approximate frames and shuts down', async ({
  youtube,
}) => {
  const bundle = await build({
    stdin: { contents: "export { createNativeVideo } from './src/media/native-video';", resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'MediaTest',
    platform: 'browser',
  });
  await youtube.evaluate(bundle.outputFiles[0]!.text);
  const url = `data:video/webm;base64,${(await readFile(file('long.webm'))).toString('base64')}`;
  const result = await youtube.evaluate(async (url) => {
    const factory = (
      globalThis as unknown as {
        MediaTest: { createNativeVideo: typeof import('../src/media/native-video').createNativeVideo };
      }
    ).MediaTest;
    const video = factory.createNativeVideo(document, url, {
      id: 'test',
      name: 'test',
      mime: 'video/webm',
      width: 64,
      height: 48,
      byteLength: 1,
      animation: { format: 'webm', frameCount: 0, durationMs: 45_000 },
    });
    await video.ready;
    const samples = await Promise.all(
      [44_000, 20_000, 1000].map((timeMs) => video.request({ consumer: 'test', timeMs, velocity: 1 })),
    );
    const values = samples.map((s) =>
      'frame' in s ? { status: s.status, index: s.frame.index, timeMs: s.frame.timeMs } : s,
    );
    samples.forEach((s) => {
      if ('frame' in s) s.frame.close();
    });
    const reverse = await video.request({ consumer: 'test', timeMs: 0, velocity: -1 });
    video.destroy();
    video.destroy();
    return {
      values,
      reverse,
      paused: video.element.paused,
      src: video.element.getAttribute('src'),
      capabilities: video.capabilities,
    };
  }, url);
  expect(result.values.slice(0, 2)).toEqual([
    { status: 'pending', reason: 'superseded' },
    { status: 'pending', reason: 'superseded' },
  ]);
  expect(result.values[2]).toMatchObject({ status: 'fallback', index: null });
  expect(Math.abs((result.values[2] as { timeMs: number }).timeMs - 1000)).toBeLessThan(80);
  expect(result.reverse.status).toBe('error');
  expect(result.paused).toBe(true);
  expect(result.src).toBeNull();
  expect(result.capabilities).toMatchObject({ seek: 'approximate', reverse: false, speed: true });
});

test('APNG/WebM/image share player-anchored groups, mask signals, history, reduced motion and full teardown', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await youtube.locator('#navigate').evaluate((n: HTMLButtonElement) => n.click());
  await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible();
  await panel
    .getByLabel('アニメーション素材を追加')
    .setInputFiles(['petal.apng', 'alpha1080.webm', 'petal.png'].map(file));
  await ready(youtube, 3);
  const rows = panel.locator('[data-layer-id]');
  for (const row of await rows.all()) {
    await row.locator('[data-action="select"]').click();
    await panel.getByLabel('配置の基準').selectOption('video-player');
  }
  for (let i = 0; i < 3; i++)
    await rows
      .nth(i)
      .locator('[data-action="select"]')
      .click(i ? { modifiers: ['Control'] } : {});
  await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
  await panel.getByLabel('円形マスクを使う').check();
  await panel.getByLabel('動画の一時停止で隠す').check();
  await panel.getByLabel('マスクのフェード時間').fill('120');
  await expect(youtube.locator(`${layers} .media[data-playback="hidden"]`)).toHaveCount(3);
  await expect(youtube.locator(`${layers} video`)).toHaveCount(0);
  await youtube.locator('#movie_player [aria-label="Play"]').evaluate((n: HTMLButtonElement) => n.click());
  await ready(youtube, 3);
  const content = youtube.locator(`${presentation} .group-content`);
  await expect(content).toHaveAttribute('data-mask-intensity', '1');
  const initialMask = await content.evaluate((n: HTMLElement) => n.style.maskImage);
  await youtube.mouse.move(190, 270);
  await expect.poll(() => content.evaluate((n: HTMLElement) => n.style.maskImage)).not.toBe(initialMask);
  await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(panel.getByLabel('マスクのフェード時間')).not.toHaveValue('120');
  await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(panel.getByLabel('マスクのフェード時間')).toHaveValue('120');
  await save(panel);
  const saved = await stored(popup);
  expect(saved.groups?.[0]?.children).toHaveLength(3);
  await youtube.emulateMedia({ reducedMotion: 'reduce' });
  await expect(youtube.locator(`${layers} .media[data-playback="reduced-motion"]`)).toHaveCount(2);
  await expect(youtube.locator(`${layers} video`)).toHaveJSProperty('paused', true);
  await youtube.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(youtube.locator(`${layers} video`)).toHaveJSProperty('paused', false);
  await panel.getByLabel('グループの不透明度').fill('0');
  await expect(youtube.locator(`${layers} .media[data-playback="hidden"]`)).toHaveCount(3);
  await panel.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await ready(youtube, 3);
  expect(await stored(popup)).toEqual(saved);
  await panel.getByRole('button', { name: '編集を終了' }).click();
  await expect(youtube.locator(`${overlay} .handle:visible`)).toHaveCount(0);
  await youtube.locator('#movie_player [aria-label="Pause"]').click();
  await expect(content).toHaveAttribute('data-mask-intensity', '0');
  await expect(youtube.locator(`${layers} video`)).toHaveCount(0);
  await youtube.locator('#movie_player [aria-label="Play"]').click();
  await ready(youtube, 3);
  await youtube.locator(`${layers} video`).evaluate((node) => {
    (globalThis as unknown as { oldArtworkVideo: Element }).oldArtworkVideo = node;
  });
  await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator(overlay)).toHaveCount(0);
  expect(
    await youtube.evaluate(() => {
      const n = (globalThis as unknown as { oldArtworkVideo: HTMLVideoElement }).oldArtworkVideo;
      return { paused: n.paused, src: n.getAttribute('src') };
    }),
  ).toEqual({ paused: true, src: null });
  await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
  await youtube.bringToFront();
  await ready(youtube, 3);
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  await expect(youtube.locator(overlay)).toHaveCount(0);
});

test('scene budget defers excess 1080p videos and resumes waiting layers after hidden resources are released', async ({
  popup,
  youtube,
}) => {
  const panel = await open(popup, youtube);
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('alpha1080.webm'));
  await ready(youtube, 1);
  for (let i = 0; i < 5; i++) await panel.getByRole('button', { name: '複製', exact: true }).click();
  await expect(youtube.locator(layers)).toHaveCount(6);
  await expect(youtube.locator(`${layers} .media[data-playback="waiting"]`)).toHaveCount(1);
  await expect(youtube.locator(`${layers} video`)).toHaveCount(5);
  const stats = async () =>
    JSON.parse((await youtube.locator(overlay).getAttribute('data-ww-media-stats'))!) as {
      decodedBytes: number;
      encodedBytes: number;
      cacheBytes: number;
      peakDecodedBytes: number;
    };
  expect((await stats()).decodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  expect((await stats()).peakDecodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  await panel.locator('[data-layer-id]').last().locator('[data-action="select"]').click();
  await panel.locator('[data-layer-id]').last().getByRole('button', { name: '非表示にする', exact: true }).click();
  await expect(youtube.locator(`${layers} .media[data-playback="waiting"]`)).toHaveCount(0);
  await expect(youtube.locator(`${layers} video`)).toHaveCount(5);
  expect((await stats()).decodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  await save(panel);
  expect(new Set((await stored(popup)).decorations.map((n) => n.assetId)).size).toBe(1);
});

test('OFF aborts an unfinished import decoder and closes its late frame without saving an asset', async ({
  popup,
  youtube,
}) => {
  // UI0-d 3.1: the editor page reads and checks what it imports, so its decoder is the one held.
  const panel = await open(popup, youtube),
    editor = panel.page();
  type Probe = typeof globalThis & {
    preflightCloses: number;
    releasePreflight?: () => void;
    delayedFrame?: VideoFrame;
  };
  await editor.evaluate(() => {
    const probe = globalThis as Probe,
      Decoder = ImageDecoder;
    probe.preflightCloses = 0;
    globalThis.ImageDecoder = class extends Decoder {
      override async decode(options?: ImageDecodeOptions) {
        const result = await super.decode(options);
        probe.delayedFrame = result.image;
        await new Promise<void>((resolve) => {
          probe.releasePreflight = resolve;
        });
        return result;
      }
      override close() {
        probe.preflightCloses++;
        super.close();
      }
    };
  });
  await panel.getByLabel('アニメーション素材を追加').setInputFiles(file('petal.gif'));
  await expect.poll(() => editor.evaluate(() => typeof (globalThis as Probe).releasePreflight)).toBe('function');
  await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
  // The editing on the page ends, as the floating editor closed.
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
  await expect(youtube.locator(overlay)).toHaveCount(0);
  await expect.poll(() => editor.evaluate(() => (globalThis as Probe).preflightCloses)).toBe(1);
  await editor.evaluate(() => (globalThis as Probe).releasePreflight!());
  await expect.poll(() => editor.evaluate(() => (globalThis as Probe).delayedFrame!.codedWidth)).toBe(0);
  expect(
    await popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    ),
  ).toBeUndefined();
});
