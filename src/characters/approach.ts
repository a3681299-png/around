/**
 * What the character decides to do about a thing that appears in its room (a UI panel, a mark):
 * notice it, turn, go up to where a hand can reach it, face it, touch it, and go back to
 * standing; and, with nothing to notice, go and sit. Pure and deterministic. It only decides
 * (where to stand, where to look, when to reach, how eager it is); how the body does it (steps,
 * blends, IK, squash, ears) is the rig's (src/renderers/three/living-body.ts).
 *
 * The same thing is not met the same way every time: the mood sets the acting. Calm walks over
 * and has a look. Interest freezes for a beat, sinks, darts off in a curve (a hop round when the
 * thing is behind), brakes hard and pokes it. Joy is the answer to a touch that was returned: a
 * couple of hops. The beats' lengths vary a little from one time to the next, by a fixed sequence
 * of numbers (the seed and a count), so a run can always be played again exactly.
 *
 * The target is a point in the room's metres and may move or vanish at any time: the plan follows
 * it, so nothing here is a fixed animation.
 */
import { draw, floorPath, nearestFloor, walkable, type RoomLayout } from '../world/room-life';
import { DEFAULT_LIMITS, stepMover, turnToward, wrapAngle, type MoveLimits, type Mover, type Path } from './locomotion';
import type { Vec3 } from './two-bone-ik';

export type ApproachPhase =
  | 'idle'
  | 'notice'
  | 'windup'
  | 'pivot'
  | 'walk'
  | 'settle'
  | 'reach'
  | 'hold'
  | 'retract'
  | 'recover'
  | 'cheer'
  | 'toSeat'
  | 'sitDown'
  | 'sit'
  | 'standUp';
export type Mood = 'calm' | 'interest';

/** A seat to rest on: where the hips go (the room's marker), the way it faces, and the floor
 * point in front of it where the feet stand before sitting down. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  heading: number;
  stand: readonly [number, number];
}

/** The body's own measures the plan needs (the rig measures them from the model). */
export interface BodyReach {
  /** Shoulder to wrist plus the hand, metres. */
  arm: number;
  shoulderHeight: number;
  /** Half the distance between the shoulders. */
  shoulderHalf: number;
  /** The speed the walk's feet keep, and the fastest the body may go (a share of its run). */
  walkSpeed?: number;
  runSpeed?: number;
}

export interface ApproachState {
  t: number;
  phase: ApproachPhase;
  since: number;
  /** How long this phase lasts (the beats that vary); 0 where the phase ends by itself. */
  beat: number;
  mover: Mover;
  path: Path;
  /** The target the current plan was made for (replanned when the live one moves away from it). */
  planned: Vec3 | undefined;
  /** The target already touched: it is not touched again until it moves or reappears. */
  done: Vec3 | undefined;
  hand: 'left' | 'right';
  /** The last target seen, kept while the hand comes back from a target that vanished. */
  last: Vec3 | undefined;
  /** The seat being walked to or sat on (kept while standing up from one that was taken away). */
  seat: Seat | undefined;
  /** The mood this approach began in (a change of mood waits for the next one). */
  mood: Mood;
  /** Numbers drawn so far (the variation's place in its sequence). */
  draws: number;
  /** A hop round: the headings it goes between. */
  pivotFrom: number;
  pivotTo: number;
  /** Cheers answered so far. */
  cheered: number;
  /** How far out the hand was when it began to come back (1 from a full touch). */
  reachFrom: number;
}

export interface ApproachInput {
  dt: number;
  layout: RoomLayout;
  target?: Vec3;
  /** With nothing to notice, the body goes and sits here; a thing appearing gets it up again. */
  seat?: Seat;
  body: BodyReach;
  mood?: Mood;
  /** A count that goes up each time the character has reason to be glad (its touch was answered). */
  cheer?: number;
  /** The variation's seed (default 1). */
  seed?: number;
  /** Overrides the mood's own pace (tests). */
  limits?: MoveLimits;
}

export const RECOVER_S = 0.6;
export const SIT_DOWN_S = 1.3;
export const STAND_UP_S = 1.05;
export const CHEER_S = 1.5;
/** The two hops of a cheer, as shares of it. */
export const CHEER_HOPS: readonly (readonly [number, number])[] = [
  [0.08, 0.4],
  [0.44, 0.76],
];
export const PIVOT_S = 0.36;
/** The target moved this far from the plan: plan again. */
const REPLAN_M = 0.08;
const FACE_RAD = 0.06;
/** Further round than this, an eager body hops round instead of stepping round. */
const PIVOT_RAD = 1.75;

/** How each mood plays the same approach. Seconds, and shares of the body's own speeds. */
export const ACTING = {
  calm: { notice: 0.85, windup: 0.2, crouch: 0.35, settle: 0.25, reach: 0.8, hold: 0.9, retract: 0.7 },
  interest: { notice: 0.5, windup: 0.24, crouch: 1, settle: 0.34, reach: 0.46, hold: 0.7, retract: 0.5 },
} as const;

export function moodLimits(mood: Mood, body: BodyReach): MoveLimits {
  const walk = body.walkSpeed ?? DEFAULT_LIMITS.maxSpeed;
  if (mood === 'calm')
    // An unhurried walk, a little under the pace the motion was made at; it turns before it goes.
    return { maxSpeed: walk * 0.85, accel: walk * 1.6, decel: walk * 2.2, turnRate: 2.1 };
  // A dart: up to speed in about a quarter of a second, a stop as sharp, off in a curve.
  const top = Math.max(walk, Math.min(body.runSpeed ?? walk, walk * 3));
  return { maxSpeed: top, accel: top * 4, decel: top * 3.4, turnRate: 6.5, turnFirst: 1.9 };
}

export const startApproach = (x: number, z: number, heading: number): ApproachState => ({
  t: 0,
  phase: 'idle',
  since: 0,
  beat: 0,
  mover: { x, z, heading, speed: 0, turn: 0 },
  path: [],
  planned: undefined,
  done: undefined,
  hand: 'right',
  last: undefined,
  seat: undefined,
  mood: 'calm',
  draws: 0,
  pivotFrom: 0,
  pivotTo: 0,
  cheered: 0,
  reachFrom: 1,
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
  let s: ApproachState = { ...state, t: state.t + dt };
  const { target } = input;
  if (target) s.last = target;
  const elapsed = s.t - s.since;
  const limits = input.limits ?? moodLimits(s.mood, input.body);
  const acting = ACTING[s.mood];
  // A beat's length: its mood's, a fifth shorter to a quarter longer, by the next fixed number.
  const vary = (seconds: number) => seconds * (0.8 + 0.45 * draw(input.seed ?? 1, s.draws++));
  const begin = (phase: ApproachPhase, extra: Partial<ApproachState> = {}) => {
    s = { ...s, phase, since: s.t, beat: 0, ...extra };
  };
  const fresh = target && (!s.done || distance(s.done, target) > REPLAN_M);
  // Standing or walking with nothing to walk to: come to rest where it is.
  const rest = () => {
    const moved = stepMover(s.mover, [], dt, limits);
    s = { ...s, mover: moved.mover, path: [] };
  };
  const cheering = (input.cheer ?? 0) > s.cheered;
  // Gladness interrupts only what is safe to leave: standing, or the end of a touch.
  if (
    cheering &&
    (s.phase === 'idle' || s.phase === 'hold' || s.phase === 'retract' || s.phase === 'recover') &&
    s.mover.speed === 0
  ) {
    begin('cheer', { cheered: input.cheer ?? 0, ...(target ? { done: target } : {}) });
    return s;
  }

  switch (s.phase) {
    case 'idle':
      rest();
      if (fresh) {
        const mood = input.mood ?? 'calm';
        s = { ...s, mood };
        begin('notice', { beat: vary(ACTING[mood].notice) });
      } else {
        if (!target && s.done) s = { ...s, done: undefined };
        if (input.seat && s.mover.speed === 0) {
          const path = floorPath(input.layout, nearestFloor(input.layout, s.mover.x, s.mover.z), input.seat.stand);
          if (path.length) begin('toSeat', { path, seat: input.seat, mood: 'calm' });
        }
      }
      break;
    case 'notice': {
      rest();
      if (!target) {
        begin('recover');
        break;
      }
      if (elapsed < s.beat) break;
      const place = standPlace(input.layout, [s.mover.x, s.mover.z], target, input.body);
      const here: [number, number] = nearestFloor(input.layout, s.mover.x, s.mover.z);
      const path = place ? floorPath(input.layout, here, place) : [];
      // No way there: keep looking at it (the look follows the live target), try again later.
      // (The clock goes back only a little: the head must not turn away meanwhile.)
      if (!place || !path.length) {
        s = { ...s, since: s.t - s.beat + 0.3 };
        break;
      }
      // Already there (it appeared within reach): no run-up.
      const far = Math.hypot(place[0] - s.mover.x, place[1] - s.mover.z) > 0.05;
      begin(far ? 'windup' : 'walk', { path, planned: target, beat: far ? vary(acting.windup) : 0 });
      break;
    }
    case 'windup': {
      // Sinking before the go (the rig crouches by the intent's `crouch`).
      if (!target) {
        begin('recover');
        break;
      }
      if (elapsed < s.beat) break;
      const first = s.path[0];
      const toward = first ? Math.atan2(first[0] - s.mover.x, first[1] - s.mover.z) : s.mover.heading;
      const off = wrapAngle(toward - s.mover.heading);
      // Behind it: an eager body hops round in one go; a calm one steps round as it walks.
      if (s.mood === 'interest' && Math.abs(off) > PIVOT_RAD)
        begin('pivot', { pivotFrom: s.mover.heading, pivotTo: s.mover.heading + off });
      else begin('walk');
      break;
    }
    case 'pivot': {
      const p = Math.min(1, elapsed / PIVOT_S);
      // Most of the turn in the middle of the hop, while the feet are off the floor.
      const k = p * p * (3 - 2 * p);
      const heading = s.pivotFrom + (s.pivotTo - s.pivotFrom) * k;
      s = { ...s, mover: { ...s.mover, heading, turn: dt > 0 ? wrapAngle(heading - s.mover.heading) / dt : 0 } };
      if (p >= 1) begin('walk', { mover: { ...s.mover, turn: 0 } });
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
          begin('notice', { beat: 0.3 });
          break;
        }
      }
      const moved = stepMover(s.mover, s.path, dt, limits);
      s = { ...s, mover: moved.mover, path: moved.path };
      if (moved.arrived) begin('settle', { beat: vary(acting.settle) });
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
        begin('notice', { beat: 0 });
        break;
      }
      const face = Math.atan2(target[0] - s.mover.x, target[2] - s.mover.z);
      s = { ...s, mover: { ...turnToward(s.mover, face, dt, limits.turnRate), speed: 0 } };
      // (The beat is where the body gets its balance back after the stop.)
      if (Math.abs(wrapAngle(face - s.mover.heading)) < FACE_RAD && elapsed > s.beat) {
        // The hand on the target's side; straight ahead, the right one.
        const side = Math.sin(wrapAngle(face - s.mover.heading));
        begin('reach', {
          hand: side > 0.02 ? 'left' : 'right',
          mover: { ...s.mover, turn: 0 },
          beat: acting.reach,
        });
      }
      break;
    }
    case 'reach':
      // Gone mid-reach: the hand comes back from wherever on its way it is (never a jump).
      if (!target) begin('retract', { reachFrom: reachCurve(elapsed / s.beat, s.mood === 'interest') });
      else if (elapsed >= s.beat) begin('hold', { beat: vary(acting.hold) });
      break;
    case 'hold':
      if (!target || elapsed >= s.beat) begin('retract', { reachFrom: 1, ...(target ? { done: target } : {}) });
      break;
    case 'retract':
      if (elapsed >= acting.retract) begin('recover');
      break;
    case 'recover':
      rest();
      if (elapsed >= RECOVER_S) begin('idle');
      break;
    case 'cheer':
      if (elapsed >= CHEER_S) begin('idle');
      break;
    case 'toSeat': {
      const seat = s.seat;
      if (fresh || !input.seat || !seat) {
        // Something to see, or the seat is gone: stop walking there.
        rest();
        if (s.mover.speed === 0) begin('idle', { seat: undefined });
        break;
      }
      if (s.path.length) {
        const moved = stepMover(s.mover, s.path, dt, limits);
        s = { ...s, mover: moved.mover, path: moved.path };
        break;
      }
      // In front of the seat: turn the back to it (the way the seat faces), then sit.
      s = { ...s, mover: { ...turnToward(s.mover, seat.heading, dt, limits.turnRate), speed: 0 } };
      if (Math.abs(wrapAngle(seat.heading - s.mover.heading)) < FACE_RAD)
        begin('sitDown', { mover: { ...s.mover, turn: 0 } });
      break;
    }
    case 'sitDown':
      if (elapsed >= SIT_DOWN_S) begin('sit');
      break;
    case 'sit':
      if (fresh || !input.seat) begin('standUp');
      break;
    case 'standUp':
      if (elapsed >= STAND_UP_S) begin('idle', { seat: undefined });
      break;
  }
  return s;
}

/** What the rig is asked to do this frame. Weights are 0–1 unless said otherwise. */
export interface BodyIntent {
  phase: ApproachPhase;
  mood: Mood;
  x: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  /** Where the eyes, head and chest are drawn to (the room's metres), and how much. */
  look?: Vec3;
  lookWeight: number;
  /** Where the hand goes and which hand. The weight dips below 0 first (the hand draws back
   * before it goes) and passes 1 for a moment (it presses the thing, then rests on it). */
  reach?: Vec3;
  reachWeight: number;
  hand: 'left' | 'right';
  /** Sitting: which motion, how far into it (seconds), how seated the body is (0 standing, 1 on
   * the seat) and where the hips go when seated. */
  pose: 'stand' | 'sitDown' | 'sit' | 'standUp';
  poseTime: number;
  seated: number;
  seat?: Vec3;
  /** How far the body is sunk before a go (0–1): the wind-up. */
  crouch: number;
  /** Off the floor: how far through the hop (0–1), and how high it goes (metres). */
  hop?: number;
  hopHeight: number;
  /** A start of attention (1 the moment a thing is noticed, gone within the notice): the ears. */
  alert: number;
  /** Gladness (0–1): the face, the arms, the tail. */
  joy: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => v * v * (3 - 2 * v);
/** Out fast, a little past the end, back to it (an eager move's ending). */
const overshoot = (v: number, by: number) => 1 + (by + 1) * (v - 1) ** 3 + by * (v - 1) ** 2;

/** The hand's way to the thing: back a little first, then out and a touch past, then on it. */
export function reachCurve(p: number, eager: boolean): number {
  const back = eager ? 0.2 : 0.16;
  if (p <= 0) return 0;
  if (p < back) return -(eager ? 0.14 : 0.07) * Math.sin((Math.PI * p) / back);
  return overshoot(clamp01((p - back) / (1 - back)), eager ? 1.7 : 1);
}

export function approachIntent(s: ApproachState, target: Vec3 | undefined): BodyIntent {
  const elapsed = s.t - s.since;
  const at = target ?? s.last;
  const acting = ACTING[s.mood];
  const eager = s.mood === 'interest';
  let lookWeight = 0,
    reachWeight = 0,
    crouch = 0,
    alert = 0,
    joy = 0,
    hop: number | undefined,
    hopHeight = 0;
  switch (s.phase) {
    case 'idle':
    case 'toSeat':
    case 'sitDown':
    case 'sit':
    case 'standUp':
      break;
    case 'notice':
      // An eager look snaps round; a calm one comes round.
      lookWeight = ease(clamp01(elapsed / (eager ? 0.16 : acting.notice * 0.6)));
      alert = 1 - clamp01(elapsed / 0.35);
      break;
    case 'windup':
      lookWeight = 1;
      crouch = acting.crouch * ease(clamp01(elapsed / Math.max(0.05, s.beat * 0.8)));
      break;
    case 'pivot':
      lookWeight = 1;
      hop = clamp01(elapsed / PIVOT_S);
      hopHeight = 0.09;
      break;
    case 'walk':
    case 'settle':
      lookWeight = 1;
      break;
    case 'reach':
      lookWeight = 1;
      reachWeight = reachCurve(elapsed / s.beat, eager);
      break;
    case 'hold':
      lookWeight = 1;
      reachWeight = 1;
      break;
    case 'retract':
      lookWeight = 1;
      reachWeight = s.reachFrom * (1 - ease(clamp01(elapsed / acting.retract)));
      break;
    case 'recover':
      lookWeight = 1 - ease(clamp01(elapsed / RECOVER_S));
      break;
    case 'cheer': {
      const p = clamp01(elapsed / CHEER_S);
      lookWeight = 1;
      joy = ease(clamp01(p / 0.1)) * (1 - ease(clamp01((p - 0.8) / 0.2)));
      for (const [from, to] of CHEER_HOPS)
        if (p >= from && p < to) {
          hop = (p - from) / (to - from);
          hopHeight = 0.17;
        }
      // Sinking before each hop.
      for (const [from] of CHEER_HOPS) if (p < from && p > from - 0.08) crouch = ease((p - (from - 0.08)) / 0.08);
      break;
    }
  }
  return {
    phase: s.phase,
    mood: s.mood,
    x: s.mover.x,
    z: s.mover.z,
    heading: s.mover.heading,
    speed: s.mover.speed,
    turn: s.mover.turn,
    ...(at ? { look: at, reach: at } : {}),
    lookWeight: at ? lookWeight : 0,
    reachWeight: at ? reachWeight : 0,
    hand: s.hand,
    pose: s.phase === 'sitDown' || s.phase === 'sit' || s.phase === 'standUp' ? s.phase : 'stand',
    poseTime: elapsed,
    seated:
      s.phase === 'sit'
        ? 1
        : s.phase === 'sitDown'
          ? ease(clamp01(elapsed / SIT_DOWN_S))
          : s.phase === 'standUp'
            ? 1 - ease(clamp01(elapsed / STAND_UP_S))
            : 0,
    ...(s.seat ? { seat: [s.seat.x, s.seat.y, s.seat.z] as Vec3 } : {}),
    crouch,
    ...(hop !== undefined ? { hop } : {}),
    hopHeight,
    alert,
    joy,
  };
}
