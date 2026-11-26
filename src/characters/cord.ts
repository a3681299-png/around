/**
 * A wired earphone cord (docs/living-life.md): one strand from the phone's jack to a splitter,
 * two from there to the buds. Points with fixed distances between them (Verlet integration and
 * a few relaxation passes), gravity, a little air drag, and a surface it rests on instead of
 * passing through (the bed or the floor, as a height under each point). The ends are pinned to
 * where the page puts the phone and the buds each frame. Fixed 1/120 s slices, so the cord moves
 * the same at any frame rate. Pure: no three.js.
 */
import type { Vec3 } from './two-bone-ik';

export interface Cord {
  readonly count: number;
  readonly jack: number;
  readonly splitter: number;
  readonly budL: number;
  readonly budR: number;
  /** Positions now and one slice ago, three numbers a point. */
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  /** Pairs of points held at a distance. */
  readonly links: Int32Array;
  readonly rest: Float64Array;
  /** Time not yet stepped (less than a slice). */
  carry: number;
  node(i: number): Vec3;
}

const SLICE = 1 / 120;
const GRAVITY = -9.8;
const DRAG = 0.04;
const PASSES = 6;
/** The cord's half thickness: it rests this far above a surface. */
const RADIUS = 0.002;

/** Points along each strand (the main one, then each branch). */
const MAIN_POINTS = 9;
const BRANCH_POINTS = 6;

/** A cord hanging straight down from `start`: main strand and two branches of the given lengths. */
export function makeCord(start: Vec3, lengths: { main: number; branch: number }): Cord {
  // 0 … MAIN_POINTS-1 the main strand (0 the jack, the last the splitter), then each branch.
  const count = MAIN_POINTS + 2 * (BRANCH_POINTS - 1);
  const pos = new Float64Array(count * 3);
  const links: number[] = [],
    rest: number[] = [];
  const mainStep = lengths.main / (MAIN_POINTS - 1),
    branchStep = lengths.branch / (BRANCH_POINTS - 1);
  for (let i = 0; i < MAIN_POINTS; i++) {
    pos.set([start[0], start[1] - i * mainStep, start[2]], i * 3);
    if (i) (links.push(i - 1, i), rest.push(mainStep));
  }
  const splitter = MAIN_POINTS - 1;
  const ends: number[] = [];
  for (const side of [-1, 1]) {
    let last = splitter;
    for (let j = 1; j < BRANCH_POINTS; j++) {
      const i = splitter + (side < 0 ? j : BRANCH_POINTS - 1 + j);
      const y = start[1] - lengths.main - j * branchStep * 0.7;
      pos.set([start[0] + side * j * branchStep * 0.7, y, start[2]], i * 3);
      (links.push(last, i), rest.push(branchStep));
      last = i;
    }
    ends.push(last);
  }
  return {
    count,
    jack: 0,
    splitter,
    budL: ends[0]!,
    budR: ends[1]!,
    pos,
    prev: pos.slice(),
    links: Int32Array.from(links),
    rest: Float64Array.from(rest),
    carry: 0,
    node(i) {
      return [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    },
  };
}

/**
 * One frame: the pinned points go where they are put, the rest fall, swing and settle, held to
 * their lengths, never under `ground(x, z)` (the height of what is below them).
 */
export function stepCord(
  cord: Cord,
  dt: number,
  pins: ReadonlyMap<number, Vec3>,
  ground: (x: number, z: number) => number,
) {
  const { pos, prev, links, rest } = cord;
  cord.carry += Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
  // The pins move smoothly through the slices of one frame (where they were → where they are).
  const from = new Map<number, Vec3>();
  for (const i of pins.keys()) from.set(i, cord.node(i));
  const slices = Math.floor(cord.carry / SLICE + 1e-9);
  for (let n = 1; n <= slices; n++) {
    const k = n / slices;
    for (let i = 0; i < cord.count; i++) {
      if (pins.has(i)) continue;
      const o = i * 3;
      for (let a = 0; a < 3; a++) {
        const now = pos[o + a]!;
        const velocity = (now - prev[o + a]!) * (1 - DRAG);
        prev[o + a] = now;
        pos[o + a] = now + velocity + (a === 1 ? GRAVITY * SLICE * SLICE : 0);
      }
    }
    for (const [i, to] of pins) {
      const f = from.get(i)!;
      const o = i * 3;
      for (let a = 0; a < 3; a++) {
        prev[o + a] = pos[o + a]!;
        pos[o + a] = f[a]! + (to[a]! - f[a]!) * k;
      }
    }
    for (let pass = 0; pass < PASSES; pass++) {
      for (let l = 0; l < rest.length; l++) {
        const a = links[l * 2]!,
          b = links[l * 2 + 1]!;
        const ax = a * 3,
          bx = b * 3;
        const dx = pos[bx]! - pos[ax]!,
          dy = pos[bx + 1]! - pos[ax + 1]!,
          dz = pos[bx + 2]! - pos[ax + 2]!;
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        // Only a stretch is pulled back: a cord pushed together just bends (it is not a rod).
        if (d <= rest[l]!) continue;
        const pinA = pins.has(a),
          pinB = pins.has(b);
        if (pinA && pinB) continue;
        const share = (d - rest[l]!) / d;
        const wa = pinA ? 0 : pinB ? 1 : 0.5,
          wb = pinB ? 0 : pinA ? 1 : 0.5;
        pos[ax] = pos[ax]! + dx * share * wa;
        pos[ax + 1] = pos[ax + 1]! + dy * share * wa;
        pos[ax + 2] = pos[ax + 2]! + dz * share * wa;
        pos[bx] = pos[bx]! - dx * share * wb;
        pos[bx + 1] = pos[bx + 1]! - dy * share * wb;
        pos[bx + 2] = pos[bx + 2]! - dz * share * wb;
      }
      // Resting on what is below: lifted onto it, and the slide along it slowed (friction).
      for (let i = 0; i < cord.count; i++) {
        if (pins.has(i)) continue;
        const o = i * 3;
        const floor = ground(pos[o]!, pos[o + 2]!) + RADIUS;
        if (pos[o + 1]! < floor) {
          pos[o + 1] = floor;
          prev[o + 1] = Math.min(prev[o + 1]!, floor);
          prev[o] = prev[o]! + (pos[o]! - prev[o]!) * 0.3;
          prev[o + 2] = prev[o + 2]! + (pos[o + 2]! - prev[o + 2]!) * 0.3;
        }
      }
    }
  }
  cord.carry -= slices * SLICE;
  // A pin held exactly where it was put (the slices may leave it a rounding short).
  for (const [i, to] of pins) pos.set(to, i * 3);
}

/** The cord's whole length as it lies now (for checking it does not stretch). */
export function cordLength(cord: Cord): number {
  let sum = 0;
  for (let l = 0; l < cord.rest.length; l++) {
    const a = cord.node(cord.links[l * 2]!),
      b = cord.node(cord.links[l * 2 + 1]!);
    sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return sum;
}
