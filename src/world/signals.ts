import type { SignalRule } from '../signals/keyframes';
import type { WorldInput, WorldLayout } from './types';
import { centre, type Point } from './geometry';

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
export function signalContext(layout: WorldLayout, layerId: string) {
  const entry = [...layout.groups, ...layout.layers].find((entry) => entry.layer.id === layerId);
  return { frame: entry?.frame, target: entry?.frame ? centre(entry.layer.placement, entry.frame) : undefined };
}
/** Undefined signals leave the authored value intact; no stale anchor fallback. */
export function signalValue(
  rule: SignalRule,
  input: WorldInput,
  layout?: WorldLayout,
  pointer?: PointerMemory,
): number | undefined {
  const source = rule.source,
    p = input.signals.pointer;
  if (source.signal === 'page.scroll.progress') {
    const scroll = input.signals.scroll;
    return scroll && scroll.maxY > 0 ? Math.max(0, Math.min(1, scroll.y / scroll.maxY)) : 0;
  }
  if (!p) return undefined;
  if (source.signal === 'pointer.speed') return pointer && input.timeMs - pointer.timeMs <= 100 ? pointer.speed : 0;
  const context = layout && signalContext(layout, rule.target.layerId);
  const frame = source.space === 'viewport' ? { left: 0, top: 0, ...input.viewport } : context?.frame;
  if (!frame || frame.width <= 0 || frame.height <= 0) return undefined;
  if (source.signal === 'pointer.x') return (p.x - frame.left) / frame.width;
  if (source.signal === 'pointer.y') return (p.y - frame.top) / frame.height;
  const target =
    source.space === 'layer' ? context?.target : { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  if (!target) return undefined;
  const x = target.x - p.x,
    y = target.y - p.y;
  return source.signal === 'pointer.angle'
    ? (Math.atan2(y, x) * 180) / Math.PI
    : Math.hypot(x, y) / Math.hypot(frame.width, frame.height);
}
