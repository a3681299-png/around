import { loadAsset } from '../assets/client';
import { inspectLottie } from '../assets/lottie';
import { ANIMATION_LIMITS, type AnimationInfo } from '../assets/motion-types';
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
interface Instance { running(): boolean; tick(delta: number): void; refresh(): void; destroy(): void }

export function frameAt(info: AnimationInfo, elapsed: number): number {
  if (info.format === 'lottie') return Math.min(info.frameCount - 1, Math.floor(elapsed / 1000 * info.frameRate!));
  let end = 0;
  for (const [index, duration] of info.frameDurationsMs!.entries()) { end += duration; if (elapsed < end) return index; }
  return info.frameCount - 1;
}

/** Encoded assets/decoders are shared; playback time and SVG/canvas belong to a layer. */
export function createMediaController(doc: Document, report: (message: string) => void) {
  const view = doc.defaultView!;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map<string, CacheEntry>(), instances = new Set<Instance>();
  let closed = false, decodedPixels = 0, raf: number | undefined, previous: number | undefined;
  const canRun = () => !closed && !doc.hidden && !reduced.matches;
  const schedule = () => {
    const active = canRun() && [...instances].some((instance) => instance.running());
    if (!active) { if (raf !== undefined) view.cancelAnimationFrame(raf); raf = previous = undefined; }
    else if (raf === undefined) raf = view.requestAnimationFrame(tick);
  };
  function tick(time: number) {
    raf = undefined;
    if (!canRun()) { previous = undefined; instances.forEach((instance) => instance.refresh()); return; }
    const delta = previous === undefined ? 0 : time - previous;
    if (previous === undefined || delta >= 1000 / ANIMATION_LIMITS.renderFps - .5) { previous = time; instances.forEach((instance) => instance.tick(delta)); }
    schedule();
  }
  const lifecycle = () => { instances.forEach((instance) => instance.refresh()); schedule(); };
  doc.addEventListener('visibilitychange', lifecycle); reduced.addEventListener('change', lifecycle);

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
      let elapsed = 0, lastFrame = -1, drawing = false, finished = false;
      let pendingFrame: number | undefined;
      const refresh = () => {
        if (!visible || !canRun() || layer?.kind === 'animation' && !layer.playback.playing) pendingFrame = undefined;
        element.dataset.playback = failed ? 'error' : !ready ? 'loading' : layer?.kind !== 'animation' ? 'still'
          : !visible || doc.hidden ? 'hidden' : reduced.matches ? 'reduced-motion' : finished ? 'finished' : layer.playback.playing ? 'playing' : 'paused';
        if (finished && ready && !failed && visible && canRun() && layer?.kind === 'animation' && layer.playback.playing) void paint(source!.metadata.animation!.frameCount - 1);
      };
      const running = () => ready && !failed && visible && !finished && layer?.kind === 'animation' && layer.playback.playing && source!.metadata.animation!.frameCount > 1;
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
      const instance: Instance = {
        running, refresh,
        tick(delta) {
          if (!running() || layer?.kind !== 'animation') return;
          const motion = source!.metadata.animation!;
          elapsed += delta * layer.playback.speed;
          if (elapsed >= motion.durationMs) {
            if (layer.playback.loop) elapsed %= motion.durationMs;
            else { elapsed = motion.durationMs; finished = true; refresh(); }
          }
          void paint(frameAt(motion, elapsed));
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
          if (layer?.kind === 'animation' && next.kind === 'animation' && finished
            && ((!layer.playback.playing && next.playback.playing) || (!layer.playback.loop && next.playback.loop))) { elapsed = 0; finished = false; }
          layer = next; visible = renderable;
          if (assetId !== next.assetId) {
            epoch++; const current = epoch;
            svg?.destroy(); svg = undefined; canvas = undefined; element.replaceChildren();
            if (entry) release(assetId, entry);
            assetId = next.assetId; entry = acquire(assetId); ready = failed = finished = drawing = false; elapsed = 0; lastFrame = -1; pendingFrame = undefined;
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
      if (raf !== undefined) view.cancelAnimationFrame(raf); raf = previous = undefined;
      doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle);
      [...instances].forEach((instance) => instance.destroy());
    },
  };
}
