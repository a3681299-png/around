import type { CircleMask } from '../../effects/types';
import type { Point } from '../../world/geometry';

export function maskGradient(mask: CircleMask, center: Point, gate: number): string {
  const intensity = Math.max(0, Math.min(1, mask.intensity * gate));
  const inner = Math.max(0, mask.radiusPx - mask.featherPx);
  return `radial-gradient(circle at ${center.x}px ${center.y}px, rgba(0, 0, 0, ${intensity}) ${inner}px, transparent ${mask.radiusPx}px)`;
}
