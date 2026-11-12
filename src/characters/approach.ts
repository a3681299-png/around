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
  | 'standUp'
  | 'dive'
  | 'lie'
  | 'rise'
  | 'toPerch'
  | 'perchUp'
  | 'perch'
  | 'perchDown'
  | 'tumble'
  | 'dazed';
export type Mood = 'calm' | 'interest';

/** A seat to rest on: where the hips go (the room's marker), the way it faces, and the floor
 * point in front of it where the feet stand before sitting down. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  heading: number;
  stand: readonly [number, number];
  /**
   * A bed: instead of sitting, the body dives on from the stand point and lies face down, its
   * chest here (on the surface) and its head the way `heading` points (docs/living-life.md).
   */
  lie?: { x: number; y: number; z: number; heading: number };
  /**
   * No seat at all but a place to stand (before the screen at a live): the body goes to `stand`,
   * turns to face `heading` and stays on its feet.
   */
  standing?: boolean;
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
  /** Braking at the end of a dart: the place it will stop on and the way it will face there. */
  stopAt: readonly [number, number] | undefined;
  stopHeading: number;
  /** A dive onto a bed: where it took off from and the way it faced then. */
  diveFrom: readonly [number, number];
  diveHeading: number;
  /** A perch (the top of a desktop window): where it sits, kept while it comes down; the floor it
   * comes down to; tumbles answered so far. */
  perchAt: Vec3 | undefined;
  landAt: readonly [number, number];
  tumbled: number;
}

/** Somewhere up off the floor to sit on, which may move (docs/living-mind.md): where the hips
 * go, in the room's metres, and the way the body faces there. */
export interface Perch {
  at: Vec3;
  heading: number;
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
  /** With nothing to notice, it walks under this, hops up and sits; taken away, it hops down. */
  perch?: Perch;
  /** A count that goes up each time it is thrown off its perch: it tumbles to the floor. */
  tumble?: number;
}

export const RECOVER_S = 0.6;
export const SIT_DOWN_S = 1.3;
export const STAND_UP_S = 1.05;
/**
 * A cheer, in seconds from its start: a gasp (it takes the good news in, still), a gathering (it
 * sinks, arms drawn down and back), a big jump (arms flung up, back arched, heels up), the
 * landing, a twirl in the air, and the afterglow in which it comes back to standing.
 */
export const CHEER = { gasp: 0.2, gather: 0.5, jump: 1.08, land: 1.28, twirl: 1.76, end: 2.45 } as const;
export const CHEER_S = CHEER.end;
/**
 * A dive onto a bed, in seconds from its start: it sinks for the spring, launches, turns flat in
 * the air and lands on its front (the bed throws it back up a little, the page's soft surface),
 * then settles. A cartoon dive: committed, arms out ahead.
 */
export const DIVE = { launch: 0.3, land: 0.78, end: 1.35 } as const;
const DIVE_HOP_M = 0.32;
/** Getting up from lying: rolling back onto the front, pushing up, swinging the legs down off
 * the bed, standing beside it. */
export const RISE_S = 1.6;
/** Lying, seconds in: the roll from the front onto the back (after a moment of swinging feet). */
export const LIE_ROLL = [1.9, 2.6] as const;
/** Onto a perch: a quarter of a second gathering, then the hop. Down again; thrown off (a
 * spinning fall); and the moment sitting dazed where it landed. Seconds. */
export const PERCH_UP = { gather: 0.25, end: 0.8 } as const;
export const PERCH_DOWN_S = 0.6;
export const TUMBLE_S = 0.85;
export const DAZED_S = 1.5;
/** The target moved this far from the plan: plan again. */
const REPLAN_M = 0.08;
const FACE_RAD = 0.06;
/**
 * Further round than this the body turns about in one move before it goes: an eager one hops
 * round, a calm one steps round (one foot out to where it will stand, then the other).
 */
const PIVOT_RAD = 1.75;

/** How each mood plays the same approach. Seconds, metres, and shares of the body's own speeds. */
export const ACTING = {
  calm: {
    notice: 0.85,
    windup: 0.2,
    crouch: 0.35,
    pivot: 0.66,
    pivotHop: 0,
    settle: 0.25,
    reach: 0.8,
    hold: 1.1,
    retract: 0.7,
  },
  interest: {
    notice: 0.5,
    windup: 0.24,
    crouch: 1,
    pivot: 0.36,
    pivotHop: 0.09,
    settle: 0.3,
    reach: 0.46,
    hold: 1.0,
    retract: 0.42,
  },
} as const;

/**
 * An eager way to a place: not the straight line but a shallow curve that swings out to the side
 * the body already faces, so it leaves in the way it is turned and comes round onto the thing.
 * Only over open floor (each leg of it a clear straight walk), only when there is room to curve,
 * and never when the place is straight ahead: otherwise the plain way.
 */
export function arcPath(
  layout: RoomLayout,
  from: readonly [number, number],
  to: readonly [number, number],
  heading: number,
  plain: Path,
): Path {
  const dx = to[0] - from[0],
    dz = to[1] - from[1],
    far = Math.hypot(dx, dz);
  if (plain.length !== 1 || far < 0.9) return plain;
  const off = wrapAngle(Math.atan2(dx, dz) - heading);
  if (Math.abs(off) < 0.45) return plain;
  // The side the body faces: the curve begins by going its way, not by turning against it.
  const side = off > 0 ? -1 : 1;
  const bulge = Math.min(0.32, far * 0.17) * side;
  // ((dz, -dx) / far is the left of the way; `side` picks left or right of it.)
  const via: [number, number] = [from[0] + dx * 0.5 + (dz / far) * bulge, from[1] + dz * 0.5 - (dx / far) * bulge];
  if (!walkable(layout, via[0], via[1])) return plain;
  if (floorPath(layout, from, via).length !== 1 || floorPath(layout, via, to).length !== 1) return plain;
  return [via, [to[0], to[1]]];
}

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
  stopAt: undefined,
  stopHeading: 0,
  diveFrom: [x, z],
  diveHeading: heading,
  perchAt: undefined,
  landAt: [x, z],
  tumbled: 0,
});

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Another seat than the one sat on (the page sends the body elsewhere). */
const moved = (wanted: Seat, current: Seat | undefined) =>
  !current ||
  Math.hypot(wanted.x - current.x, wanted.z - current.z) > 0.05 ||
  Boolean(wanted.lie) !== Boolean(current.lie);

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
    // (A braking belongs to the walk it ends and the settling after it, nothing else.)
    s = { ...s, phase, since: s.t, beat: 0, stopAt: phase === 'settle' ? s.stopAt : undefined, ...extra };
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
    begin('cheer', {
      cheered: input.cheer ?? 0,
      pivotFrom: s.mover.heading,
      // The hand, if it was out, comes back as the cheer begins.
      reachFrom: approachIntent(s, target).reachWeight,
      ...(target ? { done: target } : {}),
    });
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
        if (input.perch && s.mover.speed === 0) {
          // Under the perch (the nearest floor to it), then up.
          const here = nearestFloor(input.layout, s.mover.x, s.mover.z);
          const under = nearestFloor(input.layout, input.perch.at[0], input.perch.at[2]);
          const near = Math.hypot(under[0] - here[0], under[1] - here[1]) < 0.05;
          const path = near ? [] : floorPath(input.layout, here, under);
          if (near || path.length) begin('toPerch', { path, mood: 'interest', last: input.perch.at });
        } else if (input.seat?.standing && s.mover.speed === 0) {
          // A place to stand: there and facing the right way, it stays; else it goes, or turns.
          const { stand, heading } = input.seat;
          const there = Math.hypot(stand[0] - s.mover.x, stand[1] - s.mover.z) < 0.12;
          const path = there ? [] : floorPath(input.layout, nearestFloor(input.layout, s.mover.x, s.mover.z), stand);
          if (path.length || (there && Math.abs(wrapAngle(heading - s.mover.heading)) > FACE_RAD))
            begin('toSeat', { path, seat: input.seat, mood: 'calm' });
        } else if (input.seat && s.mover.speed === 0) {
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
      const plain = place ? floorPath(input.layout, here, place) : [];
      const path = place && s.mood === 'interest' ? arcPath(input.layout, here, place, s.mover.heading, plain) : plain;
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
      // Behind it: the body turns about in one move (a hop when eager, a step round when calm).
      if (Math.abs(off) > PIVOT_RAD) begin('pivot', { pivotFrom: s.mover.heading, pivotTo: s.mover.heading + off });
      else begin('walk');
      break;
    }
    case 'pivot': {
      const p = Math.min(1, elapsed / acting.pivot);
      // Most of the turn in the middle of the move (for a hop: while the feet are off the floor).
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
      // A dart ends in a hard stop: from the moment the stopping distance is all that is left,
      // the body is braking onto the place it will stand (the rig plants its feet there).
      const end = s.path[s.path.length - 1];
      if (end && s.path.length === 1 && s.mood === 'interest') {
        const left = Math.hypot(end[0] - s.mover.x, end[1] - s.mover.z);
        const stopping = (s.mover.speed * s.mover.speed) / (2 * limits.decel);
        if (s.mover.speed > limits.maxSpeed * 0.6 && left <= stopping + 0.04)
          s = { ...s, stopAt: [end[0], end[1]], stopHeading: Math.atan2(end[0] - s.mover.x, end[1] - s.mover.z) };
      }
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
    case 'cheer': {
      // The twirl: once round in the air, back to the way it faced.
      const q = Math.min(1, Math.max(0, (elapsed - CHEER.land) / (CHEER.twirl - CHEER.land)));
      const heading = s.pivotFrom + Math.PI * 2 * (q * q * (3 - 2 * q));
      s = { ...s, mover: { ...s.mover, heading, turn: dt > 0 ? wrapAngle(heading - s.mover.heading) / dt : 0 } };
      if (elapsed >= CHEER_S) begin('idle', { mover: { ...s.mover, heading: s.pivotFrom, turn: 0 } });
      break;
    }
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
      if (seat.standing) {
        // A place to stand: face the way asked (the page may turn it about while it stands), and
        // that is all.
        const heading = input.seat.heading;
        s = { ...s, mover: { ...turnToward(s.mover, heading, dt, limits.turnRate), speed: 0 } };
        if (Math.abs(wrapAngle(heading - s.mover.heading)) < FACE_RAD)
          begin('idle', { seat: undefined, mover: { ...s.mover, turn: 0 } });
        break;
      }
      if (seat.lie) {
        // Beside a bed: face where it will land, then dive.
        const face = Math.atan2(seat.lie.x - s.mover.x, seat.lie.z - s.mover.z);
        s = { ...s, mover: { ...turnToward(s.mover, face, dt, limits.turnRate), speed: 0 } };
        if (Math.abs(wrapAngle(face - s.mover.heading)) < FACE_RAD)
          begin('dive', {
            mover: { ...s.mover, turn: 0 },
            diveFrom: [s.mover.x, s.mover.z],
            diveHeading: s.mover.heading,
          });
        break;
      }
      // In front of the seat: turn the back to it (the way the seat faces), then sit.
      s = { ...s, mover: { ...turnToward(s.mover, seat.heading, dt, limits.turnRate), speed: 0 } };
      if (Math.abs(wrapAngle(seat.heading - s.mover.heading)) < FACE_RAD)
        begin('sitDown', { mover: { ...s.mover, turn: 0 } });
      break;
    }
    case 'dive': {
      const lie = s.seat?.lie;
      if (!lie) {
        begin('idle', { seat: undefined });
        break;
      }
      // Through the air from the take-off to the bed, turning to lie the bed's way.
      const k = ease(clamp01((elapsed - DIVE.launch) / (DIVE.land - DIVE.launch)));
      const heading = s.diveHeading + wrapAngle(lie.heading - s.diveHeading) * k;
      s = {
        ...s,
        mover: {
          x: s.diveFrom[0] + (lie.x - s.diveFrom[0]) * k,
          z: s.diveFrom[1] + (lie.z - s.diveFrom[1]) * k,
          heading,
          speed: 0,
          turn: dt > 0 ? wrapAngle(heading - s.mover.heading) / dt : 0,
        },
      };
      if (elapsed >= DIVE.end) begin('lie', { mover: { ...s.mover, turn: 0 } });
      break;
    }
    case 'lie':
      if (fresh || !input.seat || moved(input.seat, s.seat))
        begin('rise', { diveFrom: [s.mover.x, s.mover.z], diveHeading: s.mover.heading });
      break;
    case 'rise': {
      const seat = s.seat;
      if (!seat) {
        begin('idle');
        break;
      }
      // Push up, swing round and down off the bed's edge, stand beside it facing the room.
      const k = ease(clamp01((elapsed - RISE_S * 0.2) / (RISE_S * 0.65)));
      const heading = s.diveHeading + wrapAngle(seat.heading - s.diveHeading) * k;
      s = {
        ...s,
        mover: {
          x: s.diveFrom[0] + (seat.stand[0] - s.diveFrom[0]) * k,
          z: s.diveFrom[1] + (seat.stand[1] - s.diveFrom[1]) * k,
          heading,
          speed: 0,
          turn: dt > 0 ? wrapAngle(heading - s.mover.heading) / dt : 0,
        },
      };
      if (elapsed >= RISE_S)
        begin('idle', {
          seat: undefined,
          mover: { x: seat.stand[0], z: seat.stand[1], heading: seat.heading, speed: 0, turn: 0 },
        });
      break;
    }
    case 'sitDown':
      if (elapsed >= SIT_DOWN_S) begin('sit');
      break;
    case 'sit':
      // Up when something appears, the seat is taken away, or another place is wanted.
      if (fresh || !input.seat || moved(input.seat, s.seat)) begin('standUp');
      break;
    case 'standUp':
      if (elapsed >= STAND_UP_S) begin('idle', { seat: undefined });
      break;
    case 'toPerch': {
      const perch = input.perch;
      if (fresh || !perch) {
        rest();
        if (s.mover.speed === 0) begin('idle');
        break;
      }
      s = { ...s, last: perch.at };
      if (s.path.length) {
        const moved = stepMover(s.mover, s.path, dt, limits);
        s = { ...s, mover: moved.mover, path: moved.path };
        break;
      }
      // Under it: turn the way it will sit, then up.
      s = { ...s, mover: { ...turnToward(s.mover, perch.heading, dt, limits.turnRate), speed: 0 } };
      if (Math.abs(wrapAngle(perch.heading - s.mover.heading)) < FACE_RAD)
        begin('perchUp', { mover: { ...s.mover, turn: 0 }, diveFrom: [s.mover.x, s.mover.z], perchAt: perch.at });
      break;
    }
    case 'perchUp': {
      // (A perch that moves while it is in the air is landed on where it now is.)
      const at = input.perch?.at ?? s.perchAt;
      if (!at) {
        begin('idle');
        break;
      }
      const k = ease(clamp01((elapsed - PERCH_UP.gather) / (PERCH_UP.end - PERCH_UP.gather)));
      s = {
        ...s,
        perchAt: at,
        mover: {
          ...s.mover,
          x: s.diveFrom[0] + (at[0] - s.diveFrom[0]) * k,
          z: s.diveFrom[1] + (at[2] - s.diveFrom[1]) * k,
          speed: 0,
          turn: 0,
        },
      };
      if (elapsed >= PERCH_UP.end) begin('perch');
      break;
    }
    case 'perch': {
      const perch = input.perch;
      const off = (input.tumble ?? 0) > s.tumbled;
      if (perch && !off) {
        // It rides: wherever the perch goes, it goes.
        s = {
          ...s,
          perchAt: perch.at,
          mover: { x: perch.at[0], z: perch.at[2], heading: perch.heading, speed: 0, turn: 0 },
        };
        break;
      }
      const landAt = nearestFloor(input.layout, s.mover.x, s.mover.z);
      begin(off ? 'tumble' : 'perchDown', {
        tumbled: input.tumble ?? s.tumbled,
        diveFrom: [s.mover.x, s.mover.z],
        diveHeading: s.mover.heading,
        landAt,
      });
      break;
    }
    case 'perchDown':
    case 'tumble': {
      const length = s.phase === 'tumble' ? TUMBLE_S : PERCH_DOWN_S;
      const k = clamp01(elapsed / length);
      // Thrown off, it spins twice on the way down.
      const heading = s.diveHeading + (s.phase === 'tumble' ? Math.PI * 4 * ease(k) : 0);
      s = {
        ...s,
        mover: {
          x: s.diveFrom[0] + (s.landAt[0] - s.diveFrom[0]) * ease(k),
          z: s.diveFrom[1] + (s.landAt[1] - s.diveFrom[1]) * ease(k),
          heading,
          speed: 0,
          turn: dt > 0 ? wrapAngle(heading - s.mover.heading) / dt : 0,
        },
      };
      if (elapsed >= length)
        begin(s.phase === 'tumble' ? 'dazed' : 'idle', {
          perchAt: s.phase === 'tumble' ? s.perchAt : undefined,
          mover: { x: s.landAt[0], z: s.landAt[1], heading: s.diveHeading, speed: 0, turn: 0 },
        });
      break;
    }
    case 'dazed':
      if (elapsed >= DAZED_S) begin('idle', { perchAt: undefined });
      break;
  }
  return s;
}

/**
 * A hand sent somewhere to hold or handle a thing (the phone and its earphones, docs/living-life.md):
 * the point the middle of the palm goes to, how much (0 the motion's own hand), which way the palm
 * and the fingers point there, and how closed the fingers are.
 */
export interface HandGoal {
  at: Vec3;
  weight: number;
  palm: Vec3;
  fingers: Vec3;
  grip: number;
}

/** What the rig is asked to do this frame. Weights are 0–1 unless said otherwise. */
export interface BodyIntent {
  /** Hands holding things (set by the page's phone routine, not by the approach). */
  hold?: { left?: HandGoal; right?: HandGoal };
  /** The right thumb on a screen (a tap: 0 → 1 → 0). */
  thumb?: number;
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
  pose: 'stand' | 'sitDown' | 'sit' | 'standUp' | 'dive' | 'lie' | 'rise';
  poseTime: number;
  seated: number;
  seat?: Vec3;
  /** Lying (0 upright, 1 flat on the front, head the way `heading` points), where the chest
   * rests (the bed's surface), the legs' idle swing (0–1) and a landing's moment (1 as the
   * body hits the bed, gone within a fifth of a second). */
  lie: number;
  /** Lying: 0 on its front, 1 rolled over onto its back. */
  roll: number;
  lieAt?: Vec3;
  kickLegs: number;
  landed: number;
  /** Seated up on a perch: how much the lower legs swing (0–1). */
  dangle: number;
  /** How it feels, shown in the face, the ears and tail and the carriage of the body (0–1 each;
   * set by the page's director, not by the approach), and whether it is asleep. */
  feel?: { sleepy: number; grumpy: number; confused: number; surprised: number };
  sleep?: number;
  /** How far the body is sunk before a go (0–1): the wind-up. */
  crouch: number;
  /** Off the floor: how far through the hop (0–1), and how high it goes (metres). */
  hop?: number;
  hopHeight: number;
  /** A start of attention (1 the moment a thing is noticed, gone within the notice): the ears. */
  alert: number;
  /** Gladness (0–1): the face and the tail. */
  joy: number;
  /** Both arms: −1 drawn down and back (gathering), +1 flung up and out. 0 leaves them be. */
  arms: number;
  /** The trunk: −1 curled forward, +1 arched back. */
  arch: number;
  /** In the air: 0 the legs tuck under, 1 the heels kick up behind. */
  kick: number;
  /** The moment of a touch (1 as the hand lands, gone in a moment): a small start through the body. */
  tap: number;
  /** How much the look goes to whoever is watching instead of the thing (0–1). */
  toViewer: number;
  /** A calm turn about: how far the body has still to turn (radians). The feet step straight to
   * where they will stand at the end, instead of shuffling after the body. */
  turnAhead: number;
  /** Braking to a stop here (x, z), to face this way: the feet are to be planted for it. */
  stopAt?: readonly [number, number];
  stopHeading: number;
  /**
   * Music it moves to (set by the page at a live, not by the approach): how much of the dance is
   * in the body (0–1), how much it moves to the beat at all (0–1), the beat clock (whole numbers
   * fall on the beats) and the tempo.
   */
  music?: { dance: number; groove: number; beat: number; bpm: number };
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
    arms = 0,
    arch = 0,
    kick = 0,
    tap = 0,
    toViewer = 0,
    turnAhead = 0,
    hop: number | undefined,
    hopHeight = 0,
    lie = 0,
    roll = 0,
    kickLegs = 0,
    landed = 0,
    perched = 0,
    dangle = 0;
  /** 0 → 1 over [from, to], eased. */
  const over = (from: number, to: number) => ease(clamp01((elapsed - from) / (to - from)));
  switch (s.phase) {
    case 'idle':
    case 'toSeat':
    case 'sitDown':
    case 'sit':
    case 'standUp':
      break;
    case 'toPerch':
      lookWeight = 1;
      break;
    case 'perchUp': {
      // Gathers, springs up (arms thrown up), and is seated as it lands on the edge.
      const g = PERCH_UP.gather;
      crouch = 1.1 * over(0, g - 0.04) * (1 - over(g - 0.04, g + 0.05));
      arms = 0.7 * over(g - 0.02, g + 0.12) * (1 - over(PERCH_UP.end - 0.2, PERCH_UP.end));
      if (elapsed >= g) {
        hop = clamp01((elapsed - g) / (PERCH_UP.end - g));
        hopHeight = 0.22;
      }
      perched = over(g, PERCH_UP.end);
      joy = over(g, PERCH_UP.end);
      break;
    }
    case 'perch':
      perched = 1;
      // Settled, the legs swing.
      dangle = over(0.3, 1.2);
      break;
    case 'perchDown':
      perched = 1 - over(0, PERCH_DOWN_S * 0.8);
      hop = clamp01(elapsed / PERCH_DOWN_S);
      hopHeight = 0.1;
      break;
    case 'tumble':
      // Flung off: arms and legs out, spinning (the mover turns it), down onto the floor.
      perched = 1 - over(0, TUMBLE_S * 0.45);
      hop = clamp01(elapsed / TUMBLE_S);
      hopHeight = 0.18;
      arms = 0.9;
      kick = 1;
      alert = 1;
      break;
    case 'dazed':
      // Where it landed: sunk down, the head going round.
      crouch = 0.9 * (1 - over(DAZED_S * 0.5, DAZED_S));
      break;
    case 'dive': {
      // Sink for the spring, arms back; launch with the arms flung ahead; flat before the bed.
      const d = DIVE;
      crouch = 1.1 * over(0, d.launch - 0.04) * (1 - over(d.launch - 0.04, d.launch + 0.04));
      arms =
        -0.8 * over(0.02, d.launch - 0.05) * (1 - over(d.launch - 0.06, d.launch)) +
        over(d.launch - 0.04, d.launch + 0.1);
      if (elapsed >= d.launch && elapsed < d.land) {
        hop = (elapsed - d.launch) / (d.land - d.launch);
        hopHeight = DIVE_HOP_M;
      }
      lie = ease(clamp01(((elapsed - d.launch) / (d.land - d.launch)) * 1.15));
      landed = elapsed >= d.land ? 1 - clamp01((elapsed - d.land) / 0.2) : 0;
      joy = over(d.launch, d.land) * (1 - over(d.land + 0.2, d.end + 0.6));
      break;
    }
    case 'lie':
      lie = 1;
      // Landed on its front, the feet swing up behind; then it rolls over onto its back to
      // settle in (the phone is held up over the face there), one leg crossed over the other.
      kickLegs = over(0.6, 1.2);
      roll = over(LIE_ROLL[0], LIE_ROLL[1]);
      break;
    case 'rise':
      // Back onto its front first, then up and off the bed.
      roll = 1 - over(0, RISE_S * 0.3);
      lie = 1 - over(RISE_S * 0.25, RISE_S * 0.8);
      kickLegs = 1 - over(0, 0.3);
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
      if (acting.pivotHop > 0) {
        hop = clamp01(elapsed / acting.pivot);
        hopHeight = acting.pivotHop;
      } else turnAhead = wrapAngle(s.pivotTo - s.mover.heading);
      break;
    case 'walk':
    case 'settle':
      lookWeight = 1;
      break;
    case 'reach':
      lookWeight = 1;
      reachWeight = reachCurve(elapsed / s.beat, eager);
      break;
    case 'hold': {
      // Not a held pose: the hand lands (a start), rests, lifts a little and pats once more, and
      // meanwhile the look goes to whoever is watching ("see?") and back to the thing.
      const p = clamp01(elapsed / Math.max(0.2, s.beat));
      lookWeight = 1;
      reachWeight = 1 - 0.24 * Math.sin(Math.PI * clamp01((p - 0.34) / 0.3)) ** 2;
      tap = Math.max(1 - clamp01(elapsed / 0.16), p > 0.62 ? 1 - clamp01((p - 0.62) / 0.14) : 0);
      toViewer = ease(clamp01((p - 0.5) / 0.14)) * (1 - ease(clamp01((p - 0.86) / 0.14)));
      break;
    }
    case 'retract':
      lookWeight = 1;
      reachWeight = s.reachFrom * (1 - ease(clamp01(elapsed / acting.retract)));
      break;
    case 'recover':
      lookWeight = 1 - ease(clamp01(elapsed / RECOVER_S));
      break;
    case 'cheer': {
      const c = CHEER;
      lookWeight = 1;
      // To whoever is watching, from the gasp on (the gladness is shared), until it settles.
      toViewer = over(0, 0.12) * (1 - over(c.twirl + 0.25, c.end));
      // The hand that was on the thing comes away during the gasp.
      reachWeight = s.reachFrom * (1 - over(0, c.gasp + 0.1));
      // The gasp: a start, held still, leaning back a little.
      alert = 1 - over(c.gasp, c.gasp + 0.15);
      joy = over(c.gasp * 0.6, c.gather) * (1 - over(c.twirl + 0.3, c.end));
      // Gathering: down, curled, arms drawn back. Then the release.
      // (The release takes a tenth of a second: quick, but a slow display still sees it happen.)
      crouch = 1.35 * over(c.gasp, c.gather - 0.05) * (1 - over(c.gather - 0.04, c.gather + 0.06));
      arch =
        0.35 * over(0, c.gasp) * (1 - over(c.gasp, c.gasp + 0.12)) -
        0.9 * over(c.gasp, c.gather - 0.05) * (1 - over(c.gather - 0.03, c.gather + 0.07)) +
        1 * over(c.gather, c.gather + 0.16) * (1 - over(c.jump - 0.22, c.jump + 0.02));
      arms =
        -1 * over(c.gasp + 0.03, c.gather - 0.06) * (1 - over(c.gather - 0.05, c.gather + 0.08)) +
        // Up within a sixth of a second (fast, but an arm's swing, not a cut), held through the
        // top, down through the landing and a little past (they swing on), half out again for
        // the twirl.
        1 * over(c.gather - 0.01, c.gather + 0.16) * (1 - over(c.jump - 0.1, c.land)) -
        0.25 * over(c.jump + 0.04, c.land) * (1 - over(c.land, c.land + 0.14)) +
        0.55 * over(c.land + 0.02, c.land + 0.16) * (1 - over(c.twirl - 0.08, c.twirl + 0.22));
      if (elapsed >= c.gather && elapsed < c.jump) {
        hop = (elapsed - c.gather) / (c.jump - c.gather);
        hopHeight = 0.3;
        kick = Math.sin(Math.PI * hop);
      } else if (elapsed >= c.land && elapsed < c.twirl) {
        hop = (elapsed - c.land) / (c.twirl - c.land);
        hopHeight = 0.14;
      }
      // A second, smaller sinking before the twirl (on top of the landing's own).
      crouch += 0.7 * over(c.jump + 0.04, c.land - 0.03) * (1 - over(c.land - 0.02, c.land + 0.04));
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
    pose:
      s.phase === 'sitDown' ||
      s.phase === 'sit' ||
      s.phase === 'standUp' ||
      s.phase === 'dive' ||
      s.phase === 'lie' ||
      s.phase === 'rise'
        ? s.phase
        : perched > 0.3
          ? 'sit'
          : 'stand',
    poseTime: elapsed,
    seated:
      s.phase === 'sit'
        ? 1
        : s.phase === 'sitDown'
          ? ease(clamp01(elapsed / SIT_DOWN_S))
          : s.phase === 'standUp'
            ? 1 - ease(clamp01(elapsed / STAND_UP_S))
            : perched,
    ...(perched > 0 && s.perchAt
      ? { seat: s.perchAt }
      : s.seat && !s.seat.lie
        ? { seat: [s.seat.x, s.seat.y, s.seat.z] as Vec3 }
        : {}),
    dangle,
    lie,
    roll,
    ...(s.seat?.lie && (s.phase === 'dive' || s.phase === 'lie' || s.phase === 'rise')
      ? { lieAt: [s.seat.lie.x, s.seat.lie.y, s.seat.lie.z] as Vec3 }
      : {}),
    kickLegs,
    landed,
    crouch,
    ...(hop !== undefined ? { hop } : {}),
    hopHeight,
    alert,
    joy,
    arms,
    arch,
    kick,
    tap,
    toViewer,
    turnAhead,
    ...((s.phase === 'walk' || s.phase === 'settle') && s.stopAt ? { stopAt: s.stopAt } : {}),
    stopHeading: s.stopHeading,
  };
}
