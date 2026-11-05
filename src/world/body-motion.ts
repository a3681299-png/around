import type { HumanBone } from '../characters/humanoid';
import type { Point } from './geometry';
import type { WorldEvent } from './types';
import { numeric, object } from '../models/types';

/**
 * Stage-1 computed motion of a character (docs/r3-plan.md R3-2, docs/autonomy-plan.md 3・7):
 * breathing, sway, blinking, looking around, turning, swinging the legs, hopping and shivering,
 * added on top of the held pose, and moving without walking (a hop nearby, a blink-out jump far).
 *
 * Pure: the same state and inputs give the same pose. Time, the seed and every signal come in
 * as inputs. It speaks only of the body and of signals every site has (pointer, idle time,
 * scroll, the main video's play and pause), never of a site's parts (AGENTS.md).
 */
export type BodyBoneOffsets = Partial<Record<HumanBone, readonly [number, number, number]>>;
export interface BodyPose {
  /** Additive XYZ Euler degrees per bone, in the bone's rest frame (+Y up, +Z forward). */
  bones: BodyBoneOffsets;
  /** Additive hips offset as a fraction of the body height. */
  hips: readonly [number, number, number];
  /** 0 open … 1 closed; combined with the author's blink by maximum. */
  blink: number;
  /** Whole-body turn added to the model's yaw (degrees). */
  yawDeg: number;
  /** Offset of the drawn layer while moving (CSS px), and its opacity (a blink-out jump). */
  offset: Point;
  opacity: number;
  /** Align the seat with the anchor point (a sitting pose on an edge). */
  seat: boolean;
  /** Keep the feet where the pose put them while the hips dip (two-bone IK). */
  plantFeet: boolean;
}
export const REST_POSE: BodyPose = Object.freeze({
  bones: Object.freeze({}),
  hips: Object.freeze([0, 0, 0] as const),
  blink: 0,
  yawDeg: 0,
  offset: Object.freeze({ x: 0, y: 0 }),
  opacity: 1,
  seat: false,
  plantFeet: false,
});

/** How strongly each behaviour shows, 0…1. R4's internal state will set these; 1 is stage 1. */
export interface BodyDrive {
  breathe: number;
  sway: number;
  glance: number;
  fidget: number;
  hop: number;
  shiver: number;
}
export const DEFAULT_BODY_DRIVE: BodyDrive = Object.freeze({
  breathe: 1,
  sway: 1,
  glance: 1,
  fidget: 1,
  hop: 1,
  shiver: 1,
});

export interface BodyMotionState {
  lookYaw: number;
  lookPitch: number;
  /** The last idle time seen (seconds), to notice the person coming back. */
  idleSeconds: number;
  turnStartMs: number | null;
  turnSide: number;
  attendStartMs: number | null;
  hopStartMs: number | null;
  shiverUntilMs: number;
  scrollY: number | null;
  scrollTimeMs: number | null;
  position: Point | null;
  moveStartMs: number | null;
  moveFrom: Point;
  moveKind: 'hop' | 'jump';
}
export const BODY_TIMING = Object.freeze({
  /** Idle seconds after which the character starts looking around by itself. */
  glanceAfterS: 3,
  /** Idle seconds after which the person's return makes the character turn toward them. */
  turnAfterS: 5,
  turnMs: 1800,
  attendMs: 2500,
  hopMs: 640,
  shiverMs: 700,
  /** Scroll speed (px/s) that startles the character into a shiver. */
  shiverScroll: 2500,
  hopMoveMs: 460,
  jumpMoveMs: 380,
});

export interface BodyContext {
  timeMs: number;
  deltaMs: number;
  seed: number;
  posture: 'stand' | 'sit';
  /** The author's clip, path or timeline is driving the layer: only breathing and blinking. */
  authorActive: boolean;
  running: boolean;
  reducedMotion: boolean;
  /** The layer's anchor point in page px, and its height in px (scales moves). */
  position: Point | undefined;
  heightPx: number;
  pointer: Point | undefined;
  idleSeconds: number | undefined;
  scrollY: number | undefined;
  events: readonly WorldEvent[];
  drive?: BodyDrive;
}

/** A small integer hash (deterministic noise): the same seed and key give the same 0…1. */
export function hash01(seed: number, key: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 4294967296;
}
/** A stable seed for a layer: its ID folded with the world seed. */
export function layerSeed(id: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** Rise over `rise`, hold, fall over `fall`, as a 0…1 envelope of the time since a start. */
const envelope = (since: number, rise: number, hold: number, fall: number) =>
  since < 0
    ? 0
    : since < rise
      ? smooth(since / rise)
      : since < rise + hold
        ? 1
        : since < rise + hold + fall
          ? 1 - smooth((since - rise - hold) / fall)
          : 0;

/** Blink weight at a time: one blink in each 4 s slot at a seeded moment, sometimes two. */
export function blinkAt(timeMs: number, seed: number): number {
  const slot = Math.floor(timeMs / 4000);
  let weight = 0;
  for (const k of [slot - 1, slot]) {
    const start = k * 4000 + 400 + hash01(seed, k) * 3000;
    const once = (at: number) => envelope(timeMs - at, 70, 40, 130);
    weight = Math.max(weight, once(start));
    if (hash01(seed, k + 7919) < 0.2) weight = Math.max(weight, once(start + 330));
  }
  return weight;
}

const add = (bones: Record<string, [number, number, number]>, bone: HumanBone, x: number, y: number, z: number) => {
  const v = (bones[bone] ??= [0, 0, 0]);
  v[0] += x;
  v[1] += y;
  v[2] += z;
};

export function initialBodyState(): BodyMotionState {
  return {
    lookYaw: 0,
    lookPitch: 0,
    idleSeconds: 0,
    turnStartMs: null,
    turnSide: 0,
    attendStartMs: null,
    hopStartMs: null,
    shiverUntilMs: 0,
    scrollY: null,
    scrollTimeMs: null,
    position: null,
    moveStartMs: null,
    moveFrom: { x: 0, y: 0 },
    moveKind: 'hop',
  };
}

/** The next state and this frame's additive pose. */
export function evaluateBodyMotion(
  previous: BodyMotionState | undefined,
  context: BodyContext,
): { state: BodyMotionState; pose: BodyPose } {
  if (context.reducedMotion) return { state: initialBodyState(), pose: REST_POSE };
  const t = context.timeMs,
    drive = context.drive ?? DEFAULT_BODY_DRIVE,
    seed = context.seed,
    state: BodyMotionState = previous ? { ...previous } : initialBodyState();
  const author = context.authorActive,
    sit = context.posture === 'sit';
  // Held (hidden page, approached control): the body rests; what it was doing is forgotten.
  if (!context.running) {
    const rest = initialBodyState();
    rest.position = context.position ? { ...context.position } : null;
    return { state: rest, pose: { ...REST_POSE, seat: sit } };
  }
  const idle = context.idleSeconds ?? 0;
  // Signals → occurrences. Only common signals: idle time, pointer, scroll, the main video.
  if (!author) {
    if (state.idleSeconds >= BODY_TIMING.turnAfterS && idle < 0.5 && context.pointer && context.position) {
      state.turnStartMs = t;
      state.turnSide = context.pointer.x >= context.position.x ? 1 : -1;
    }
    for (const event of context.events) {
      if (event.type === 'video.play') state.hopStartMs = t;
      if (event.type === 'video.pause') state.attendStartMs = t;
    }
    if (
      context.scrollY !== undefined &&
      state.scrollY !== null &&
      state.scrollTimeMs !== null &&
      t > state.scrollTimeMs
    ) {
      const speed = (Math.abs(context.scrollY - state.scrollY) * 1000) / (t - state.scrollTimeMs);
      if (speed >= BODY_TIMING.shiverScroll) state.shiverUntilMs = t + BODY_TIMING.shiverMs;
    }
  }
  state.idleSeconds = idle;
  if (context.scrollY !== undefined) {
    state.scrollY = context.scrollY;
    state.scrollTimeMs = t;
  }
  // Moving without walking: the anchor jumped (a layout change, not the author's path).
  let offset: Point = { x: 0, y: 0 },
    opacity = 1;
  if (context.position) {
    const before = state.position,
      dx = before ? before.x - context.position.x : 0,
      dy = before ? before.y - context.position.y : 0,
      distance = Math.hypot(dx, dy);
    if (before && !author && distance > Math.max(24, context.heightPx * 0.15)) {
      // Where a move was under way, start from where the body is drawn now.
      const drawn = moveOffset(state, t, context.heightPx);
      state.moveFrom = { x: dx + drawn.offset.x, y: dy + drawn.offset.y };
      state.moveStartMs = t;
      state.moveKind = distance > context.heightPx * 1.5 ? 'jump' : 'hop';
    }
    state.position = { ...context.position };
    if (author) state.moveStartMs = null;
    const moved = moveOffset(state, t, context.heightPx);
    offset = moved.offset;
    opacity = moved.opacity;
    if (moved.done) state.moveStartMs = null;
  }

  const bones: Record<string, [number, number, number]> = {};
  const hips: [number, number, number] = [0, 0, 0];
  let yawDeg = 0,
    plantFeet = false;
  // Breathing (also under the author's motion, smaller): the chest rises, the shoulders follow.
  const breath = Math.sin((TAU * t) / 4200 + hash01(seed, 1) * TAU) * drive.breathe * (author ? 0.6 : 1);
  add(bones, 'chest', -1.4 * breath, 0, 0);
  add(bones, 'spine', -0.6 * breath, 0, 0);
  add(bones, 'leftUpperArm', 0, 0, 0.8 * breath);
  add(bones, 'rightUpperArm', 0, 0, -0.8 * breath);
  if (!author) {
    // Sway: two slow, unrelated waves, so it never visibly repeats.
    const sway =
      (Math.sin((TAU * t) / 7300 + hash01(seed, 2) * TAU) * 0.6 +
        Math.sin((TAU * t) / 11900 + hash01(seed, 3) * TAU) * 0.4) *
      drive.sway;
    add(bones, sit ? 'spine' : 'hips', 0, sway * 1.2, sway * 1.5);
    add(bones, 'chest', 0, sway * 0.8, -sway * 0.6);
    // Looking around while nobody moves; back to the front when the pointer is active (the
    // author's look-at follows the pointer itself).
    const slot = Math.floor(t / 3500);
    const wandering = idle >= BODY_TIMING.glanceAfterS;
    const targetYaw = wandering ? (hash01(seed, 100 + slot) * 2 - 1) * 40 * drive.glance : 0,
      targetPitch = wandering ? (hash01(seed, 200 + slot) * 20 - 8) * drive.glance : 0;
    const follow = 1 - Math.exp(-Math.max(0, context.deltaMs) / 500);
    state.lookYaw += (targetYaw - state.lookYaw) * follow;
    state.lookPitch += (targetPitch - state.lookPitch) * follow;
    // Turning toward the person who came back: the head leads, the chest and body follow.
    const turn = state.turnStartMs === null ? 0 : envelope(t - state.turnStartMs, 300, 900, 600) * state.turnSide;
    if (state.turnStartMs !== null && t - state.turnStartMs > BODY_TIMING.turnMs) state.turnStartMs = null;
    // After the video pauses, a look down toward it (the character sits above or beside it).
    const attend = state.attendStartMs === null ? 0 : envelope(t - state.attendStartMs, 250, 1600, 650);
    if (state.attendStartMs !== null && t - state.attendStartMs > BODY_TIMING.attendMs) state.attendStartMs = null;
    const lookYaw = state.lookYaw * (1 - Math.abs(turn)) + 35 * turn,
      lookPitch = state.lookPitch * (1 - attend) + 18 * attend;
    add(bones, 'head', lookPitch * 0.6, lookYaw * 0.55, 0);
    add(bones, 'neck', lookPitch * 0.25, lookYaw * 0.25, 0);
    add(bones, 'chest', lookPitch * 0.15, lookYaw * 0.15, 0);
    yawDeg += 12 * turn;
    if (sit) {
      // Legs swing from the knee, out of step, in slow bursts.
      const burst = 0.35 + 0.65 * smooth(0.5 + 0.5 * Math.sin((TAU * t) / 9000 + hash01(seed, 4) * TAU));
      const swing = Math.sin((TAU * t) / 1700) * 11 * burst * drive.fidget;
      add(bones, 'leftLowerLeg', swing, 0, 0);
      add(bones, 'rightLowerLeg', -swing, 0, 0);
    }
    // A hop: crouch, up, land. The feet stay put while the hips dip.
    if (state.hopStartMs !== null) {
      const since = t - state.hopStartMs;
      if (since > BODY_TIMING.hopMs) state.hopStartMs = null;
      else {
        const up = (u: number) => 4 * u * (1 - u);
        if (since < 120) {
          hips[1] -= 0.04 * smooth(since / 120) * drive.hop;
          plantFeet = true;
        } else if (since < 520)
          hips[1] += (0.1 * up((since - 120) / 400) - 0.04 * (1 - smooth((since - 120) / 80))) * drive.hop;
        else {
          hips[1] -= 0.03 * up((since - 520) / 120) * drive.hop;
          plantFeet = true;
        }
      }
    }
    // A shiver after a sudden scroll.
    if (t < state.shiverUntilMs) {
      const left = (state.shiverUntilMs - t) / BODY_TIMING.shiverMs;
      const shake = Math.sin((TAU * t) / 55) * 1.8 * left * drive.shiver;
      add(bones, 'spine', 0, 0, shake);
      add(bones, 'chest', 0, shake * 0.5, -shake * 0.7);
    }
  }
  // Rounded: equal inputs serialize equally and tiny float noise never wakes a redraw.
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const frozen = Object.fromEntries(
    Object.entries(bones).map(([bone, v]) => [bone, [round(v[0]), round(v[1]), round(v[2])] as const]),
  ) as BodyBoneOffsets;
  return {
    state,
    pose: {
      bones: frozen,
      hips: [round(hips[0]), round(hips[1]), round(hips[2])],
      blink: round(blinkAt(t, seed)),
      yawDeg: round(yawDeg + (sit && !author ? 25 : 0)),
      offset: { x: round(offset.x), y: round(offset.y) },
      opacity: round(opacity),
      seat: sit,
      plantFeet,
    },
  };
}

/** The drawn offset of a move under way: a hop along an arc, or out-and-in in place. */
function moveOffset(state: BodyMotionState, t: number, heightPx: number) {
  if (state.moveStartMs === null) return { offset: { x: 0, y: 0 }, opacity: 1, done: false };
  const since = t - state.moveStartMs;
  if (state.moveKind === 'hop') {
    const u = clamp01(since / BODY_TIMING.hopMoveMs),
      e = smooth(u);
    return {
      offset: { x: state.moveFrom.x * (1 - e), y: state.moveFrom.y * (1 - e) - 0.35 * heightPx * 4 * u * (1 - u) },
      opacity: 1,
      done: u >= 1,
    };
  }
  const u = clamp01(since / BODY_TIMING.jumpMoveMs);
  return u < 0.45
    ? { offset: { ...state.moveFrom }, opacity: 1 - smooth(u / 0.45), done: false }
    : { offset: { x: 0, y: 0 }, opacity: smooth((u - 0.45) / 0.55), done: u >= 1 };
}

/** Recorded body states (takes) are read back with the same bounds as every model state. */
export function parseBodyState(value: unknown): BodyMotionState {
  const v = object(value, [
    'lookYaw',
    'lookPitch',
    'idleSeconds',
    'turnStartMs',
    'turnSide',
    'attendStartMs',
    'hopStartMs',
    'shiverUntilMs',
    'scrollY',
    'scrollTimeMs',
    'position',
    'moveStartMs',
    'moveFrom',
    'moveKind',
  ]);
  const time = (n: unknown) => (n === null ? null : numeric(n, 0, 86400000 * 7));
  const coordinate = (n: unknown) => numeric(n, -1e7, 1e7);
  const point = (p: unknown): Point => {
    const q = object(p, ['x', 'y']);
    return { x: coordinate(q['x']), y: coordinate(q['y']) };
  };
  if (v['moveKind'] !== 'hop' && v['moveKind'] !== 'jump') throw new Error('Invalid body state.');
  return {
    lookYaw: numeric(v['lookYaw'], -90, 90),
    lookPitch: numeric(v['lookPitch'], -90, 90),
    idleSeconds: numeric(v['idleSeconds'], 0, 86400 * 7),
    turnStartMs: time(v['turnStartMs']),
    turnSide: numeric(v['turnSide'], -1, 1),
    attendStartMs: time(v['attendStartMs']),
    hopStartMs: time(v['hopStartMs']),
    shiverUntilMs: numeric(v['shiverUntilMs'], 0, 86400000 * 7),
    scrollY: v['scrollY'] === null ? null : coordinate(v['scrollY']),
    scrollTimeMs: time(v['scrollTimeMs']),
    position: v['position'] === null ? null : point(v['position']),
    moveStartMs: time(v['moveStartMs']),
    moveFrom: point(v['moveFrom']),
    moveKind: v['moveKind'],
  };
}
