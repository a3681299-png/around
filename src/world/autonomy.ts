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
  /** The edge of its part it sits on at rest, when the part has seats (absent: its home point). */
  seat?: SeatEdge;
}
/** An edge of the part a character lives on that it can sit on (the adapter says which). */
export type SeatEdge = 'top' | 'bottom';
export const SEAT_EDGES: readonly SeatEdge[] = ['bottom', 'top'];
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
  /** Its drawn width (px): with the height, the box that must stay inside the room. */
  widthPx?: number;
  /** The part it lives on (its anchor's frame, the same space as home): it never leaves it. */
  room?: { left: number; top: number; width: number; height: number };
  pointer: Point | undefined;
  idleSeconds: number;
  playing: boolean;
  personality: Personality;
  /** The edges of its part it may sit on (page px of each edge line), from the site adapter
   * through the host. With seats, home at rest is a point on an edge, not the authored point. */
  seats?: readonly { edge: SeatEdge; y: number }[];
  /** By behaviour: the speed (px/s) its walk or run keeps the feet still at (src/world/gait.ts).
   * Such a move walks there at that speed instead of hopping. */
  gaits?: Partial<Record<Behaviour, number>>;
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
  /** Bored this much while sitting, it moves to its part's other edge. */
  seatBoredom: 0.8,
  /** Going home within this long of the pointer being near, it takes the edge away from it (ms). */
  seatAvoidMs: 10000,
});

declare const __WW_AUTONOMY_PACE__: number | undefined;
/** 1 in every product build. A development build (WW_AUTONOMY_PACE, scripts/build.mjs, inside .work
 * only) speeds the inner states up to see a doze or a change of seat without waiting minutes. */
const PACE = typeof __WW_AUTONOMY_PACE__ === 'number' ? __WW_AUTONOMY_PACE__ : 1;
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
    // Speed over the time since the pointer last moved, not since the last frame: a mouse that
    // reports every 80 ms would otherwise look five times faster than it is.
    const moved = !s.pointer || s.pointer.x !== context.pointer.x || s.pointer.y !== context.pointer.y;
    if (moved) {
      if (s.pointer && s.pointerTime !== null && t > s.pointerTime) {
        const seconds = Math.min(1, (t - s.pointerTime) / 1000);
        speed = distance(context.pointer, s.pointer) / seconds;
        closing = (distance(s.pointer, body) - d) / seconds;
      }
      s.pointer = { ...context.pointer };
      s.pointerTime = t;
    }
    if (near) s.nearAt = t;
  }
  // Internal states, fixed formulas: rises with what happens (or does not), decays otherwise.
  const quiet = context.idleSeconds * PACE >= 3;
  s.boredom = clamp(s.boredom + (quiet ? (dt / 40) * PACE : -dt / 4));
  s.sleepy = clamp(s.sleepy + (context.idleSeconds * PACE >= 10 ? (dt / 90) * (0.5 + p.sleepiness) * PACE : -dt / 2));
  s.startles = Math.max(0, s.startles - dt / 120);
  s.alert = clamp(s.alert - dt / 6);
  if (near && closing > AUTONOMY.fastApproach) {
    // Startled: the more often it happened on this page, the more it is.
    s.alert = clamp(s.alert + 0.6 * (0.5 + p.shyness) * (1 + 0.3 * s.startles));
    s.startles = Math.min(20, s.startles + 1);
    s.sleepy = 0;
  }
  // Seats (the edges of its part): at rest it sits on one, its anchor point on the edge line, the
  // box overhanging it (so it never rests in the air). It takes the lower edge first; back from a
  // fright, the edge farther from the pointer; bored of a place, the other edge.
  const seats = context.seats?.length ? context.seats : undefined;
  const seatAt = (edge: SeatEdge | undefined) => seats?.find((q) => q.edge === edge) ?? seats?.[0];
  /** Only called with seats. */
  const pickSeat = (avoid: Point | null): SeatEdge => {
    const all = seats!;
    if (!avoid || all.length < 2) return (seatAt(s.seat) ?? all[0]!).edge;
    return [...all].sort((a, b) => Math.abs(b.y - avoid.y) - Math.abs(a.y - avoid.y))[0]!.edge;
  };
  if (seats && !seats.some((q) => q.edge === s.seat)) s.seat = pickSeat(null);
  // Utility AI: each behaviour scores from the states and the situation; the best one wins,
  // after the current one has had its minimum time.
  const away = s.nearAt === null || t - s.nearAt > AUTONOMY.returnAfterMs;
  const homeOffset = (): Point => {
    const seat = seatAt(s.seat);
    return seat ? { x: s.offset.x, y: seat.y - context.home.y } : { x: 0, y: 0 };
  };
  const offHome = distance(s.offset, homeOffset()) > 2;
  if (seats && seats.length > 1 && s.behaviour === 'rest' && !offHome && s.boredom >= AUTONOMY.seatBoredom) {
    // A change of place: to the other edge, a little less bored for it.
    s.seat = seats.find((q) => q.edge !== s.seat)!.edge;
    s.boredom = AUTONOMY.seatBoredom / 2;
    s.target = homeOffset();
  }
  const scores: Record<Behaviour, number> = {
    rest: 0.2,
    flee: near && s.alert > 0.45 ? s.alert : 0,
    // Curiosity draws it in, shyness holds it back; with no curiosity it stays (below rest's 0.2).
    approach:
      near && speed < AUTONOMY.slowApproach && s.alert < 0.25 ? (0.1 + 0.6 * p.curiosity) * (1 - 0.4 * p.shyness) : 0,
    doze: s.sleepy > 0.6 && s.alert < 0.2 ? s.sleepy : 0,
    // With seats it sits only on an edge: off its edge, it goes back once calm even with the
    // pointer near (to the edge farther from the pointer), rather than rest in the air.
    return: offHome && (away || seats) && s.alert < 0.45 ? 0.5 : 0,
  };
  // Offsets that keep the whole drawn box inside its room (a margin of its half width/height).
  // Where the room is narrower than the box, the box's middle stays at the room's middle.
  const room = context.room,
    halfW = (context.widthPx ?? 0.8 * h) / 2,
    halfH = h / 2;
  const keep = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));
  const keepX = (x: number) =>
    room ? keep(context.home.x + x, room.left + halfW, room.left + room.width - halfW) - context.home.x : x;
  const keepY = (y: number) =>
    room ? keep(context.home.y + y, room.top + halfH, room.top + room.height - halfH) - context.home.y : y;
  let best: Behaviour = 'rest';
  for (const b of BEHAVIOURS) if (scores[b] > scores[best]) best = b;
  if (best !== s.behaviour && (t - s.since >= AUTONOMY.dwellMs || best === 'flee')) {
    s.behaviour = best;
    s.since = t;
    if (best === 'flee' && context.pointer) {
      // Away from the pointer, sideways first (a seat's edge runs sideways), inside its room;
      // with no room that way (home at the room's edge), up and away instead.
      const dx = body.x - context.pointer.x,
        side = dx === 0 ? 1 : Math.sign(dx);
      const x = keepX(s.offset.x + side * AUTONOMY.fleeHeights * h);
      s.target =
        Math.abs(x - s.offset.x) >= 0.6 * h
          ? { x, y: s.offset.y }
          : { x: keepX(s.offset.x + side * 0.4 * h), y: keepY(s.offset.y - AUTONOMY.fleeHeights * h) };
    }
    if (best === 'return') {
      // Away from the pointer only if it was near lately (a fright); else the edge it had.
      const recent = s.nearAt !== null && t - s.nearAt < AUTONOMY.seatAvoidMs ? s.pointer : null;
      if (seats) s.seat = pickSeat(recent);
      s.target = seats ? { x: 0, y: homeOffset().y } : { x: 0, y: 0 };
    }
    // Resting off its edge with the pointer still near, it stays put; going back is the return's
    // (once the pointer is away), not a rest's.
    if (best === 'rest') s.target = seats && away ? homeOffset() : { ...s.offset };
  }
  if (seats && s.behaviour === 'rest' && !offHome) s.target = homeOffset();
  // Going back, it aims at the edge where it is now: the part may move or resize after the return
  // began (a page settling), and the target fixed then would leave it standing beside the edge for
  // good (still "off home", so still returning, but already at its target).
  if (seats && s.behaviour === 'return') s.target = { x: s.target.x, y: homeOffset().y };
  // It dozes off only where it sits: on its edge (going there first if it is elsewhere).
  if (seats && s.behaviour === 'doze') s.target = homeOffset();
  if (s.behaviour === 'approach' && context.pointer) {
    // A little toward the pointer, never onto it, and not far from home.
    const dx = context.pointer.x - body.x,
      reach = Math.max(-0.7 * h, Math.min(0.7 * h, s.offset.x + Math.sign(dx) * Math.max(0, Math.abs(dx) - 0.9 * h)));
    s.target = { x: keepX(reach), y: s.offset.y };
  }
  // Move toward the target at the behaviour's speed; a quick move hops, a walk or a run walks.
  const gait = context.gaits?.[s.behaviour];
  const speedPx =
    gait !== undefined
      ? gait
      : s.behaviour === 'flee'
        ? AUTONOMY.fleeSpeed
        : s.behaviour === 'approach'
          ? AUTONOMY.approachSpeed
          : s.behaviour === 'return' || (seats && (s.behaviour === 'rest' || s.behaviour === 'doze'))
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
  const moving = gap > 1 && speedPx > 200 && gait === undefined;
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
    'seat',
  ]);
  // Optional: states recorded before seats existed have none.
  if (v['seat'] !== undefined && !SEAT_EDGES.includes(v['seat'] as SeatEdge))
    throw new Error('Invalid autonomy state.');
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
    ...(v['seat'] !== undefined ? { seat: v['seat'] as SeatEdge } : {}),
  };
}
