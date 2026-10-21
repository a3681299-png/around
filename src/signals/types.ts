import type { Point } from '../design/geometry';
import type { HostSignalValue } from './registry';
export { SIGNAL_REGISTRY } from './registry';
import { SIGNAL_REGISTRY } from './registry';

/** Values are sampled; states persist; events are occurrences, not latched booleans. */
export const SIGNAL_CATALOG = SIGNAL_REGISTRY.catalog;

export interface ScrollSignal {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}
export interface SignalSnapshot {
  pointer: Point | undefined;
  pointerTimeMs?: number;
  playing: boolean;
  scroll?: ScrollSignal;
  /** Optional future host samples. Only registered hostSample entries may cross the recording boundary. */
  samples?: Readonly<Record<string, HostSignalValue>>;
}
export interface PlaybackSignal {
  playing: boolean;
  event?: 'video.play' | 'video.pause' | 'video.ended';
}
export interface PlaybackSource {
  connect(emit: (signal: PlaybackSignal) => void): { refresh(): void; destroy(): void };
}
