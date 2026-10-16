import { centre, type PlacementFrame, type Point } from '../design/geometry';
import type { LayerPlacement } from '../design/types';
import type { SignalSnapshot } from '../signals/types';
import type { CircleMask } from './types';

/** Inverse placement transform: never write runtime coordinates back to the draft. */
export function layerLocal(point: Point, placement: LayerPlacement, frame: PlacementFrame): Point {
  const origin = centre(placement, frame), angle = placement.rotationDeg * Math.PI / 180;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  return { x: dx * Math.cos(angle) + dy * Math.sin(angle) + placement.widthPx / 2,
    y: -dx * Math.sin(angle) + dy * Math.cos(angle) + placement.heightPx / 2 };
}

export function evaluateMask(mask: CircleMask, placement: LayerPlacement, frame: PlacementFrame, signals: SignalSnapshot) {
  const follows = mask.bindings.some((binding) => binding.target === 'mask.center');
  const gate = mask.bindings.find((binding) => binding.target === 'mask.intensity');
  return { center: follows && signals.pointer ? layerLocal(signals.pointer, placement, frame)
    : { x: mask.center.x * placement.widthPx, y: mask.center.y * placement.heightPx },
    gate: gate ? Number(signals.playing) : 1, fadeMs: gate?.transform.fadeMs ?? 0 };
}

export interface Fade { from: number; to: number; start: number; duration: number }
export function fadeValue(fade: Fade, time: number): number {
  if (!fade.duration) return fade.to;
  return fade.from + (fade.to - fade.from) * Math.max(0, Math.min(1, (time - fade.start) / fade.duration));
}
export function retargetFade(previous: Fade | undefined, target: number, time: number, duration: number): Fade {
  if (previous?.to === target && previous.duration === duration) return previous;
  return { from: previous ? fadeValue(previous, time) : target, to: target, start: time, duration };
}
export function maskGradient(mask: CircleMask, center: Point, gate: number): string {
  const intensity = Math.max(0, Math.min(1, mask.intensity * gate));
  const inner = Math.max(0, mask.radiusPx - mask.featherPx);
  return `radial-gradient(circle at ${center.x}px ${center.y}px, rgba(0, 0, 0, ${intensity}) ${inner}px, transparent ${mask.radiusPx}px)`;
}
