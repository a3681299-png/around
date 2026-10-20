import type { AnimationInfo } from '../assets/motion-types';
import type { PlaybackSettings } from '../design/types';

export interface MediaTimeState {
  elapsedMs: number;
  finished: boolean;
}
export const initialMediaTime = (): MediaTimeState => ({ elapsedMs: 0, finished: false });
/** Resume a terminal animation only on the same explicit changes as the old player. */
export function reconcileMediaTime(
  state: MediaTimeState,
  previous: PlaybackSettings | undefined,
  next: PlaybackSettings | undefined,
): MediaTimeState {
  return state.finished && previous && next && ((!previous.playing && next.playing) || (!previous.loop && next.loop))
    ? initialMediaTime()
    : state;
}
/** The caller supplies elapsed time and whether this layer is currently running. */
export function advanceMediaTime(
  previous: MediaTimeState,
  info: AnimationInfo,
  playback: PlaybackSettings,
  deltaMs: number,
  running: boolean,
  timeline?: MediaTimeline,
) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Media time requires a finite positive delta.');
  let elapsedMs = previous.elapsedMs,
    finished = previous.finished;
  if (running) {
    elapsedMs += deltaMs * playback.speed;
    if (elapsedMs >= info.durationMs) {
      if (playback.loop) elapsedMs %= info.durationMs;
      else {
        elapsedMs = info.durationMs;
        finished = true;
      }
    }
  }
  const state = { elapsedMs, finished };
  return { state, frame: timeline ? frameAtTimeline(timeline, elapsedMs) : frameAt(info, elapsedMs) };
}

export function frameAt(info: AnimationInfo, elapsed: number): number {
  if (info.format === 'webm') throw new Error('WebM has no indexed-frame clock.');
  if (info.format === 'lottie') return Math.min(info.frameCount - 1, Math.floor((elapsed / 1000) * info.frameRate!));
  let end = 0;
  for (const [index, duration] of info.frameDurationsMs!.entries()) {
    end += duration;
    if (elapsed < end) return index;
  }
  return info.frameCount - 1;
}

export interface MediaTimeline {
  endsMs: readonly number[];
  durationMs: number;
  count: number;
}
export function prepareMediaTimeline(info: AnimationInfo): MediaTimeline {
  if (info.format === 'webm') throw new Error('WebM uses native sampling.');
  let end = 0;
  const endsMs =
    info.format === 'lottie'
      ? Array.from({ length: info.frameCount }, (_, i) => ((i + 1) * 1000) / info.frameRate!)
      : info.frameDurationsMs!.map((duration) => (end += duration));
  return { endsMs, durationMs: info.durationMs, count: info.frameCount };
}
export function frameAtTimeline(timeline: MediaTimeline, timeMs: number): number {
  let left = 0,
    right = timeline.count - 1;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (timeMs < timeline.endsMs[middle]!) right = middle;
    else left = middle + 1;
  }
  return left;
}
