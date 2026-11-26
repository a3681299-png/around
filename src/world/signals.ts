import { SIGNAL_REGISTRY, type NumericSource, type SignalRegistry } from '../signals/registry';
import type { WorldInput, WorldLayout } from './types';
import type { Point } from './geometry';
import type { SpatialPoint } from './points';

export interface PointerMemory {
  point: Point;
  timeMs: number;
  speed: number;
}
/** Sample-time velocity, independent of the number of intervening render frames. */
export function pointerMemory(previous: PointerMemory | undefined, input: WorldInput): PointerMemory | undefined {
  const point = input.signals.pointer;
  if (!point) return undefined;
  const timeMs = Math.min(input.timeMs, input.signals.pointerTimeMs ?? input.timeMs);
  if (previous && timeMs <= previous.timeMs) return previous;
  const dt = previous ? timeMs - previous.timeMs : 0;
  return {
    point: { ...point },
    timeMs,
    speed:
      dt > 0 ? Math.min(1e6, (Math.hypot(point.x - previous!.point.x, point.y - previous!.point.y) * 1000) / dt) : 0,
  };
}
/** Undefined signals leave the authored value intact; no stale anchor fallback. */
export function signalValue(
  rule: { source: NumericSource; target: { layerId: string } },
  input: WorldInput,
  layout?: WorldLayout,
  pointer?: PointerMemory,
  options?: { origin?: SpatialPoint; registry?: SignalRegistry },
): number | undefined {
  return (options?.registry ?? SIGNAL_REGISTRY).numericValue(rule.source, {
    signals: input.signals,
    geometry: input,
    timeMs: input.timeMs,
    events: input.events,
    layerId: rule.target.layerId,
    ...(layout ? { layout } : {}),
    ...(pointer ? { pointer } : {}),
    ...(options?.origin ? { origin: options.origin } : {}),
  });
}
