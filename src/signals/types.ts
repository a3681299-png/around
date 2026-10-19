import type { Point } from '../design/geometry';

/** Values are sampled; states persist; events are occurrences, not latched booleans. */
export const SIGNAL_CATALOG = Object.freeze({
  'pointer.position': { category: 'value', valueType: 'point' },
  'page.scroll.progress': { category: 'value', valueType: 'number' },
  'video.playing': { category: 'state', valueType: 'boolean' },
  'video.play': { category: 'event' },
  'video.pause': { category: 'event' },
  'video.ended': { category: 'event' },
} as const);

export interface ScrollSignal { x: number; y: number; maxX: number; maxY: number }
export interface SignalSnapshot { pointer: Point | undefined; playing: boolean; scroll?: ScrollSignal }
export interface PlaybackSignal {
  playing: boolean;
  event?: 'video.play' | 'video.pause' | 'video.ended';
}
export interface PlaybackSource {
  connect(emit: (signal: PlaybackSignal) => void): { refresh(): void; destroy(): void };
}
