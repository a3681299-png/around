import { createMediaClockHost, type MediaClockInstance } from '../host/media-clock';
import { advanceMediaTime, frameAtTimeline, initialMediaTime, reconcileMediaTime } from '../world/media-time';
export { frameAt } from '../world/media-time';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import type { Decoration } from '../design/types';
import { createLottieSource } from './lottie';
import { createNativeImage } from './native-image';
import { createNativeVideo } from './native-video';
import { createMediaBudget, MediaBudgetUnavailable, MEDIA_BUDGET, type MediaBudget } from './budget';
import { createResourceCache, type MediaResource, type ResourceEntry } from './resources';
import { rasterSize } from './raster-sampler';

type Mode = 'image' | 'native' | 'controlled' | 'lottie' | 'video';
type Stats = ReturnType<MediaBudget['stats']>;

/** Assets and samplers are shared; presentation, time and cancellation belong to a layer. */
export function createMediaController(doc: Document, report: (message: string) => void, observe?: (stats: Stats) => void) {
  const budget = createMediaBudget(), resources = createResourceCache(budget), instances = new Set<MediaClockInstance>();
  const clockHost = createMediaClockHost(doc, instances, ANIMATION_LIMITS.renderFps);
  let closed = false, serial = 0;
  const unsubscribe = budget.subscribe(() => instances.forEach((instance) => instance.refresh()));
  const unobserve = budget.observe(() => observe?.(budget.stats()));
  observe?.(budget.stats());
  return {
    attach(parent: HTMLElement) {
      const element = doc.createElement('div'); element.className = 'media'; parent.append(element);
      const consumer = `media-${++serial}`, surface = `${consumer}-surface`;
      let layer: Decoration | undefined, visible = false, alive = true, epoch = 0, paintGeneration = 0;
      let source: MediaResource | undefined, entry: ResourceEntry | undefined, assetId = '';
      let mode: Mode | undefined, ready = false, failed = false, loading = false, waiting: string | undefined;
      let image: ReturnType<typeof createNativeImage> | undefined, svg: ReturnType<typeof createLottieSource> | undefined;
      let video: ReturnType<typeof createNativeVideo> | undefined;
      let canvas: HTMLCanvasElement | undefined, clock = initialMediaTime(), lastFrame = -1, nativeStamp: number | undefined, forceControlled = false;
      const signature = () => { const s = budget.stats(); return `${s.encodedBytes}/${s.decodedBytes}`; };
      const wanted = () => visible && !clockHost.hidden();
      const sampleNativeTime = () => {
        const now = clockHost.now();
        if (video) clock = { elapsedMs: video.element.currentTime * 1000, finished: video.element.ended };
        if (nativeStamp !== undefined && source?.timeline && layer?.kind === 'animation')
          clock = advanceMediaTime(clock, source.metadata.animation!, layer.playback, Math.max(0, now - nativeStamp), true, source.timeline).state;
        nativeStamp = mode === 'native' && wanted() ? now : undefined;
      };
      const releaseDisplay = () => {
        epoch++; paintGeneration++; ready = loading = false; nativeStamp = undefined;
        source?.releaseSampler(consumer); source?.unuse(consumer);
        image?.destroy(); image = undefined; svg?.destroy(); svg = undefined;
        video?.destroy(); video = undefined;
        if (canvas) { canvas.width = canvas.height = 1; canvas.remove(); canvas = undefined; }
        budget.release(surface); mode = undefined; lastFrame = -1; element.replaceChildren();
      };
      const state = () => {
        element.dataset.playback = failed ? 'error' : !wanted() ? 'hidden' : waiting ? 'waiting' : !ready ? 'loading' : layer?.kind !== 'animation' ? 'still'
          : clockHost.reducedMotion() ? 'reduced-motion' : clock.finished ? 'finished' : layer.playback.playing ? 'playing' : 'paused';
        element.style.visibility = ready ? 'visible' : 'hidden';
      };
      const fail = (reason: unknown) => {
        if (!alive) return; releaseDisplay(); failed = true; waiting = undefined; state();
        report(reason instanceof Error ? reason.message : '素材を表示できませんでした。'); clockHost.schedule();
      };
      const paint = async (timeMs: number) => {
        if (!source?.timeline || !wanted() || failed) return;
        const index = frameAtTimeline(source.timeline, timeMs);
        if (index === lastFrame) return;
        const generation = ++paintGeneration, current = epoch;
        if (svg) { const before = clockHost.now(); svg.paint(index); budget.reportDraw(clockHost.now() - before); lastFrame = index; element.dataset.frame = String(index); return; }
        if (!canvas) return;
        const sampler = source.sampler(consumer);
        const result = await sampler.request({ consumer, timeMs, velocity: layer?.kind === 'animation' && layer.playback.playing && clockHost.canRun() && !clock.finished ? layer.playback.speed : 0 });
        if (result.status === 'exact' || result.status === 'fallback') {
          try {
            if (!alive || current !== epoch || generation !== paintGeneration || !wanted() || !canvas) return;
            const before = clockHost.now(), context = canvas.getContext('2d');
            if (!context) throw new Error('描画領域を確保できませんでした。');
            context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(result.frame.source, 0, 0, canvas.width, canvas.height);
            budget.reportDraw(clockHost.now() - before); lastFrame = result.frame.index ?? index; element.dataset.frame = String(lastFrame); waiting = undefined; ready = true; state();
          } catch (error) { fail(error); } finally { result.frame.close(); }
          if (alive && current === epoch && (clock.finished || !clockHost.canRun() || layer?.kind === 'animation' && !layer.playback.playing)) source?.releaseSampler(consumer);
        } else if (alive && current === epoch && generation === paintGeneration) {
          if (result.status === 'error') fail(new Error(result.message));
          else if (result.status === 'pending' && result.reason === 'budget') { waiting = signature(); state(); }
        }
      };
      const desiredMode = (): Mode => {
        if (layer?.kind !== 'animation') return 'image';
        if (layer.format === 'lottie') return 'lottie';
        if (layer.format === 'webm') return 'video';
        const p = layer.playback;
        return p.mode === 'auto' && !forceControlled && p.playing && p.loop && p.speed === 1 && source?.metadata.animation?.loopCount === 0 && !clockHost.reducedMotion() ? 'native' : 'controlled';
      };
      const load = () => {
        loading = true; const current = epoch; entry = resources.acquire(assetId);
        void entry.promise.then((resource) => {
          if (!alive || current !== epoch) return;
          source = resource; loading = false;
          if (layer?.kind === 'image' && resource.metadata.animation || layer?.kind === 'animation' && resource.metadata.animation?.format !== layer.format) throw new Error('レイヤーと素材の形式が一致しません。');
          element.dataset.format = resource.metadata.animation?.format ?? 'image'; refresh();
        }).catch((error: unknown) => {
          if (!alive || current !== epoch) return;
          loading = false; if (entry) resources.release(assetId, entry); entry = undefined;
          if (error instanceof MediaBudgetUnavailable) { waiting = signature(); state(); } else fail(error);
        });
      };
      const setup = (next: Mode) => {
        releaseDisplay(); mode = next; loading = true; source!.use(consumer); const current = epoch;
        element.dataset.renderer = next;
        const metadata = source!.metadata, size = next === 'controlled' ? rasterSize(metadata) : metadata;
        const bytes = size.width * size.height * 4 * (next === 'native' || next === 'video' ? 3 : 1);
        if (!budget.reserve(surface, bytes, 'surface')) {
          releaseDisplay();
          if (next === 'native') { forceControlled = true; refresh(); return; }
          if (bytes > MEDIA_BUDGET.decodedBytes) { fail(new Error('この動画は1素材で再生予算を超えます。解像度を下げて書き出してください。')); return; }
          waiting = signature(); state(); return;
        }
        void (async () => {
          if (next === 'native' || next === 'image') {
            image = createNativeImage(doc, source!.url, metadata); element.append(image.element); await image.ready;
            if (alive && current === epoch) { element.dataset.frame = next === 'native' ? 'native' : '0'; nativeStamp = next === 'native' ? clockHost.now() : undefined; }
          } else if (next === 'video') {
            video = createNativeVideo(doc, source!.url, metadata); element.append(video.element); const created = video;
            created.element.addEventListener('ended', () => { if (alive && current === epoch) { sampleNativeTime(); state(); } });
            created.element.addEventListener('error', () => { if (alive && current === epoch) fail(new Error('動画の再生に失敗しました。')); });
            await created.ready;
            if (clock.elapsedMs > 0) { const result = await created.request({ consumer, timeMs: clock.elapsedMs, velocity: 0 }); if ('frame' in result) result.frame.close(); else if (result.status === 'error') throw new Error(result.message); }
            if (alive && current === epoch && layer?.kind === 'animation') { element.dataset.frame = 'native'; await created.play(layer.playback, clockHost.canRun() && !clock.finished); }
          } else if (next === 'lottie') { svg = createLottieSource(element, source!.data!); await svg.ready; await paint(clock.elapsedMs); }
          else { canvas = doc.createElement('canvas'); canvas.width = size.width; canvas.height = size.height; element.append(canvas); await paint(clock.elapsedMs); }
          if (!alive || current !== epoch) return;
          loading = false; ready = !failed && !waiting; refresh();
        })().catch((error: unknown) => { if (alive && current === epoch) fail(error); });
      };
      const running = () => ready && !failed && wanted() && !clock.finished && layer?.kind === 'animation' && layer.playback.playing && (mode === 'controlled' || mode === 'lottie') && source!.metadata.animation!.frameCount > 1;
      const refresh = () => {
        if (!alive) return;
        if (!wanted()) {
          if (mode) { sampleNativeTime(); if (mode === 'native') forceControlled = true; releaseDisplay(); }
          // A resource still loading must not later activate a hidden layer.
          if (loading && !source) { epoch++; loading = false; if (entry) resources.release(assetId, entry); entry = undefined; }
          state(); return;
        }
        if (failed || loading) { state(); return; }
        if (waiting && waiting === signature()) { state(); return; }
        waiting = undefined;
        if (source?.disposed) { source = undefined; if (entry) resources.release(assetId, entry); entry = undefined; }
        if (!source) { load(); state(); return; }
        const next = desiredMode();
        if (mode !== next) { sampleNativeTime(); if (mode === 'native') forceControlled = true; setup(next); }
        else if (video && layer?.kind === 'animation') {
          const current = epoch; void video.play(layer.playback, clockHost.canRun() && !clock.finished).catch((error: unknown) => { if (alive && current === epoch && wanted()) fail(error); });
        }
        else if ((mode === 'controlled' || mode === 'lottie') && (!ready || !clockHost.canRun() || !layer || layer.kind === 'animation' && !layer.playback.playing || clock.finished)) {
          if (ready) { paintGeneration++; source.releaseSampler(consumer); } void paint(clock.elapsedMs);
        }
        state(); clockHost.schedule();
      };
      const instance: MediaClockInstance = {
        running, refresh,
        tick(delta, time) {
          if (!running() || layer?.kind !== 'animation') return;
          clock = advanceMediaTime(clock, source!.metadata.animation!, layer.playback, delta, true, source!.timeline!).state;
          if (budget.allowDraw(time) || clock.finished) void paint(clock.elapsedMs);
          state();
        },
        destroy() {
          if (!alive) return; alive = false; releaseDisplay(); instances.delete(instance);
          if (entry) resources.release(assetId, entry); entry = undefined; source = undefined; element.remove(); clockHost.schedule();
        },
      };
      instances.add(instance);
      return { element,
        update(next: Decoration, renderable: boolean) {
          if (!alive) return; sampleNativeTime();
          const changed = assetId !== next.assetId;
          if (changed) { releaseDisplay(); if (entry) resources.release(assetId, entry); source = undefined; entry = undefined; assetId = next.assetId; failed = false; clock = initialMediaTime(); forceControlled = false; }
          else clock = reconcileMediaTime(clock, layer?.kind === 'animation' ? layer.playback : undefined, next.kind === 'animation' ? next.playback : undefined);
          if (next.kind === 'animation' && layer?.kind === 'animation' && next.playback.mode === 'auto' && layer.playback.mode === 'controlled') forceControlled = false;
          const configChanged = layer?.kind === 'animation' && next.kind === 'animation' && JSON.stringify(layer.playback) !== JSON.stringify(next.playback);
          layer = next; visible = renderable; element.dataset.format = next.kind === 'animation' ? next.format : 'image'; if (changed || configChanged) waiting = undefined;
          refresh();
        }, destroy: instance.destroy,
      };
    },
    destroy() { if (closed) return; closed = true; clockHost.destroy(); unsubscribe(); unobserve(); [...instances].forEach((instance) => instance.destroy()); resources.destroy(); budget.destroy(); observe?.(budget.stats()); },
  };
}
