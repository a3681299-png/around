/**
 * Keeps a foot that is on the floor where it is. Motions are played in place while the body is
 * moved and turned by the behaviour, and two motions are blended, so the animated foot drifts over
 * the floor (slides while walking, spins when the body turns on the spot). Here each foot that the
 * motion says is down is pinned at its contact point (the toes, or the ankle while the toes are
 * up); when the body has moved too far from a pinned foot, the foot takes a small step to where the
 * motion wants it. Pure numbers and one small state per foot: the rig reads the animated pose,
 * asks this where the foot should be, and solves the leg to it (two-bone IK).
 */
import type { Vec3 } from './two-bone-ik';

export interface FootSample {
  /** The animated ankle and toe joints in the world, before any correction. */
  ankle: Vec3;
  toe: Vec3;
  /** How far each is above where it rests when standing (metres; about 0 on the floor). */
  ankleRise: number;
  toeRise: number;
  /** The animated foot's turn about the up axis in the world, radians. */
  yaw: number;
}

export interface FootState {
  /** The correction now applied to the animated foot: the offset on the floor and the turn. */
  dx: number;
  dz: number;
  dyaw: number;
  /** Extra height (the arc of a corrective step). */
  lift: number;
  down: boolean;
  /** Which joint is the contact while down. */
  contact: 'toe' | 'ankle';
  /** Where the contact is pinned in the world, and the foot's pinned turn. */
  pinX: number;
  pinZ: number;
  pinYaw: number;
  /** A corrective step in progress: 0–1, and the correction it started from. */
  step: number | undefined;
  fromX: number;
  fromZ: number;
  fromYaw: number;
  /** Seconds since the last step ended (a foot does not step twice in a row). */
  rested: number;
}

export const footAtRest = (): FootState => ({
  dx: 0,
  dz: 0,
  dyaw: 0,
  lift: 0,
  down: false,
  contact: 'toe',
  pinX: 0,
  pinZ: 0,
  pinYaw: 0,
  step: undefined,
  fromX: 0,
  fromZ: 0,
  fromYaw: 0,
  rested: 1,
});

/** A joint this far above its standing height is off the floor (and back on below the lower one). */
const UP_M = 0.03;
const DOWN_M = 0.018;
/** The body has left a pinned foot behind by this much: it steps. */
export const STEP_DRIFT_M = 0.085;
export const STEP_YAW = 0.5;
const STEP_S = 0.26;
const STEP_LIFT_M = 0.035;
/** How fast a correction is let go once the foot is in the air (1/s). */
const RELEASE = 14;

const wrap = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const ease = (v: number) => v * v * (3 - 2 * v);

/** How far the body has drifted from this pinned foot (0 when it is not pinned). */
export function footStrain(state: FootState): number {
  if (!state.down || state.step !== undefined) return 0;
  return Math.hypot(state.dx, state.dz) / STEP_DRIFT_M + Math.abs(state.dyaw) / STEP_YAW;
}

/**
 * One frame for one foot.
 * @param mayStep  the other foot is planted and not stepping (one foot at a time)
 * @param moving   the body is running. A run's feet are not pinned at all: its motion is played
 *                 at the pace of the ground it covers, so its feet keep the floor by themselves,
 *                 while a pin made as a foot comes in to land (still moving forward) is outrun
 *                 within a frame, the more so the slower the display, and the foot is seen to
 *                 catch. Pins are for standing, turning on the spot, and a walk
 */
export function stepFoot(
  state: FootState,
  sample: FootSample,
  dt: number,
  mayStep: boolean,
  moving = false,
): FootState {
  const s = { ...state, rested: state.rested + dt };
  if (moving) {
    // Under way no foot is pinned: whatever hold is left runs out (as it does in the air) and the
    // feet are the motion's own. They are pinned afresh, where they stand, when the body stops.
    const keep = Math.exp(-RELEASE * dt);
    return { ...s, down: false, step: undefined, lift: 0, dx: s.dx * keep, dz: s.dz * keep, dyaw: s.dyaw * keep };
  }
  const toeDown = sample.toeRise < (s.down && s.contact === 'toe' ? UP_M : DOWN_M);
  const ankleDown = sample.ankleRise < (s.down && s.contact === 'ankle' ? UP_M : DOWN_M);
  const contact: 'toe' | 'ankle' | undefined = toeDown ? 'toe' : ankleDown ? 'ankle' : undefined;
  const point = (c: 'toe' | 'ankle') => (c === 'toe' ? sample.toe : sample.ankle);

  if (!contact) {
    // In the air (the motion's own swing): let the correction go, quickly but not at once.
    const keep = Math.exp(-RELEASE * dt);
    return { ...s, down: false, step: undefined, dx: s.dx * keep, dz: s.dz * keep, dyaw: s.dyaw * keep, lift: 0 };
  }
  if (!s.down) {
    // Touching down: pin it where it lands, carrying whatever correction is left (no jump).
    const p = point(contact);
    return {
      ...s,
      down: true,
      contact,
      pinX: p[0] + s.dx,
      pinZ: p[2] + s.dz,
      pinYaw: sample.yaw + s.dyaw,
      step: undefined,
      lift: 0,
    };
  }
  if (contact !== s.contact) {
    // Heel to toe (or back): the pin moves to the new contact, the correction stays as it is.
    const p = point(contact);
    s.contact = contact;
    s.pinX = p[0] + s.dx;
    s.pinZ = p[2] + s.dz;
  }
  const p = point(s.contact);
  if (s.step !== undefined) {
    // Stepping to where the motion wants the foot now (it may still be moving): the correction
    // shrinks to nothing over the step, with a small arc.
    const step = Math.min(1, s.step + dt / STEP_S);
    const left = 1 - ease(step);
    if (step >= 1)
      return {
        ...s,
        step: undefined,
        dx: 0,
        dz: 0,
        dyaw: 0,
        lift: 0,
        pinX: p[0],
        pinZ: p[2],
        pinYaw: sample.yaw,
        rested: 0,
      };
    return {
      ...s,
      step,
      dx: s.fromX * left,
      dz: s.fromZ * left,
      dyaw: s.fromYaw * left,
      lift: Math.sin(Math.PI * step) * STEP_LIFT_M,
    };
  }
  // Pinned: whatever the body does, the contact stays on its spot and the foot keeps its turn.
  s.dx = s.pinX - p[0];
  s.dz = s.pinZ - p[2];
  s.dyaw = wrap(s.pinYaw - sample.yaw);
  if (mayStep && s.rested > 0.08 && (Math.hypot(s.dx, s.dz) > STEP_DRIFT_M || Math.abs(s.dyaw) > STEP_YAW)) {
    s.step = 0;
    s.fromX = s.dx;
    s.fromZ = s.dz;
    s.fromYaw = s.dyaw;
  }
  return s;
}
