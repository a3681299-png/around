import type { AnimationInfo } from '../assets/motion-types';
import type { PlaybackSettings } from '../design/types';

export interface MediaTimeState { elapsedMs: number; finished: boolean }
export const initialMediaTime = (): MediaTimeState => ({ elapsedMs: 0, finished: false });
/** Resume a terminal animation only on the same explicit changes as the old player. */
export function reconcileMediaTime(state: MediaTimeState, previous: PlaybackSettings | undefined, next: PlaybackSettings | undefined): MediaTimeState {
  return state.finished && previous && next && ((!previous.playing && next.playing) || (!previous.loop && next.loop)) ? initialMediaTime() : state;
}
/** The caller supplies elapsed time and whether this layer is currently running. */
export function advanceMediaTime(previous: MediaTimeState, info: AnimationInfo, playback: PlaybackSettings, deltaMs: number, running: boolean) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Media time requires a finite positive delta.');
  let elapsedMs = previous.elapsedMs, finished = previous.finished;
  if (running) {
    elapsedMs += deltaMs * playback.speed;
    if (elapsedMs >= info.durationMs) {
      if (playback.loop) elapsedMs %= info.durationMs;
      else { elapsedMs = info.durationMs; finished = true; }
    }
  }
  const state = { elapsedMs, finished };
  return { state, frame: frameAt(info, elapsedMs) };
}

export function frameAt(info: AnimationInfo, elapsed: number): number {
  if (info.format === 'lottie') return Math.min(info.frameCount - 1, Math.floor(elapsed / 1000 * info.frameRate!));
  let end = 0;
  for (const [index, duration] of info.frameDurationsMs!.entries()) { end += duration; if (elapsed < end) return index; }
  return info.frameCount - 1;
}
