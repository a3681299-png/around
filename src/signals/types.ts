import type { Point } from '../design/geometry';

/** Values are sampled; states persist; events are occurrences, not latched booleans. */
export const SIGNAL_CATALOG = Object.freeze({
  'pointer.position': { category: 'value', valueType: 'point' },
  'video.playing': { category: 'state', valueType: 'boolean' },
  'video.play': { category: 'event' },
  'video.pause': { category: 'event' },
  'video.ended': { category: 'event' },
} as const);

export interface SignalSnapshot { pointer: Point | undefined; playing: boolean }
export interface PlaybackSignal {
  playing: boolean;
  event?: 'video.play' | 'video.pause' | 'video.ended';
}
export interface PlaybackSource {
  connect(emit: (signal: PlaybackSignal) => void): { refresh(): void; destroy(): void };
}
