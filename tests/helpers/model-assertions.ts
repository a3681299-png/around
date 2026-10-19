import { expect } from '@playwright/test';
import type { ModelEvaluation } from '../../src/world/models';
/** Node and Chrome can differ by ~1 ulp in transcendental Math functions. */
export function modelPoseError(actual: ModelEvaluation, expected: ModelEvaluation) {
  let error = 0;
  for (const key of Object.keys(expected) as (keyof ModelEvaluation)[]) {
    const a = actual[key], b = expected[key];
    if (typeof a === 'number' && typeof b === 'number') error = Math.max(error, Math.abs(a - b)); else expect(a).toEqual(b);
  }
  return error;
}
