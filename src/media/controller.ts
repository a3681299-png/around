import { createMediaClockHost, type MediaClockInstance } from '../host/media-clock';
import { advanceMediaTime, initialMediaTime, reconcileMediaTime } from '../world/media-time';
export { frameAt } from '../world/media-time';
import { loadAsset } from '../assets/client';
import { inspectLottie } from '../assets/lottie';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import type { AssetMetadata } from '../assets/validation';
import type { Decoration } from '../design/types';
import { createRasterSource } from './raster';
import { createLottieSource } from './lottie';

interface Resource {
  metadata: AssetMetadata;
  url?: string;
  data?: object;
  raster?: Awaited<ReturnType<typeof createRasterSource>>;
  destroy(): void;
}
interface CacheEntry { refs: number; promise: Promise<Resource> }

/** Encoded assets/decoders are shared; playback time and SVG/canvas belong to a layer. */
export function createMediaController(doc: Document, report: (message: string) => void) {
  const cache = new Map<string, CacheEntry>(), instances = new Set<MediaClockInstance>();
  let closed = false, decodedPixels = 0;
  const clockHost = createMediaClockHost(doc, instances, ANIMATION_LIMITS.renderFps);
  const { canRun, schedule } = clockHost;

  const acquire = (id: string): CacheEntry => {
    let entry = cache.get(id);
    if (entry) { entry.refs++; return entry; }
    const created: CacheEntry = { refs: 1, promise: loadAsset(id).then(async ({ metadata, blob }) => {
      const pixels = metadata.animation && metadata.animation.format !== 'lottie' ? metadata.width * metadata.height * metadata.animation.frameCount : 0;
      if (decodedPixels + pixels > ANIMATION_LIMITS.totalDecodedPixels) throw new Error('配置中のアニメーション画像は合計16M画素までです。');
      decodedPixels += pixels;
      let raster: Resource['raster'], url: string | undefined, data: object | undefined, disposed = false;
      const resource: Resource = { metadata, destroy() {
        if (disposed) return; disposed = true; decodedPixels -= pixels;
        raster?.destroy(); if (url) URL.revokeObjectURL(url);
      } };
      try {
        if (!metadata.animation) { url = URL.createObjectURL(blob); resource.url = url; }
        else if (metadata.animation.format === 'lottie') { data = inspectLottie(new Uint8Array(await blob.arrayBuffer())).data; resource.data = data; }
        else { raster = await createRasterSource(blob, metadata); resource.raster = raster; }
        if (closed || created.refs === 0) { resource.destroy(); throw new Error('表示を終了しました。'); }
        return resource;
      } catch (reason) { resource.destroy(); throw reason; }
    }) };
    cache.set(id, created); return created;
  };
  const release = (id: string, entry: CacheEntry) => {
    if (--entry.refs > 0) return;
    if (cache.get(id) === entry) cache.delete(id);
    void entry.promise.then((resource) => resource.destroy(), () => undefined);
  };

  return {
    attach(parent: HTMLElement) {
      const element = doc.createElement('div'); element.className = 'media'; parent.append(element);
      let layer: Decoration | undefined, visible = false, alive = true, epoch = 0, ready = false, failed = false;
      let source: Resource | undefined, entry: CacheEntry | undefined, assetId = '';
      let svg: ReturnType<typeof createLottieSource> | undefined, canvas: HTMLCanvasElement | undefined;
      let clock = initialMediaTime(), lastFrame = -1, drawing = false;
      let pendingFrame: number | undefined;
      const refresh = () => {
        if (!visible || !canRun() || layer?.kind === 'animation' && !layer.playback.playing) pendingFrame = undefined;
        element.dataset.playback = failed ? 'error' : !ready ? 'loading' : layer?.kind !== 'animation' ? 'still'
          : !visible || clockHost.hidden() ? 'hidden' : clockHost.reducedMotion() ? 'reduced-motion' : clock.finished ? 'finished' : layer.playback.playing ? 'playing' : 'paused';
        if (clock.finished && ready && !failed && visible && canRun() && layer?.kind === 'animation' && layer.playback.playing) void paint(source!.metadata.animation!.frameCount - 1);
      };
      const running = () => ready && !failed && visible && !clock.finished && layer?.kind === 'animation' && layer.playback.playing && source!.metadata.animation!.frameCount > 1;
      const fail = (reason: unknown) => { if (!alive) return; failed = true; svg?.destroy(); refresh(); report(reason instanceof Error ? reason.message : '素材を表示できませんでした。'); schedule(); };
      const paint = async (index: number) => {
        if (lastFrame === index || !source) return;
        if (drawing) { pendingFrame = index; return; }
        const current = epoch; drawing = true;
        try {
          if (canvas) await source.raster!.paint(canvas, index); else svg?.paint(index);
          if (alive && current === epoch) { lastFrame = index; element.dataset.frame = String(index); }
        } catch (reason) { if (alive && current === epoch) fail(reason); }
        finally {
          if (current === epoch) {
            drawing = false;
            const pending = pendingFrame; pendingFrame = undefined;
            // Keep only the latest request; a slow decoder must still paint a terminal frame.
            if (pending !== undefined && alive && !failed) void paint(pending);
          }
        }
      };
      const instance: MediaClockInstance = {
        running, refresh,
        tick(delta) {
          if (!running() || layer?.kind !== 'animation') return;
          const motion = source!.metadata.animation!;
          const advanced = advanceMediaTime(clock, motion, layer.playback, delta, true);
          clock = advanced.state;
          if (clock.finished) refresh();
          void paint(advanced.frame);
        },
        destroy() {
          if (!alive) return; alive = false; epoch++; instances.delete(instance); svg?.destroy();
          if (entry) release(assetId, entry); entry = undefined; source = undefined; canvas = undefined;
          element.remove(); schedule();
        },
      };
      instances.add(instance);
      return {
        element,
        update(next: Decoration, renderable: boolean) {
          if (!alive) return;
          clock = reconcileMediaTime(clock, layer?.kind === 'animation' ? layer.playback : undefined, next.kind === 'animation' ? next.playback : undefined);
          layer = next; visible = renderable;
          if (assetId !== next.assetId) {
            epoch++; const current = epoch;
            svg?.destroy(); svg = undefined; canvas = undefined; element.replaceChildren();
            if (entry) release(assetId, entry);
            assetId = next.assetId; entry = acquire(assetId); ready = failed = drawing = false; clock = initialMediaTime(); lastFrame = -1; pendingFrame = undefined;
            element.style.visibility = 'hidden';
            void entry.promise.then(async (resource) => {
              if (!alive || current !== epoch) return;
              source = resource;
              if (next.kind === 'image' && resource.metadata.animation || next.kind === 'animation' && resource.metadata.animation?.format !== next.format) throw new Error('レイヤーと素材の形式が一致しません。');
              element.dataset.format = resource.metadata.animation?.format ?? 'image';
              if (next.kind === 'image') {
                const image = doc.createElement('img'); image.alt = ''; image.draggable = false; image.src = resource.url!; element.append(image); await image.decode();
              } else {
                if (resource.data) { svg = createLottieSource(element, resource.data); await svg.ready; }
                else { canvas = doc.createElement('canvas'); canvas.width = resource.metadata.width; canvas.height = resource.metadata.height; element.append(canvas); }
                await paint(0);
              }
              if (!alive || current !== epoch) return;
              ready = !failed; element.style.visibility = 'visible'; refresh(); schedule();
            }).catch((reason: unknown) => { if (alive && current === epoch) fail(reason); });
          }
          refresh(); schedule();
        },
        destroy: instance.destroy,
      };
    },
    destroy() {
      if (closed) return; closed = true;
      clockHost.destroy();
      [...instances].forEach((instance) => instance.destroy());
    },
  };
}
