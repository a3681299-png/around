import type { BodyMeasure } from '../characters/humanoid';
import { motionUsable, type CharacterMotion, type CharacterSettings } from '../characters/settings';

/**
 * The idle loop a character stands in off its seat: of its usable idle loops, the one whose hips,
 * measured from the file at import (v16 `hipsHeight`), stay closest to its own rest height, i.e.
 * the most upright. A library's idles include crouching ones (a crouch listed first was picked
 * before); the measure tells them apart without reading a name. Motions saved before v16 have no
 * measure and rank after measured ones, in list order (so an old document stands as it did).
 * -1 when there is no idle loop.
 */
export function standingIdle(character: CharacterSettings, body: BodyMeasure | undefined): number {
  let best = -1,
    bestScore = Infinity;
  character.motions.forEach((m, i) => {
    if (m.role !== 'idle' || !m.loop || !(m.source.duration > 0) || !motionUsable(character, i, body)) return;
    const h = m.source.hipsHeight;
    const score = h === undefined ? Number.MAX_VALUE : Math.abs(h / m.source.restHipsHeight - 1);
    if (score < bestScore) [best, bestScore] = [i, score];
  });
  return best;
}

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
