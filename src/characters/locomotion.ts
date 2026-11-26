/**
 * How a body gets from where it stands to a point on the floor: it turns first, eases into its
 * walking speed, rounds corners and slows down in time to stop on the point. Pure numbers (no
 * three.js, no clock of its own): the behaviour above decides where to go, the rig below turns the
 * speed and the turn into steps. Stepped in fixed slices, so the same walk comes out at any FPS.
 */
export interface Mover {
  x: number;
  z: number;
  /** Radians about y; 0 faces +z (the room's convention, src/world/room-life.ts). */
  heading: number;
  /** Metres a second along the heading. */
  speed: number;
  /** Radians a second (for the rig's lean into a turn). */
  turn: number;
}
export interface MoveLimits {
  /** The speed the walk clip's feet keep (the rig measures it from the clip). */
  maxSpeed: number;
  accel: number;
  decel: number;
  /** Radians a second. */
  turnRate: number;
  /**
   * Facing further off than this (radians) the body turns on the spot before it moves. A calm walk
   * keeps the default (60°); an eager one sets it wide and so leaves in a curve, turning as it goes.
   */
  turnFirst?: number;
}
export const DEFAULT_LIMITS: MoveLimits = { maxSpeed: 0.7, accel: 1.1, decel: 1.4, turnRate: 3.2 };

export type Path = readonly (readonly [number, number])[];
const SLICE = 1 / 120;
/** Within this of the last point the body is there (and stops). */
export const ARRIVE_M = 0.012;
/** A corner is rounded: the next leg starts this far before it. */
const CORNER_M = 0.08;
/** Facing further off than this, the body turns on the spot before it walks. */
const TURN_FIRST = Math.PI / 3;
/** How eagerly the heading closes on its goal (1/s); the turn rate caps it. */
const TURN_GAIN = 7;

export const wrapAngle = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Turns toward a heading, eased near it and never faster than the limit. Returns the new mover. */
export function turnToward(m: Mover, goal: number, dt: number, turnRate: number): Mover {
  const error = wrapAngle(goal - m.heading);
  const step = Math.max(-turnRate * dt, Math.min(turnRate * dt, error * (1 - Math.exp(-TURN_GAIN * dt))));
  return { ...m, heading: m.heading + step, turn: dt > 0 ? step / dt : 0 };
}

const remaining = (m: Mover, path: Path) => {
  let d = 0,
    x = m.x,
    z = m.z;
  for (const [px, pz] of path) {
    d += Math.hypot(px - x, pz - z);
    x = px;
    z = pz;
  }
  return d;
};

export interface MoveResult {
  mover: Mover;
  path: Path;
  arrived: boolean;
}

function slice(m: Mover, path: Path, dt: number, limits: MoveLimits): MoveResult {
  if (!path.length) {
    // Nowhere to go: come to rest (never a dead stop from full speed).
    const speed = Math.max(0, m.speed - limits.decel * dt);
    return {
      mover: {
        ...m,
        speed,
        turn: 0,
        x: m.x + Math.sin(m.heading) * speed * dt,
        z: m.z + Math.cos(m.heading) * speed * dt,
      },
      path,
      arrived: speed === 0,
    };
  }
  const [px, pz] = path[0]!;
  const dx = px - m.x,
    dz = pz - m.z,
    d = Math.hypot(dx, dz);
  const last = path.length === 1;
  if (last && d <= ARRIVE_M) return { mover: { ...m, speed: 0, turn: 0 }, path: [], arrived: true };
  if (!last && d <= CORNER_M) return { mover: m, path: path.slice(1), arrived: false };
  const toward = Math.atan2(dx, dz);
  const turned = turnToward(m, toward, dt, limits.turnRate);
  const error = Math.abs(wrapAngle(toward - turned.heading));
  // Facing the way: full speed. Facing away: turn on the spot (a body does not walk sideways).
  // Close to the point the turn would be an orbit, so the last steps go straight at it.
  const turnFirst = limits.turnFirst ?? TURN_FIRST;
  const facing = d < 0.2 ? 1 : Math.max(0, Math.min(1, (turnFirst - error) / (turnFirst * 0.6)));
  // Slow enough to stop on the last point; corners are taken at the pace the turn there allows.
  const left = remaining(turned, path);
  // (A creep at the very end, so the point is reached and the last of the speed is next to nothing.)
  let limit = Math.max(0.03, Math.sqrt(2 * limits.decel * Math.max(0, left - ARRIVE_M)));
  const next = path[1];
  if (next) {
    const bend = Math.abs(wrapAngle(Math.atan2(next[0] - px, next[1] - pz) - toward));
    const cornerSpeed = limits.maxSpeed * Math.max(0.25, Math.cos(Math.min(Math.PI / 2, bend)));
    limit = Math.min(limit, Math.sqrt(cornerSpeed * cornerSpeed + 2 * limits.decel * Math.max(0, d - CORNER_M)));
  }
  const wanted = Math.min(limits.maxSpeed * facing, limit);
  const speed =
    wanted > m.speed
      ? Math.min(wanted, m.speed + limits.accel * dt)
      : Math.max(wanted, m.speed - limits.decel * 1.5 * dt);
  // Along the heading while there is room to curve; straight at the point over the last steps.
  const direct = d < 0.2 || last ? Math.max(0, Math.min(1, 1 - (d - 0.05) / 0.15)) : 0;
  const hx = Math.sin(turned.heading),
    hz = Math.cos(turned.heading);
  let mx = hx + (dx / d - hx) * direct,
    mz = hz + (dz / d - hz) * direct;
  const ml = Math.hypot(mx, mz) || 1;
  mx /= ml;
  mz /= ml;
  const travel = Math.min(speed * dt, last ? d : Infinity);
  return { mover: { ...turned, speed, x: m.x + mx * travel, z: m.z + mz * travel }, path, arrived: false };
}

/** One frame of walking along a path of floor points (from src/world/room-life.ts floorPath). */
export function stepMover(m: Mover, path: Path, dt: number, limits: MoveLimits = DEFAULT_LIMITS): MoveResult {
  let result: MoveResult = { mover: m, path, arrived: false };
  let left = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
  if (left === 0) return result;
  while (left > 1e-9) {
    const step = Math.min(SLICE, left);
    result = slice(result.mover, result.path, step, limits);
    left -= step;
  }
  return result;
}
