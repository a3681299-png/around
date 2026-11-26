import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { launchExtension } from './fixtures';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultModelSettings } from '../src/models/types';
import type { AssetMetadata } from '../src/assets/validation';
import type { AssetSpan } from '../src/diagnostics/asset-profile';

// A real 30,000,000-byte PNG: 3000x2499 RGBA pixels, fixed pseudorandom RGB,
// alpha 255, uncompressed DEFLATE and a bounded ancillary padding chunk.
function image30MB() {
  function chunk(kind: string, data: Buffer) {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write(kind, 4);
    data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const width = 3000,
    height = 2499,
    row = width * 4 + 1;
  const pixels = Buffer.alloc(row * height);
  let seed = 123456789;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels.writeUInt32LE(((seed & 0xffffff) | 0xff000000) >>> 0, y * row + 1 + x * 4);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const parts = [
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })),
  ];
  const end = chunk('IEND', Buffer.alloc(0));
  const padding = 30_000_000 - parts.reduce((n, p) => n + p.length, 0) - end.length - 12;
  return Buffer.concat([...parts, chunk('aroundPD', Buffer.alloc(padding)), end]);
}

test('opt-in saved-source benchmark on real YouTube: reload and same-tab redisplay, five trials each', async () => {
  test.skip(
    process.env.AROUND_ASSET_READ_BENCH !== '1' || !process.env.AROUND_VRM_FILE,
    'Explicit real YouTube, physical GPU and private 54.5MiB VRM measurement; not a CI fixture.',
  );
  test.setTimeout(900_000);
  const label = process.env.AROUND_ASSET_READ_LABEL ?? 'before';
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid benchmark label');
  await mkdir('.work/verification', { recursive: true });
  const image = '.work/verification/asset-read-30mb.png';
  await writeFile(image, image30MB());
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-c3-')), false, {
    headed: true,
    width: 1920,
    height: 1080,
  });
  const report: Record<string, unknown> = { label, sourceBytes: 57_185_776, imageBytes: 30_000_000, trials: [] };
  const trials: Record<string, unknown>[] = [];
  report.trials = trials;
  const persist = () => writeFile(`.work/verification/asset-read-${label}.json`, JSON.stringify(report, null, 2));
  try {
    const control = await context.newPage();
    await control.goto('chrome://extensions/');
    const item = control.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const extension = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await control.goto(`chrome-extension://${extension}/diagnostics/asset-benchmark.html`);
    const assets: AssetMetadata[] = [];
    for (const file of [process.env.AROUND_VRM_FILE!, image, 'tests/fixtures/motion/petal.png']) {
      await control.locator('#file').setInputFiles(path.resolve(file));
      assets.push(
        await control.evaluate(async () => {
          const id = await (globalThis as any).aroundAssetBench.seed();
          return (await chrome.runtime.sendMessage({ type: 'around:assets', action: 'get-metadata', id })).value;
        }),
      );
    }
    const documentFor = (asset: AssetMetadata) => {
      const doc = emptyDesign('youtube', 'retro');
      doc.decorations = [assets[2]!, asset].map((metadata, index) => ({
        id: `image-c3-${index}`,
        name: 'measurement',
        assetId: metadata.id,
        placement: {
          anchor: { kind: 'viewport' as const },
          x: index ? 0.5 : 0.05,
          y: 0.5,
          widthPx: index ? 200 : 16,
          heightPx: index ? 200 : 16,
          rotationDeg: 0,
        },
        opacity: 1,
        zIndex: index,
        visible: true,
        locked: false,
        ...(metadata.model
          ? { kind: 'model3d' as const, source: metadata.model, model: defaultModelSettings(metadata.model) }
          : { kind: 'image' as const }),
      }));
      return parseDesign(doc);
    };
    await control.evaluate(async () => chrome.storage.local.set({ 'around.showArtwork': true }));
    const page = await context.newPage();
    await page.addInitScript(() => {
      (globalThis as any).__c3Paints = [];
      const seen = new WeakSet<Element>();
      let observed: ShadowRoot | undefined;
      const ready = () => {
        const host = document.querySelector('#around-decorations'),
          root = host?.shadowRoot;
        if (root && observed !== root) {
          observed = root;
          new MutationObserver(ready).observe(root, { childList: true, subtree: true, attributes: true });
        }
        const layer = root?.querySelector('[data-image-id="image-c3-1"]');
        const media = layer?.querySelector<HTMLElement>('.media');
        if (!media || seen.has(media)) return;
        const image = media.querySelector('img');
        if (media.dataset.profileReady) {
          seen.add(media);
          (globalThis as any).__c3Paints.push({ at: performance.now(), trace: media.dataset.profileReady });
        } else if (image?.complete && image.naturalWidth && media.dataset.playback === 'still') {
          seen.add(media);
          void image.decode().then(() =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (media.isConnected) (globalThis as any).__c3Paints.push({ at: performance.now() });
              }),
            ),
          );
        }
      };
      new MutationObserver(ready).observe(document, { childList: true, subtree: true });
    });
    for (const [kind, asset] of [
      ['vrm', assets[0]!],
      ['image', assets[1]!],
    ] as const) {
      const doc = documentFor(asset);
      const set = (value: typeof doc) =>
        control.evaluate(async (value) => chrome.storage.local.set({ 'around.design.youtube': value }), value);
      await set(doc);
      for (let run = 0; run < 5; run++) {
        await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
        await page.bringToFront();
        const pollPaint = () => page.evaluate(() => (globalThis as any).__c3Paints.at(-1));
        await expect.poll(pollPaint, { timeout: 60_000 }).toBeTruthy();
        let contentInstance: string | undefined;
        for (const cache of ['reload', 'same-tab'] as const) {
          let start: number | undefined;
          let idleModelStats: Record<string, unknown> | undefined;
          if (cache === 'same-tab') {
            await set({ ...doc, decorations: doc.decorations.slice(0, 1) });
            await expect(page.locator('[data-image-id="image-c3-1"]')).toHaveCount(0);
            if (kind === 'vrm')
              idleModelStats = await page
                .locator('#around-decorations')
                .evaluate((element: HTMLElement) => JSON.parse(element.dataset.aroundModelStats!));
            start = await page.evaluate(() => {
              (globalThis as any).__c3Paints = [];
              return performance.now();
            });
            await set(doc);
            await expect.poll(pollPaint, { timeout: 60_000 }).toBeTruthy();
          }
          const paint = (await pollPaint()) as { at: number; trace?: string };
          // Model completion flushes spans; image completion follows the common source flush.
          const snapshot = await control.evaluate(async () =>
            chrome.runtime.sendMessage({ type: 'ww.asset-profile.v1', action: 'snapshot' }),
          );
          const spans = (snapshot.spans as AssetSpan[]).filter(
            (s) =>
              s.context === 'content' &&
              (paint.trace ? s.id === paint.trace : true) &&
              (!contentInstance || s.contextInstance === contentInstance),
          );
          const source = spans
            .filter(
              (s) =>
                s.name === 'download.validated-source' &&
                s.bytes === asset.byteLength &&
                s.startMs < paint.at &&
                (start === undefined || s.startMs >= start),
            )
            .at(-1);
          const fetchMs = source?.durationMs ?? 0;
          if (cache === 'reload') expect(source).toBeTruthy();
          contentInstance ??= source!.contextInstance;
          const trialSpans = spans.filter(
            (s) =>
              s.contextInstance === contentInstance && s.startMs >= (start ?? source!.startMs) && s.startMs < paint.at,
          );
          const entry = {
            kind,
            cache,
            run: run + 1,
            fetchMs,
            displayMs: paint.at - (start ?? source!.startMs),
            paintAtMs: paint.at,
            sourceStartMs: source?.startMs,
            bytes: asset.byteLength,
            cacheHit: !source,
            route: !source
              ? 'cache'
              : trialSpans.some((s) => s.name === 'download.transport.array-buffer')
                ? 'array-buffer'
                : 'chunks',
            ...(kind === 'vrm'
              ? {
                  modelStats: await page
                    .locator('#around-decorations')
                    .evaluate((element: HTMLElement) => JSON.parse(element.dataset.aroundModelStats!)),
                  ...(idleModelStats ? { idleModelStats } : {}),
                }
              : {}),
            spans: paint.trace ? trialSpans : source ? [source] : [],
          };
          trials.push(entry);
          console.log('ASSET_READ_BENCHMARK ' + JSON.stringify({ ...entry, spans: undefined }));
          await persist();
        }
      }
    }
    report.browser = context.browser()?.version();
  } catch (error) {
    report.failure = String(error);
    throw error;
  } finally {
    await persist();
    await context.close();
  }
});
