import type { BodyMeasure } from '../characters/humanoid';
import type { CharacterMotion } from '../characters/settings';

/**
 * Feet that do not slide (docs/characters/mirdo.md): a walk or a run moves its hips forward at
 * the speed its feet keep. When the autonomy moves the character with such a motion, the motion
 * plays faster or slower so its feet keep the character's speed; where that would be extreme, the
 * character's speed moves toward the motion's instead. Everything comes from the motion file (the
 * hips' travel measured at import) and the body measure: no value is tuned to one character.
 */
export const GAIT = Object.freeze({
  /** The playback rates a walk or a run still looks like itself at. */
  minRate: 0.7,
  maxRate: 1.5,
  /** The box is 1.5 times the model's largest extent (src/renderers/three/models.ts camera). */
  boxPerModel: 1.5,
});

/**
 * The px per second a motion's feet keep on this body drawn `heightPx` tall, or undefined when
 * the motion does not travel (an in-place file, a pose) or the body is not measured. The motion's
 * hips travel in its own rest hips heights; the body's hips are drawn at hipsHeight of its
 * height, and its height is the model's largest extent for a standing body.
 */
export function gaitSpeedPx(
  motion: CharacterMotion | undefined,
  body: BodyMeasure | undefined,
  heightPx: number,
): number | undefined {
  if (!motion || motion.role !== 'move' || !body) return undefined;
  const { hipsTravel, duration, restHipsHeight } = motion.source;
  const travel = Math.hypot(hipsTravel[0], hipsTravel[2]);
  if (!(duration > 0) || !(restHipsHeight > 0) || !(travel > 0)) return undefined;
  const hipsPx = (heightPx * body.hipsHeight) / (GAIT.boxPerModel * body.height);
  return (travel / duration / restHipsHeight) * hipsPx;
}

/** The playback rate and the character's speed (px/s) for a requested speed and a gait. */
export function matchGait(requestedPx: number, naturalPx: number): { rate: number; speedPx: number } {
  const rate = Math.min(GAIT.maxRate, Math.max(GAIT.minRate, requestedPx / naturalPx));
  return { rate, speedPx: naturalPx * rate };
}
