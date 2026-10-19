import type { FollowMotion } from '../signals/motion';
import type { Point } from './geometry';
import { rotation } from './geometry';

export interface MotionBody { signature: string; offset: Point; velocity: Point; heading: number }
export interface MotionState { bodies: Record<string, MotionBody>; pointer?: import('./signals').PointerMemory }
export const emptyMotionState = (): MotionState => ({ bodies: {} });
const approach = (from: Point, to: Point, distance: number): Point => { const x = to.x - from.x, y = to.y - from.y, length = Math.hypot(x, y), amount = length > 0 ? Math.min(1, distance / length) : 0; return { x: from.x + x * amount, y: from.y + y * amount }; };

/** Bounded substeps prevent large frame gaps from teleporting a pursuer. */
export function followMotion(config: FollowMotion, previous: MotionBody | undefined, base: Point, target: Point | undefined, deltaMs: number, reduced: boolean) {
  const signature = JSON.stringify(config);
  const body: MotionBody = previous?.signature === signature ? { ...previous, offset: { ...previous.offset }, velocity: { ...previous.velocity } } : { signature, offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, heading: 0 };
  if (!target || reduced) { body.velocity = { x: 0, y: 0 }; return { body, needsFrame: false }; }
  let position = { x: base.x + body.offset.x, y: base.y + body.offset.y };
  const start = { ...position }, distance = Math.hypot(target.x - position.x, target.y - position.y);
  if (config.mode === 'direct') position = approach(position, target, Math.max(0, distance - config.stopRadius));
  else {
    let remaining = Math.min(250, deltaMs) / 1000;
    while (remaining > 1e-9) {
      const dt = Math.min(1 / 240, remaining); remaining -= dt;
      const dx = target.x - position.x, dy = target.y - position.y, d = Math.hypot(dx, dy), gap = Math.max(0, d - config.stopRadius);
      const speed = config.mode === 'smooth' ? gap / Math.max(.001, config.lagMs / 1000) : Math.min(config.maxSpeed, Math.sqrt(2 * config.deceleration * gap), config.lagMs > 0 ? gap / (config.lagMs / 1000) : Infinity);
      const desired = { x: d > 0 ? dx / d * speed : 0, y: d > 0 ? dy / d * speed : 0 };
      body.velocity = config.mode === 'smooth' ? desired : approach(body.velocity, desired, (Math.hypot(body.velocity.x, body.velocity.y) > speed ? config.deceleration : config.acceleration) * dt);
      const movement = config.mode === 'smooth' ? gap * (1 - Math.exp(-dt / Math.max(.001, config.lagMs / 1000))) : Math.hypot(body.velocity.x, body.velocity.y) * dt;
      const v = Math.hypot(body.velocity.x, body.velocity.y), step = Math.min(gap, movement);
      if (gap < .01) { body.velocity = { x: 0, y: 0 }; break; }
      position = { x: position.x + (v > 0 ? body.velocity.x / v * step : 0), y: position.y + (v > 0 ? body.velocity.y / v * step : 0) };
    }
  }
  const dx = position.x - start.x, dy = position.y - start.y;
  if (Math.hypot(dx, dy) > .001) body.heading = rotation(Math.atan2(dy, dx) * 180 / Math.PI + config.rotationOffsetDeg);
  body.offset = { x: position.x - base.x, y: position.y - base.y };
  return { body, needsFrame: config.mode !== 'direct' && Math.hypot(target.x - position.x, target.y - position.y) - config.stopRadius > .01 };
}
