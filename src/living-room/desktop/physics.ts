/**
 * The desktop's windows as things (docs/living-mind.md): let go while moving, a window keeps
 * going, slows, tips into its motion and rights itself, and bounces off the edge of the screen.
 * The ball hardly slows and bounces hard. A window sat on sags and bobs. Pure: velocities in CSS
 * pixels a second, angles in radians; the view moves the windows by them.
 */
export interface Motion {
  vx: number;
  vy: number;
  /** The lean into its motion (radians), a spring. */
  tilt: number;
  tiltV: number;
  /** How far it hangs down under a weight (CSS pixels), a spring. */
  sag: number;
  sagV: number;
  /** A ball's turn (radians): it rolls as it goes. */
  spin: number;
}

export const still = (): Motion => ({ vx: 0, vy: 0, tilt: 0, tiltV: 0, sag: 0, sagV: 0, spin: 0 });

/** Slower than this (pixels a second) it has stopped. */
const REST = 6;
const FRICTION = { window: 2.6, ball: 0.55 };
const BOUNCE = { window: 0.42, ball: 0.86 };
export const BALL_RADIUS = 36;

function spring(value: number, speed: number, goal: number, stiff: number, damp: number, dt: number) {
  for (let left = dt; left > 1e-6; left -= 1 / 240) {
    const h = Math.min(1 / 240, left);
    speed += (-stiff * stiff * (value - goal) - 2 * damp * stiff * speed) * h;
    value += speed * h;
  }
  return [value, speed] as const;
}

/** One frame of a thing's own motion (not where it is: the view moves it by `vx`, `vy`). */
export function stepMotion(m: Motion, dt: number, ball: boolean, sat: boolean): Motion {
  const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const keep = Math.exp(-(ball ? FRICTION.ball : FRICTION.window) * d);
  let vx = m.vx * keep,
    vy = m.vy * keep;
  if (Math.hypot(vx, vy) < REST) vx = vy = 0;
  const [tilt, tiltV] = spring(m.tilt, m.tiltV, ball ? 0 : Math.max(-0.2, Math.min(0.2, vx * 0.00022)), 9, 0.35, d);
  const [sag, sagV] = spring(m.sag, m.sagV, sat ? 9 : 0, 11, 0.28, d);
  return {
    vx,
    vy,
    tilt: Math.abs(tilt) < 1e-4 && Math.abs(tiltV) < 1e-3 ? 0 : tilt,
    tiltV: Math.abs(tilt) < 1e-4 && Math.abs(tiltV) < 1e-3 ? 0 : tiltV,
    sag: Math.abs(sag) < 0.02 && Math.abs(sagV) < 0.2 && !sat ? 0 : sag,
    sagV: Math.abs(sag) < 0.02 && Math.abs(sagV) < 0.2 && !sat ? 0 : sagV,
    spin: ball ? m.spin + (vx * d) / BALL_RADIUS : 0,
  };
}

/**
 * It was moved to `want` but the screen's edge held it at `got`: it bounces back along that
 * axis, losing some of its speed.
 */
export function bounce(
  m: Motion,
  want: readonly [number, number],
  got: readonly [number, number],
  ball: boolean,
): Motion {
  const k = ball ? BOUNCE.ball : BOUNCE.window;
  return {
    ...m,
    vx: Math.abs(want[0] - got[0]) > 0.5 ? -m.vx * k : m.vx,
    vy: Math.abs(want[1] - got[1]) > 0.5 ? -m.vy * k : m.vy,
  };
}

/** Whether anything of it still moves (the page draws while it does). */
export const moving = (m: Motion) =>
  m.vx !== 0 || m.vy !== 0 || m.tilt !== 0 || m.tiltV !== 0 || m.sag !== 0 || m.sagV !== 0;

export const speedOf = (m: Motion) => Math.hypot(m.vx, m.vy);

/**
 * The velocity a thing is let go with: from where the pointer was over the last tenth of a
 * second (older samples do not count: a drag that stopped before the release throws nothing).
 */
export function throwVelocity(samples: readonly { t: number; x: number; y: number }[], now: number): [number, number] {
  const fresh = samples.filter((s) => now - s.t <= 100);
  const first = fresh[0],
    last = fresh[fresh.length - 1];
  if (!first || !last || last.t - first.t < 16) return [0, 0];
  const seconds = (last.t - first.t) / 1000;
  const cap = (v: number) => Math.max(-4200, Math.min(4200, v));
  return [cap((last.x - first.x) / seconds), cap((last.y - first.y) / seconds)];
}
