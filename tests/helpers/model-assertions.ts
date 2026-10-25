import { isDeepStrictEqual } from 'node:util';
import type { ModelEvaluation } from '../../src/world/models';
/**
 * Largest numeric difference; any non-numeric mismatch is Infinity. Returning instead of
 * asserting keeps it usable inside expect.poll, where a thrown expect fails at once instead of
 * retrying while the preview is still applying a seek.
 * Node and Chrome can differ by ~1 ulp in transcendental Math functions.
 */
export function modelPoseError(actual: ModelEvaluation, expected: ModelEvaluation) {
  let error = 0;
  for (const key of Object.keys(expected) as (keyof ModelEvaluation)[]) {
    const a = actual[key],
      b = expected[key];
    if (typeof a === 'number' && typeof b === 'number') error = Math.max(error, Math.abs(a - b));
    else if (!isDeepStrictEqual(a, b)) return Infinity;
  }
  return error;
}
