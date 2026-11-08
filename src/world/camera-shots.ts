/**
 * From flat to deep (docs/living-room.md, 平らから奥行きへ): the room's camera has a shape per
 * page state — far and telephoto (the room looks like a flat painted background) while the viewer
 * watches at the top, closer and wider (the depth opens) at the comments and in the theater. Pure:
 * the Host says which state the page is in; this blends the shapes over time.
 *
 * The two basic moves are the dolly zoom (moving while changing the field of view, so the room's
 * middle keeps its size and only the depth around it changes) and the lens shift (moving the
 * projection's centre instead of turning the camera, so vertical lines stay vertical). Between
 * shapes the distance to the subject and the field of view are blended on a log scale (the width
 * seen at the subject then changes evenly too), on a smooth curve.
 */

/** A camera shape: metres from camera_main in its own axes (x right, y up, z back), the vertical
 * field of view, the lens shift (fractions of the half frame) and a turn about the room's middle. */
export interface CameraShot {
  x: number;
  y: number;
  z: number;
  fovDeg: number;
  shiftX: number;
  shiftY: number;
  orbitDeg: number;
  /** 0–1: how far the pointer sways this shot (a parallax by lens shift). */
  sway: number;
}
export type ShotName = 'top' | 'comments' | 'theater';
export const SHOT_NAMES: readonly ShotName[] = ['top', 'comments', 'theater'];
export interface CameraShots {
  top: CameraShot;
  comments: CameraShot;
  theater: CameraShot;
  /** Seconds a change of shape takes. */
  transition: number;
}

/** camera_main's distance to the room's middle (the dolly zoom's subject), docs/room-bake-plan.md. */
export const SUBJECT_M = 3.2;
/** camera_main's vertical field of view in the test room (yfov 0.798 rad). */
export const BASE_FOV_DEG = 45.75;

/** The field of view that keeps the subject's size from `z` metres back (the dolly zoom). */
export const dollyFov = (z: number, baseFovDeg = BASE_FOV_DEG, subject = SUBJECT_M) =>
  (2 * Math.atan((subject * Math.tan((baseFovDeg * Math.PI) / 360)) / Math.max(0.1, subject + z)) * 180) / Math.PI;

/**
 * The engine's shapes for the test room (within its measured range: back 1.0 m + dolly 1.5 m,
 * forward 0.3 m). Top: far and narrow (flat). Comments: the depth opens, the view shifted up so the
 * room's floor shows in the page's left column. Theater: opened and turned a little.
 */
export const DEFAULT_SHOTS: CameraShots = Object.freeze({
  top: Object.freeze({ x: 0, y: 0.05, z: 1.5, fovDeg: 30, shiftX: 0, shiftY: 0, orbitDeg: 0, sway: 0.15 }),
  comments: Object.freeze({
    x: -0.15,
    y: -0.05,
    z: -0.25,
    fovDeg: 50,
    shiftX: -0.12,
    shiftY: 0.06,
    orbitDeg: 0,
    sway: 0.6,
  }),
  theater: Object.freeze({ x: 0, y: 0, z: -0.2, fovDeg: 52, shiftX: 0, shiftY: 0.04, orbitDeg: 4, sway: 0.4 }),
  transition: 1.6,
});

export interface ShotState {
  from: CameraShot;
  to: ShotName;
  /** Seconds into the change (≥ transition: arrived). */
  elapsed: number;
}
export const startShots = (shots: CameraShots, at: ShotName): ShotState => ({
  from: shots[at],
  to: at,
  elapsed: Infinity,
});

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Blends on a log scale (both positive). */
const loglerp = (a: number, b: number, t: number) => Math.exp(lerp(Math.log(a), Math.log(b), t));

export function blendShots(a: CameraShot, b: CameraShot, t: number, subject = SUBJECT_M): CameraShot {
  // The distance to the subject and the tangent of the half view, on a log scale: the width seen
  // at the subject, their product, then also changes evenly.
  const distance = loglerp(subject + a.z, subject + b.z, t);
  const tan = loglerp(Math.tan((a.fovDeg * Math.PI) / 360), Math.tan((b.fovDeg * Math.PI) / 360), t);
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: distance - subject,
    fovDeg: (2 * Math.atan(tan) * 180) / Math.PI,
    shiftX: lerp(a.shiftX, b.shiftX, t),
    shiftY: lerp(a.shiftY, b.shiftY, t),
    orbitDeg: lerp(a.orbitDeg, b.orbitDeg, t),
    sway: lerp(a.sway, b.sway, t),
  };
}

/** The shape now, and, with reduced motion, how far the room is dimmed for the cut (0–1). */
export function currentShot(
  state: ShotState,
  shots: CameraShots,
  reducedMotion: boolean,
): { shot: CameraShot; dip: number } {
  const duration = reducedMotion ? 0.5 : Math.max(0.05, shots.transition);
  const t = Math.min(1, Math.max(0, state.elapsed / duration));
  if (t >= 1) return { shot: shots[state.to], dip: 0 };
  if (reducedMotion)
    // No movement: the room dims, the shape is swapped at the darkest moment, and it comes back.
    return { shot: t < 0.5 ? state.from : shots[state.to], dip: 1 - Math.abs(t * 2 - 1) };
  return { shot: blendShots(state.from, shots[state.to], smooth(t)), dip: 0 };
}

export function stepShots(
  state: ShotState,
  shots: CameraShots,
  want: ShotName,
  dt: number,
  reducedMotion: boolean,
): ShotState {
  const elapsed = state.elapsed + Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
  if (want === state.to) return elapsed === state.elapsed ? state : { ...state, elapsed };
  // A new change starts from wherever the camera is now (an interrupted change does not jump).
  return { from: currentShot({ ...state, elapsed }, shots, reducedMotion).shot, to: want, elapsed: 0 };
}
export const shotSettled = (state: ShotState, shots: CameraShots, reducedMotion: boolean) =>
  state.elapsed >= (reducedMotion ? 0.5 : shots.transition);

/**
 * Which shape the page asks for: the theater, the comments (scrolled down, with hysteresis so a
 * small scroll at the boundary does not flip the room), or the top.
 */
export function wantedShot(previous: ShotName, theater: boolean, scrollScreens: number): ShotName {
  if (theater) return scrollScreens > 0.6 ? 'comments' : 'theater';
  if (previous === 'comments') return scrollScreens < 0.35 ? 'top' : 'comments';
  return scrollScreens > 0.55 ? 'comments' : 'top';
}

/** How flat the shape looks, 0 (camera_main's own depth) to 1 (the top's telephoto): the room may
 * then change unseen. */
export const flatness = (shot: CameraShot, top: CameraShot) =>
  top.z <= 0 ? 0 : Math.min(1, Math.max(0, shot.z / top.z));

/**
 * The camera for a shape and the pointer's parallax: the pointer moves the camera sideways and
 * the lens shifts back so the subject plane stays put (an off-axis view: near things move, the
 * room's middle does not, nothing turns). Returns the offset (metres) and the lens shift.
 */
export function shotCamera(
  shot: CameraShot,
  pointer: { x: number; y: number } | undefined,
  subject = SUBJECT_M,
): { x: number; y: number; z: number; fovDeg: number; shiftX: number; shiftY: number; orbitDeg: number } {
  const px = pointer ? Math.max(-1, Math.min(1, pointer.x)) : 0,
    py = pointer ? Math.max(-1, Math.min(1, pointer.y)) : 0;
  const reach = 0.2 * Math.max(0, Math.min(1, shot.sway));
  const dx = px * reach,
    dy = -py * reach * 0.5;
  const distance = Math.max(0.1, subject + shot.z);
  const halfH = distance * Math.tan((shot.fovDeg * Math.PI) / 360);
  return {
    x: shot.x + dx,
    y: shot.y + dy,
    z: shot.z,
    fovDeg: shot.fovDeg,
    // Moved right by dx, the subject would slide left by dx: shift the frame by the same amount
    // (as fractions of the half frame; the horizontal half is the vertical times the aspect, which
    // the renderer applies).
    shiftX: shot.shiftX - dx / halfH,
    shiftY: shot.shiftY - dy / halfH,
    orbitDeg: shot.orbitDeg,
  };
}
