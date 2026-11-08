import { test, expect } from '@playwright/test';
import {
  DEFAULT_SHOTS,
  SUBJECT_M,
  blendShots,
  currentShot,
  dollyFov,
  flatness,
  shotCamera,
  shotSettled,
  startShots,
  stepShots,
  wantedShot,
} from '../src/world/camera-shots';

/** From flat to deep (docs/living-room.md): camera shapes per page state, blended over time. */
const width = (z: number, fov: number) => 2 * (SUBJECT_M + z) * Math.tan((fov * Math.PI) / 360);

test('the dolly zoom keeps the subject width: farther back, a narrower view', () => {
  const near = width(0, dollyFov(0)),
    far = width(1.5, dollyFov(1.5));
  expect(far).toBeCloseTo(near, 6);
  expect(dollyFov(1.5)).toBeLessThan(dollyFov(0));
});

test('blending: distance and view on a log scale, so the width seen at the subject changes evenly', () => {
  const a = { ...DEFAULT_SHOTS.top },
    b = { ...DEFAULT_SHOTS.comments };
  const w = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const s = blendShots(a, b, t);
    return Math.log(width(s.z, s.fovDeg));
  });
  for (let i = 1; i < w.length - 1; i++) expect(w[i]! - w[i - 1]!).toBeCloseTo(w[i + 1]! - w[i]!, 6);
  expect(blendShots(a, b, 0)).toMatchObject({ z: a.z, x: a.x });
  expect(blendShots(a, b, 1).fovDeg).toBeCloseTo(b.fovDeg, 6);
});

test('a change takes the transition on a smooth curve and is settled after it; interrupted, it does not jump', () => {
  let s = startShots(DEFAULT_SHOTS, 'top');
  expect(currentShot(s, DEFAULT_SHOTS, false).shot).toEqual(DEFAULT_SHOTS.top);
  s = stepShots(s, DEFAULT_SHOTS, 'comments', 0.016, false);
  expect(s.elapsed).toBe(0);
  const zs: number[] = [];
  for (let i = 0; i < 120; i++) {
    s = stepShots(s, DEFAULT_SHOTS, 'comments', 1 / 60, false);
    zs.push(currentShot(s, DEFAULT_SHOTS, false).shot.z);
  }
  // Monotone, gentle at both ends.
  for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeLessThanOrEqual(zs[i - 1]! + 1e-9);
  expect(Math.abs(zs[1]! - zs[0]!)).toBeLessThan(Math.abs(zs[50]! - zs[49]!));
  expect(shotSettled(s, DEFAULT_SHOTS, false)).toBe(true);
  expect(currentShot(s, DEFAULT_SHOTS, false).shot.z).toBeCloseTo(DEFAULT_SHOTS.comments.z, 6);
  // Interrupted halfway back: the next change starts from where the camera was.
  for (let i = 0; i < 40; i++) s = stepShots(s, DEFAULT_SHOTS, 'top', 1 / 60, false);
  const before = currentShot(s, DEFAULT_SHOTS, false).shot;
  s = stepShots(s, DEFAULT_SHOTS, 'theater', 1 / 60, false);
  // (One frame's worth of the old change at its fastest, at most.)
  expect(Math.abs(currentShot(s, DEFAULT_SHOTS, false).shot.z - before.z)).toBeLessThan(0.05);
});

test('reduced motion: no movement, the room dims and the shape is swapped at the darkest moment', () => {
  let s = stepShots(startShots(DEFAULT_SHOTS, 'top'), DEFAULT_SHOTS, 'theater', 0, true);
  const seen: { z: number; dip: number }[] = [];
  for (let i = 0; i < 40; i++) {
    s = stepShots(s, DEFAULT_SHOTS, 'theater', 1 / 60, true);
    const c = currentShot(s, DEFAULT_SHOTS, true);
    seen.push({ z: c.shot.z, dip: c.dip });
  }
  expect(new Set(seen.map((x) => x.z)).size).toBe(2);
  const swap = seen.findIndex((x) => x.z === DEFAULT_SHOTS.theater.z);
  expect(seen[swap]!.dip).toBeGreaterThan(0.9);
  expect(seen.at(-1)!.dip).toBe(0);
});

test('which shape: theater, comments with hysteresis, top', () => {
  expect(wantedShot('top', true, 0)).toBe('theater');
  expect(wantedShot('top', false, 0.5)).toBe('top');
  expect(wantedShot('top', false, 0.6)).toBe('comments');
  expect(wantedShot('comments', false, 0.4)).toBe('comments');
  expect(wantedShot('comments', false, 0.3)).toBe('top');
  expect(flatness(DEFAULT_SHOTS.top, DEFAULT_SHOTS.top)).toBe(1);
  expect(flatness(DEFAULT_SHOTS.comments, DEFAULT_SHOTS.top)).toBe(0);
});

test('the pointer parallax moves the camera and shifts the lens back: the subject plane stays put', () => {
  const shot = DEFAULT_SHOTS.comments;
  const still = shotCamera(shot, undefined),
    moved = shotCamera(shot, { x: 1, y: 0 });
  expect(moved.x).toBeGreaterThan(still.x);
  // The subject's centre on screen (in half frames): the camera's move over the half height at the
  // subject, plus the shift. It stays where it was.
  const halfH = (SUBJECT_M + shot.z) * Math.tan((shot.fovDeg * Math.PI) / 360);
  const centre = (c: typeof still) => -(c.x - shot.x) / halfH - c.shiftX;
  expect(centre(moved)).toBeCloseTo(centre(still), 9);
  expect(moved.fovDeg).toBe(still.fovDeg);
});
