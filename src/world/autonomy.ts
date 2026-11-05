import type { Point } from './geometry';
import { numeric, object } from '../models/types';

/**
 * The smallest autonomy (R4's first half, docs/autonomy-plan.md 2・7): internal states that rise
 * and fall by fixed formulas, and a Utility AI that picks one behaviour from them. Pure: time,
 * the seed and the common signals (pointer, idle time, the main video) are inputs; nothing here
 * knows a site. The behaviour moves the character relative to its home (the authored anchor
 * point, e.g. a player's corner) by an offset in page px; the body motion draws it.
 *
 * Memory: being startled again and again makes the character easier to alarm. Kept for this page
 * only (WorldState, so recordings replay it): the design's lasting memory (stage 7) needs the
 * person's consent and a place outside the page, and is not part of this.
 */
export type Behaviour = 'rest' | 'flee' | 'approach' | 'doze' | 'return';
export const BEHAVIOURS: readonly Behaviour[] = ['rest', 'flee', 'approach', 'doze', 'return'];

export interface Personality {
  /** 0…1: how easily a fast pointer alarms it. */
  shyness: number;
  /** 0…1: how readily it comes closer to a slow pointer. */
  curiosity: number;
  /** 0…1: how soon it dozes when nothing happens. */
  sleepiness: number;
}
export const DEFAULT_PERSONALITY: Personality = Object.freeze({ shyness: 0.5, curiosity: 0.5, sleepiness: 0.5 });

export interface AutonomyState {
  boredom: number;
  alert: number;
  sleepy: number;
  /** Times it was startled on this page, decaying slowly (the memory). */
  startles: number;
  behaviour: Behaviour;
  since: number;
  /** Where it is drawn relative to home (px), and where it is heading. */
  offset: Point;
  target: Point;
  /** The pointer at the last frame, for its speed and whether it comes closer. */
  pointer: Point | null;
  pointerTime: number | null;
  /** When the pointer was last near (for the return). */
  nearAt: number | null;
}
export function initialAutonomy(): AutonomyState {
  return {
    boredom: 0,
    alert: 0,
    sleepy: 0,
    startles: 0,
    behaviour: 'rest',
    since: 0,
    offset: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    pointer: null,
    pointerTime: null,
    nearAt: null,
  };
}

export interface AutonomyContext {
  timeMs: number;
  deltaMs: number;
  /** Home: the authored anchor point (page px), and the character's drawn height (px). */
  home: Point;
  heightPx: number;
  pointer: Point | undefined;
  idleSeconds: number;
  playing: boolean;
  personality: Personality;
}
export interface AutonomyOutput {
  offset: Point;
  /** 0…1 how much each pose element shows: a bored body fidgets more, a dozing one hangs its head. */
  fidget: number;
  doze: number;
  /** -1…1 lean toward (+) or away from (-) the pointer, and the hop height of a move (px). */
  lean: number;
  hop: number;
}

export const AUTONOMY = Object.freeze({
  /** Within this many heights the pointer is "near". */
  nearHeights: 2.2,
  /** Pointer speed toward the character (px/s) that startles it. */
  fastApproach: 900,
  /** Below this speed (px/s) a near pointer counts as slow, an invitation. */
  slowApproach: 260,
  fleeHeights: 1.4,
  fleeSpeed: 1400,
  approachSpeed: 70,
  returnSpeed: 420,
  /** How long the pointer must be away before it goes home (ms). */
  returnAfterMs: 1400,
  /** A behaviour lasts at least this long before another can take over (ms). */
  dwellMs: 600,
});

const clamp = (v: number, low = 0, high = 1) => Math.max(low, Math.min(high, v));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function evaluateAutonomy(
  previous: AutonomyState | undefined,
  context: AutonomyContext,
): { state: AutonomyState; output: AutonomyOutput } {
  const s: AutonomyState = previous
    ? { ...previous, offset: { ...previous.offset }, target: { ...previous.target } }
    : initialAutonomy();
  const t = context.timeMs,
    dt = clamp(context.deltaMs, 0, 250) / 1000,
    h = Math.max(20, context.heightPx),
    p = context.personality;
  const body = { x: context.home.x + s.offset.x, y: context.home.y + s.offset.y };
  // The pointer: how near, how fast, whether it is coming closer.
  let near = false,
    speed = 0,
    closing = 0;
  if (context.pointer) {
    const d = distance(context.pointer, body);
    near = d < AUTONOMY.nearHeights * h;
    if (s.pointer && s.pointerTime !== null && t > s.pointerTime) {
      const seconds = (t - s.pointerTime) / 1000;
      speed = distance(context.pointer, s.pointer) / seconds;
      closing = (distance(s.pointer, body) - d) / seconds;
    }
    s.pointer = { ...context.pointer };
    s.pointerTime = t;
    if (near) s.nearAt = t;
  }
  // Internal states, fixed formulas: rises with what happens (or does not), decays otherwise.
  const quiet = context.idleSeconds >= 3;
  s.boredom = clamp(s.boredom + (quiet ? dt / 40 : -dt / 4));
  s.sleepy = clamp(s.sleepy + (context.idleSeconds >= 10 ? (dt / 90) * (0.5 + p.sleepiness) : -dt / 2));
  s.startles = Math.max(0, s.startles - dt / 120);
  s.alert = clamp(s.alert - dt / 6);
  if (near && closing > AUTONOMY.fastApproach) {
    // Startled: the more often it happened on this page, the more it is.
    s.alert = clamp(s.alert + 0.6 * (0.5 + p.shyness) * (1 + 0.3 * s.startles));
    s.startles = Math.min(20, s.startles + 1);
    s.sleepy = 0;
  }
  // Utility AI: each behaviour scores from the states and the situation; the best one wins,
  // after the current one has had its minimum time.
  const away = s.nearAt === null || t - s.nearAt > AUTONOMY.returnAfterMs;
  const offHome = Math.hypot(s.offset.x, s.offset.y) > 2;
  const scores: Record<Behaviour, number> = {
    rest: 0.2,
    flee: near && s.alert > 0.45 ? s.alert : 0,
    // Curiosity draws it in, shyness holds it back; with no curiosity it stays (below rest's 0.2).
    approach:
      near && speed < AUTONOMY.slowApproach && s.alert < 0.25 ? (0.1 + 0.6 * p.curiosity) * (1 - 0.4 * p.shyness) : 0,
    doze: s.sleepy > 0.6 && s.alert < 0.2 ? s.sleepy : 0,
    return: offHome && away && s.alert < 0.45 ? 0.5 : 0,
  };
  let best: Behaviour = 'rest';
  for (const b of BEHAVIOURS) if (scores[b] > scores[best]) best = b;
  if (best !== s.behaviour && (t - s.since >= AUTONOMY.dwellMs || best === 'flee')) {
    s.behaviour = best;
    s.since = t;
    if (best === 'flee' && context.pointer) {
      // Away from the pointer, horizontally first (a seat's edge runs sideways).
      const dx = body.x - context.pointer.x,
        side = dx === 0 ? 1 : Math.sign(dx);
      s.target = { x: s.offset.x + side * AUTONOMY.fleeHeights * h, y: s.offset.y };
    }
    if (best === 'return' || best === 'rest') s.target = best === 'return' ? { x: 0, y: 0 } : { ...s.offset };
  }
  if (s.behaviour === 'approach' && context.pointer) {
    // A little toward the pointer, never onto it, and not far from home.
    const dx = context.pointer.x - body.x,
      reach = Math.max(-0.7 * h, Math.min(0.7 * h, s.offset.x + Math.sign(dx) * Math.max(0, Math.abs(dx) - 0.9 * h)));
    s.target = { x: reach, y: s.offset.y };
  }
  // Move toward the target at the behaviour's speed; a quick move hops.
  const speedPx =
    s.behaviour === 'flee'
      ? AUTONOMY.fleeSpeed
      : s.behaviour === 'approach'
        ? AUTONOMY.approachSpeed
        : s.behaviour === 'return'
          ? AUTONOMY.returnSpeed
          : 0;
  const gap = distance(s.target, s.offset),
    step = Math.min(gap, speedPx * dt);
  if (gap > 0.01 && step > 0) {
    s.offset = {
      x: s.offset.x + ((s.target.x - s.offset.x) / gap) * step,
      y: s.offset.y + ((s.target.y - s.offset.y) / gap) * step,
    };
  }
  const moving = gap > 1 && speedPx > 200;
  const round = (v: number) => Math.round(v * 100) / 100;
  s.offset = { x: round(s.offset.x), y: round(s.offset.y) };
  const travelled = moving ? 1 - gap / Math.max(1, AUTONOMY.fleeHeights * h) : 0;
  return {
    state: s,
    output: {
      offset: { ...s.offset },
      fidget: clamp(0.5 + s.boredom),
      doze: s.behaviour === 'doze' ? clamp((t - s.since) / 1500) : 0,
      lean: s.behaviour === 'approach' ? 0.6 : s.behaviour === 'flee' ? -0.5 : 0,
      hop: moving ? round(0.25 * h * Math.sin(Math.PI * clamp(travelled))) : 0,
    },
  };
}

/** Recorded autonomy states read back with bounds, like every model state. */
export function parseAutonomyState(value: unknown): AutonomyState {
  const v = object(value, [
    'boredom',
    'alert',
    'sleepy',
    'startles',
    'behaviour',
    'since',
    'offset',
    'target',
    'pointer',
    'pointerTime',
    'nearAt',
  ]);
  const coordinate = (n: unknown) => numeric(n, -1e7, 1e7);
  const point = (q: unknown): Point => {
    const o = object(q, ['x', 'y']);
    return { x: coordinate(o['x']), y: coordinate(o['y']) };
  };
  const time = (n: unknown) => (n === null ? null : numeric(n, 0, 86400000 * 7));
  if (!BEHAVIOURS.includes(v['behaviour'] as Behaviour)) throw new Error('Invalid autonomy state.');
  return {
    boredom: numeric(v['boredom'], 0, 1),
    alert: numeric(v['alert'], 0, 1),
    sleepy: numeric(v['sleepy'], 0, 1),
    startles: numeric(v['startles'], 0, 20),
    behaviour: v['behaviour'] as Behaviour,
    since: numeric(v['since'], 0, 86400000 * 7),
    offset: point(v['offset']),
    target: point(v['target']),
    pointer: v['pointer'] === null ? null : point(v['pointer']),
    pointerTime: time(v['pointerTime']),
    nearAt: time(v['nearAt']),
  };
}
