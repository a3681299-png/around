import type { AssetMetadata } from '../assets/validation';
import type { PlaybackSettings } from '../design/types';
import { VIDEO_CAPABILITIES, type AsyncSampler, type FrameSample, type SampleRequest } from './sampler';

/** Browser video playback. Time samples are approximate and never claim a frame index. */
export function createNativeVideo(doc: Document, url: string, metadata: AssetMetadata) {
  const element = doc.createElement('video');
  element.muted = true;
  element.playsInline = true;
  element.preload = 'auto';
  element.setAttribute('aria-hidden', 'true');
  element.disablePictureInPicture = true;
  let closed = false,
    loaded = false,
    serial = 0,
    active = false,
    playGeneration = 0;
  const generations = new Map<string, number>();
  let queued: { request: SampleRequest; generation: number; resolve(value: FrameSample): void } | undefined;
  const abort = new AbortController();
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = doc.defaultView!.setTimeout(
      () => reject(new Error('WebMの読み込みが時間内に完了しませんでした。')),
      10_000,
    );
    const finish = () => {
      if (element.readyState < 2) return;
      doc.defaultView!.clearTimeout(timeout);
      if (
        element.videoWidth !== metadata.width ||
        element.videoHeight !== metadata.height ||
        !Number.isFinite(element.duration) ||
        Math.abs(element.duration * 1000 - metadata.animation!.durationMs) > 1000
      )
        reject(new Error('WebMの寸法・再生時間が一致しません。'));
      else {
        loaded = true;
        resolve();
      }
    };
    element.addEventListener('loadeddata', finish, { signal: abort.signal });
    element.addEventListener(
      'error',
      () => {
        doc.defaultView!.clearTimeout(timeout);
        reject(new Error('このWebMを再生できません。VP8／VP9で書き出してください。'));
      },
      { signal: abort.signal },
    );
    abort.signal.addEventListener(
      'abort',
      () => {
        doc.defaultView!.clearTimeout(timeout);
        reject(new Error('表示を終了しました。'));
      },
      { once: true },
    );
    element.src = url;
  });
  const sample = (): FrameSample =>
    closed
      ? { status: 'pending', reason: 'closed' }
      : !loaded
        ? { status: 'pending', reason: 'decoding' }
        : {
            status: 'fallback',
            frame: { source: element, index: null, timeMs: element.currentTime * 1000, close() {} },
          };
  async function pump() {
    if (active || closed) return;
    active = true;
    try {
      await ready;
      while (queued && !closed) {
        const job = queued;
        queued = undefined;
        try {
          const time = Math.min(Math.max(0, job.request.timeMs / 1000), Math.max(0, element.duration - 0.001));
          if (Math.abs(element.currentTime - time) > 0.001)
            await new Promise<void>((resolve, reject) => {
              const timeout = doc.defaultView!.setTimeout(
                () => finish(new Error('動画シークが時間内に完了しませんでした。')),
                5000,
              );
              const finish = (error?: Error) => {
                doc.defaultView!.clearTimeout(timeout);
                element.removeEventListener('seeked', done);
                element.removeEventListener('error', failed);
                abort.signal.removeEventListener('abort', cancelled);
                error ? reject(error) : resolve();
              };
              const done = () => finish(),
                failed = () => finish(new Error('動画シークに失敗しました。')),
                cancelled = () => finish(new Error('表示を終了しました。'));
              element.addEventListener('seeked', done, { once: true });
              element.addEventListener('error', failed, { once: true });
              abort.signal.addEventListener('abort', cancelled, { once: true });
              element.currentTime = time;
            });
          job.resolve(
            generations.get(job.request.consumer) !== job.generation
              ? { status: 'pending', reason: 'superseded' }
              : sample(),
          );
        } catch (error) {
          job.resolve(closed ? { status: 'pending', reason: 'closed' } : { status: 'error', message: String(error) });
        }
      }
    } catch (error) {
      queued?.resolve(closed ? { status: 'pending', reason: 'closed' } : { status: 'error', message: String(error) });
      queued = undefined;
    } finally {
      active = false;
    }
  }
  const sampler: AsyncSampler = {
    capabilities: VIDEO_CAPABILITIES,
    peek: sample,
    request(request) {
      if (closed) return Promise.resolve({ status: 'pending', reason: 'closed' });
      if (!Number.isFinite(request.timeMs) || !Number.isFinite(request.velocity) || request.velocity < 0)
        return Promise.resolve({ status: 'error', message: '動画の逆再生には対応していません。' });
      const generation = ++serial;
      generations.set(request.consumer, generation);
      queued?.resolve({ status: 'pending', reason: 'superseded' });
      return new Promise<FrameSample>((resolve) => {
        queued = { request, generation, resolve };
        void pump();
      });
    },
    releaseConsumer(consumer) {
      generations.delete(consumer);
      if (queued?.request.consumer === consumer) {
        queued.resolve({ status: 'pending', reason: 'superseded' });
        queued = undefined;
      }
    },
    destroy() {
      if (closed) return;
      closed = true;
      playGeneration++;
      abort.abort();
      queued?.resolve({ status: 'pending', reason: 'closed' });
      queued = undefined;
      generations.clear();
      element.pause();
      element.removeAttribute('src');
      element.load();
      element.remove();
    },
  };
  return {
    ...sampler,
    element,
    ready,
    async play(settings: PlaybackSettings, allowed: boolean) {
      const current = ++playGeneration;
      await ready;
      if (closed || current !== playGeneration) return;
      element.loop = settings.loop;
      element.playbackRate = settings.speed;
      if (allowed && settings.playing) {
        try {
          await element.play();
        } catch (error) {
          if (!closed && current === playGeneration) throw error;
        }
      } else element.pause();
    },
  };
}
