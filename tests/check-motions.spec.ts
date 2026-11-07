import { test, expect } from '@playwright/test';
// @ts-expect-error The script is plain ESM without types.
import { judge, LINES } from '../scripts/characters/check-motions.mjs';

type Row = {
  t: number;
  inside: { left: number; right: number };
  sole: { left: number; right: number };
  ankle: { left: number[]; right: number[] };
  foot: { left: number[][]; right: number[][] };
  hips: number;
};
const H = 1;
/** A frame: each foot one sole vertex at (x, y, z), and the hips' height. */
const row = (t: number, left: number[], right: number[], hips = 0.5, inside = 0): Row => ({
  t,
  inside: { left: inside, right: 0 },
  sole: { left: left[1]!, right: right[1]! },
  ankle: { left: [left[0]!, left[2]!], right: [right[0]!, right[2]!] },
  foot: { left: [left], right: [right] },
  hips,
});
const frames = (n: number, make: (i: number, t: number) => Row) => Array.from({ length: n }, (_, i) => make(i, i / 30));

test('standing still on the floor passes; each break is named by what a person would see', () => {
  const still = frames(31, (_, t) => row(t, [-0.1, 0, 0], [0.1, 0, 0]));
  expect(judge(still, H)).toMatchObject({ pass: true, reasons: [] });
  // Hand inside the body in every frame.
  expect(
    judge(
      frames(31, (_, t) => row(t, [-0.1, 0, 0], [0.1, 0, 0], 0.5, 5)),
      H,
    ).reasons,
  ).toEqual(['hand-in-body']);
  // Both feet 5% of the height above the floor all the time.
  expect(
    judge(
      frames(31, (_, t) => row(t, [-0.1, 0.05, 0], [0.1, 0.05, 0])),
      H,
    ).reasons,
  ).toEqual(['floating']);
  // Feet under the floor.
  expect(
    judge(
      frames(31, (_, t) => row(t, [-0.1, -0.05, 0], [0.1, -0.05, 0])),
      H,
    ).reasons,
  ).toEqual(['sinking']);
  // Planted feet drifting sideways at 0.2 heights per second.
  expect(
    judge(
      frames(31, (_, t) => row(t, [-0.1 + 0.2 * t, 0, 0], [0.1 + 0.2 * t, 0, 0])),
      H,
    ).reasons,
  ).toEqual(['sliding']);
});

test('an in-place run may leave the floor and its planted foot goes back at the speed it keeps', () => {
  // The planted foot goes backwards at 1 m/s; half the frames both feet are up (a run's flight).
  const run = frames(31, (i, t) =>
    i % 2 ? row(t, [-0.1, 0.06, 0], [0.1, 0.06, 0]) : row(t, [-0.1, 0, -1 * t], [0.1, 0.06, 0]),
  );
  // Neighbouring planted frames are needed to measure a foot: plant the left foot in pairs.
  const paired = frames(40, (i, t) =>
    i % 4 < 2 ? row(t, [-0.1, 0, -1 * t], [0.1, 0.06, 0]) : row(t, [-0.1, 0.06, 0], [0.1, 0.06, 0]),
  );
  expect(judge(paired, H, 0.9)).toMatchObject({ pass: true, feetSpeedMps: 1 });
  expect(judge(run, H, 0.9).reasons).not.toContain('floating');
  // A run that never comes down floats.
  expect(
    judge(
      frames(31, (_, t) => row(t, [-0.1, 0.06, -t], [0.1, 0.06, 0])),
      H,
      0.9,
    ).reasons,
  ).toContain('floating');
  expect(LINES.slideShare).toBeGreaterThan(0);
});
