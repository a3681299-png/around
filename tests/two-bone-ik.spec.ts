import { test, expect } from '@playwright/test';
import { solveTwoBone, type Vec3 } from '../src/characters/two-bone-ik';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// A leg standing straight: hip at 0.55 m, knee at 0.3, foot at 0.05; forward is +Z.
const hip: Vec3 = [0.07, 0.55, 0],
  knee: Vec3 = [0.07, 0.3, 0.001],
  foot: Vec3 = [0.07, 0.05, 0];
const forward: Vec3 = [0, 0, 1];

test('a reachable target is reached, the bones keep their lengths, the knee bends forward', () => {
  const target: Vec3 = [0.07, 0.15, 0.05];
  const s = solveTwoBone(hip, knee, foot, target, forward);
  expect(s.reached).toBe(true);
  expect(distance(s.end, target)).toBeLessThan(1e-6);
  expect(distance(hip, s.mid)).toBeCloseTo(distance(hip, knee), 6);
  expect(distance(s.mid, s.end)).toBeCloseTo(distance(knee, foot), 6);
  expect(s.mid[2]).toBeGreaterThan(0.05);
});

test('the hips dipping with the feet planted bends the knees (the crouch of a hop)', () => {
  const dip = 0.05;
  const s = solveTwoBone(
    [hip[0], hip[1] - dip, hip[2]],
    [knee[0], knee[1] - dip, knee[2]],
    [foot[0], foot[1] - dip, foot[2]],
    foot,
    forward,
  );
  expect(s.reached).toBe(true);
  expect(distance(s.end, foot)).toBeLessThan(1e-6);
  expect(s.mid[2]).toBeGreaterThan(0.05);
});

test('out of reach: the chain straightens toward the target without stretching', () => {
  const target: Vec3 = [0.07, -1, 0];
  const s = solveTwoBone(hip, knee, foot, target, forward);
  expect(s.reached).toBe(false);
  expect(distance(hip, s.end)).toBeCloseTo(0.5, 4);
  expect(s.end[1]).toBeLessThan(hip[1]);
});

test('too close: the chain folds no further than its bones allow; uneven bones too', () => {
  const s = solveTwoBone(hip, knee, foot, hip, forward);
  expect(s.reached).toBe(false);
  expect(Number.isFinite(s.mid[0] + s.mid[1] + s.mid[2] + s.end[0] + s.end[1] + s.end[2])).toBe(true);
  const uneven = solveTwoBone([0, 0, 0], [0, -0.3, 0], [0, -0.4, 0], [0, -0.1, 0], forward);
  expect(distance([0, 0, 0], uneven.end)).toBeGreaterThanOrEqual(0.2 - 1e-5);
});

test('a perfectly straight chain with the pole along the reach still bends, deterministically', () => {
  const straightKnee: Vec3 = [0, -0.25, 0],
    straightFoot: Vec3 = [0, -0.5, 0];
  const a = solveTwoBone([0, 0, 0], straightKnee, straightFoot, [0, -0.4, 0], [0, -1, 0]);
  const b = solveTwoBone([0, 0, 0], straightKnee, straightFoot, [0, -0.4, 0], [0, -1, 0]);
  expect(a).toEqual(b);
  expect(distance(a.end, [0, -0.4, 0])).toBeLessThan(1e-6);
  expect(Math.hypot(a.mid[0], a.mid[2])).toBeGreaterThan(0.1);
});
