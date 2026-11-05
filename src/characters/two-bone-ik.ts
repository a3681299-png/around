/**
 * Two-bone IK (a leg: hip → knee → foot, or an arm), solved analytically on plain numbers. No
 * three.js, no state: the renderer turns the returned joint positions into bone rotations.
 *
 * Edge cases, all bounded: a target out of reach straightens the chain toward it (the bones keep
 * their lengths); one too close folds it no further than |upper − lower|; a chain with no bend
 * (straight, or the pole along the reach) bends toward the pole hint.
 */
export type Vec3 = readonly [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};

export interface TwoBoneSolution {
  /** The new middle joint (knee/elbow) and end (foot/hand) positions; the root does not move. */
  mid: Vec3;
  end: Vec3;
  /** Whether the end reaches the target (false: out of reach or too close, clamped). */
  reached: boolean;
}

/**
 * @param root, mid, end  the chain's joints now (their distances are the bone lengths)
 * @param target          where the end should go
 * @param pole            a direction the middle joint should bend toward (for a leg: forward)
 */
export function solveTwoBone(root: Vec3, mid: Vec3, end: Vec3, target: Vec3, pole: Vec3): TwoBoneSolution {
  const upper = length(sub(mid, root)),
    lower = length(sub(end, mid));
  const reach = sub(target, root),
    wanted = length(reach);
  const min = Math.abs(upper - lower) + 1e-6,
    max = upper + lower - 1e-6;
  const distance = Math.min(max, Math.max(min, wanted));
  const axis = wanted > 1e-9 ? scale(reach, 1 / wanted) : normalize(sub(end, root));
  // The bend direction: the pole hint (a knee bends forward whatever the pose), else the current
  // middle joint's side of the reach line.
  const fromLine = (p: Vec3) => {
    const v = sub(p, root);
    return sub(v, scale(axis, dot(v, axis)));
  };
  let bend = normalize(sub(pole, scale(axis, dot(pole, axis))));
  if (length(bend) < 0.5) bend = normalize(fromLine(mid));
  if (length(bend) < 0.5) {
    // The pole lies along the reach: any perpendicular will do, deterministically.
    const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    bend = normalize(sub(helper, scale(axis, dot(helper, axis))));
  }
  // Law of cosines: how far along the reach the knee sits, and how far out.
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance),
    out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const newMid = addScaled(addScaled(root, axis, along), bend, out),
    newEnd = addScaled(root, axis, distance);
  return { mid: newMid, end: newEnd, reached: wanted >= min && wanted <= max };
}
