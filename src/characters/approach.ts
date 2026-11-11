/**
 * What the character decides to do about a thing that appears in its room (a UI panel, a mark):
 * notice it, turn, walk up to where a hand can reach it, face it, touch it, and go back to
 * standing. Pure and deterministic. It only decides (where to stand, where to look, when to
 * reach); how the body does it (steps, blends, IK) is the rig's (src/renderers/three/living-body.ts).
 *
 * The target is a point in the room's metres and may move or vanish at any time: the plan follows
 * it, so nothing here is a fixed animation.
 */
import { floorPath, nearestFloor, walkable, type RoomLayout } from '../world/room-life';
import { DEFAULT_LIMITS, stepMover, turnToward, wrapAngle, type MoveLimits, type Mover, type Path } from './locomotion';
import type { Vec3 } from './two-bone-ik';

export type ApproachPhase = 'idle' | 'notice' | 'walk' | 'settle' | 'reach' | 'hold' | 'retract' | 'recover';

/** The body's own measures the plan needs (the rig measures them from the model). */
export interface BodyReach {
  /** Shoulder to wrist plus the hand, metres. */
  arm: number;
  shoulderHeight: number;
  /** Half the distance between the shoulders. */
  shoulderHalf: number;
}

export interface ApproachState {
  t: number;
  phase: ApproachPhase;
  since: number;
  mover: Mover;
  path: Path;
  /** The target the current plan was made for (replanned when the live one moves away from it). */
  planned: Vec3 | undefined;
  /** The target already touched: it is not touched again until it moves or reappears. */
  done: Vec3 | undefined;
  hand: 'left' | 'right';
  /** The last target seen, kept while the hand comes back from a target that vanished. */
  last: Vec3 | undefined;
}

export interface ApproachInput {
  dt: number;
  layout: RoomLayout;
  target?: Vec3;
  body: BodyReach;
  limits?: MoveLimits;
}

export const NOTICE_S = 0.75;
export const REACH_S = 0.8;
export const HOLD_S = 0.9;
export const RETRACT_S = 0.7;
export const RECOVER_S = 0.6;
/** The target moved this far from the plan: plan again. */
const REPLAN_M = 0.08;
const FACE_RAD = 0.06;

export const startApproach = (x: number, z: number, heading: number): ApproachState => ({
  t: 0,
  phase: 'idle',
  since: 0,
  mover: { x, z, heading, speed: 0, turn: 0 },
  path: [],
  planned: undefined,
  done: undefined,
  hand: 'right',
  last: undefined,
});

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * How far from the target (on the floor) the body stands so the hand reaches it with the elbow
 * still a little bent: a high or low target needs a closer stand.
 */
export function standoff(target: Vec3, body: BodyReach, floorY: number): number {
  const rise = target[1] - (floorY + body.shoulderHeight);
  const flat = Math.sqrt(Math.max(0, (body.arm * 0.82) ** 2 - rise * rise));
  return Math.min(body.arm, Math.max(0.16, flat));
}

/**
 * Where to stand: on the side of the target the body is already on, else around it (the nearest
 * walkable place a hand reaches from). Undefined when no floor is near enough.
 */
export function standPlace(
  layout: RoomLayout,
  from: readonly [number, number],
  target: Vec3,
  body: BodyReach,
): [number, number] | undefined {
  const reach = standoff(target, body, layout.floorY);
  const base = Math.atan2(from[0] - target[0], from[1] - target[2]);
  for (const radius of [reach, reach * 0.8, reach * 0.6])
    for (let k = 0; k <= 9; k++)
      for (const side of k ? [1, -1] : [1]) {
        const a = base + side * k * (Math.PI / 9);
        const x = target[0] + Math.sin(a) * radius,
          z = target[2] + Math.cos(a) * radius;
        if (walkable(layout, x, z)) return [x, z];
      }
  return undefined;
}

export function stepApproach(state: ApproachState, input: ApproachInput): ApproachState {
  const dt = Math.min(0.25, Math.max(0, Number.isFinite(input.dt) ? input.dt : 0));
  const limits = input.limits ?? DEFAULT_LIMITS;
  let s: ApproachState = { ...state, t: state.t + dt };
  const { target } = input;
  if (target) s.last = target;
  const elapsed = s.t - s.since;
  const begin = (phase: ApproachPhase, extra: Partial<ApproachState> = {}) => {
    s = { ...s, phase, since: s.t, ...extra };
  };
  const fresh = target && (!s.done || distance(s.done, target) > REPLAN_M);
  // Standing or walking with nothing to walk to: come to rest where it is.
  const rest = () => {
    const moved = stepMover(s.mover, [], dt, limits);
    s = { ...s, mover: moved.mover, path: [] };
  };

  switch (s.phase) {
    case 'idle':
      rest();
      if (fresh) begin('notice');
      else if (!target && s.done) s = { ...s, done: undefined };
      break;
    case 'notice': {
      rest();
      if (!target) {
        begin('recover');
        break;
      }
      if (elapsed < NOTICE_S) break;
      const place = standPlace(input.layout, [s.mover.x, s.mover.z], target, input.body);
      const here: [number, number] = nearestFloor(input.layout, s.mover.x, s.mover.z);
      const path = place ? floorPath(input.layout, here, place) : [];
      // No way there: keep looking at it (the look follows the live target), try again later.
      if (!place || !path.length) {
        // (The clock goes back only as far as the look is already full: the head must not turn away.)
        s = { ...s, since: s.t - NOTICE_S * 0.6 };
        break;
      }
      begin('walk', { path, planned: target });
      break;
    }
    case 'walk': {
      if (!target) {
        rest();
        if (s.mover.speed === 0) begin('recover');
        break;
      }
      if (s.planned && distance(s.planned, target) > REPLAN_M) {
        // It moved: plan again from here, without stopping if the new way is ahead.
        const place = standPlace(input.layout, [s.mover.x, s.mover.z], target, input.body);
        const path = place ? floorPath(input.layout, nearestFloor(input.layout, s.mover.x, s.mover.z), place) : [];
        if (path.length) s = { ...s, path, planned: target };
        else {
          begin('notice');
          break;
        }
      }
      const moved = stepMover(s.mover, s.path, dt, limits);
      s = { ...s, mover: moved.mover, path: moved.path };
      if (moved.arrived) begin('settle');
      break;
    }
    case 'settle': {
      if (!target) {
        begin('recover');
        break;
      }
      const reach = standoff(target, input.body, input.layout.floorY);
      const flat = Math.hypot(target[0] - s.mover.x, target[2] - s.mover.z);
      if (flat > reach + REPLAN_M * 1.5 || flat < reach * 0.4) {
        // It moved out of (or into) the body while settling.
        begin('notice', { since: s.t - NOTICE_S });
        break;
      }
      const face = Math.atan2(target[0] - s.mover.x, target[2] - s.mover.z);
      s = { ...s, mover: { ...turnToward(s.mover, face, dt, limits.turnRate), speed: 0 } };
      if (Math.abs(wrapAngle(face - s.mover.heading)) < FACE_RAD && elapsed > 0.25) {
        // The hand on the target's side; straight ahead, the right one.
        const side = Math.sin(wrapAngle(face - s.mover.heading));
        begin('reach', { hand: side > 0.02 ? 'left' : 'right', mover: { ...s.mover, turn: 0 } });
      }
      break;
    }
    case 'reach':
      if (!target) begin('retract', { since: s.t - (1 - Math.min(1, elapsed / REACH_S)) * RETRACT_S });
      else if (elapsed >= REACH_S) begin('hold');
      break;
    case 'hold':
      if (!target || elapsed >= HOLD_S) begin('retract', target ? { done: target } : {});
      break;
    case 'retract':
      if (elapsed >= RETRACT_S) begin('recover');
      break;
    case 'recover':
      rest();
      if (elapsed >= RECOVER_S) begin('idle');
      break;
  }
  return s;
}

/** What the rig is asked to do this frame. Weights are 0–1, already eased. */
export interface BodyIntent {
  phase: ApproachPhase;
  x: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  /** Where the eyes, head and chest are drawn to (the room's metres), and how much. */
  look?: Vec3;
  lookWeight: number;
  /** Where the hand goes, how far along it is, and which hand. */
  reach?: Vec3;
  reachWeight: number;
  hand: 'left' | 'right';
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => v * v * (3 - 2 * v);

export function approachIntent(s: ApproachState, target: Vec3 | undefined): BodyIntent {
  const elapsed = s.t - s.since;
  const at = target ?? s.last;
  let lookWeight = 0,
    reachWeight = 0;
  switch (s.phase) {
    case 'idle':
      break;
    case 'notice':
      lookWeight = ease(clamp01(elapsed / (NOTICE_S * 0.6)));
      break;
    case 'walk':
    case 'settle':
      lookWeight = 1;
      break;
    case 'reach':
      lookWeight = 1;
      reachWeight = ease(clamp01(elapsed / REACH_S));
      break;
    case 'hold':
      lookWeight = 1;
      reachWeight = 1;
      break;
    case 'retract':
      lookWeight = 1;
      reachWeight = 1 - ease(clamp01(elapsed / RETRACT_S));
      break;
    case 'recover':
      lookWeight = 1 - ease(clamp01(elapsed / RECOVER_S));
      break;
  }
  return {
    phase: s.phase,
    x: s.mover.x,
    z: s.mover.z,
    heading: s.mover.heading,
    speed: s.mover.speed,
    turn: s.mover.turn,
    ...(at ? { look: at, reach: at } : {}),
    lookWeight: at ? lookWeight : 0,
    reachWeight: at ? reachWeight : 0,
    hand: s.hand,
  };
}
