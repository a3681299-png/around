import { test, expect } from '@playwright/test';
import { GAIT, gaitSpeedPx, matchGait, standingIdle } from '../src/world/gait';
import type { BodyMeasure } from '../src/characters/humanoid';
import type { CharacterMotion, CharacterSettings } from '../src/characters/settings';

const body = { height: 1.05, hipsHeight: 0.466 } as BodyMeasure;
const walk = (travel: number, role: CharacterMotion['role'] = 'move'): CharacterMotion => ({
  id: 'walk',
  assetId: `asset-${'a'.repeat(64)}`,
  role,
  origin: 'character',
  loop: true,
  source: {
    format: 'vrma',
    name: 'walk',
    duration: 1.333,
    bones: ['hips'],
    hipsTranslation: true,
    restHipsHeight: 0.466,
    hipsTravel: [0, 0, travel],
  },
});

test("a walk's feet keep its hips' travel per second, drawn at the body's scale in the box", () => {
  // 0.72 m in 1.333 s on a 0.466 m hips: 1.16 hips heights a second. Drawn 190 px tall, the
  // model's 1.05 m is 190 / 1.5 px, its hips 56.2 px: 65 px a second.
  expect(gaitSpeedPx(walk(0.72), body, 190)).toBeCloseTo((0.72 / 1.333 / 0.466) * ((190 * 0.466) / (1.5 * 1.05)), 6);
  expect(gaitSpeedPx(walk(0.72), body, 380)).toBeCloseTo(2 * gaitSpeedPx(walk(0.72), body, 190)!, 6);
  // An in-place file, a motion that does not move, an unmeasured body: no gait.
  expect(gaitSpeedPx(walk(0), body, 190)).toBeUndefined();
  expect(gaitSpeedPx(walk(0.72, 'idle'), body, 190)).toBeUndefined();
  expect(gaitSpeedPx(walk(0.72), undefined, 190)).toBeUndefined();
});

test('the motion plays at the rate that matches the speed; past its range, the speed gives way', () => {
  expect(matchGait(70, 65)).toEqual({ rate: 70 / 65, speedPx: 70 });
  // 420 px/s with a 65 px/s walk: the walk at its fastest, the character slower.
  expect(matchGait(420, 65)).toEqual({ rate: GAIT.maxRate, speedPx: 65 * GAIT.maxRate });
  expect(matchGait(10, 65)).toEqual({ rate: GAIT.minRate, speedPx: 65 * GAIT.minRate });
});

/** Standing idles: the idle loops told apart by the hips height measured from each file (v16). */
const idle = (id: string, hipsHeight?: number, extra: Partial<CharacterMotion> = {}): CharacterMotion => {
  const m = walk(0, 'idle');
  return {
    ...m,
    id,
    ...extra,
    source: { ...m.source, ...(hipsHeight === undefined ? {} : { hipsHeight }) },
  };
};
const settings = (motions: CharacterMotion[]): CharacterSettings => ({ standardMotions: 'auto', motions });

test('it stands in the idle whose measured hips are closest to standing, whatever its name or place', () => {
  // A crouching idle listed first (its hips at 60% of its rest height) and a standing one.
  const crouch = idle('crouch-idle-loop', 0.28),
    stand = idle('idle-loop', 0.45);
  expect(standingIdle(settings([crouch, stand]), body)).toBe(1);
  expect(standingIdle(settings([stand, crouch]), body)).toBe(0);
  // Names never decide: the same files under swapped names pick the same file.
  expect(
    standingIdle(
      settings([
        { ...crouch, id: 'idle-loop' },
        { ...stand, id: 'crouch' },
      ]),
      body,
    ),
  ).toBe(1);
  // Hips raised above the rest height are as far from standing as lowered ones.
  expect(standingIdle(settings([idle('tiptoe', 0.466 * 1.3), idle('slouch', 0.466 * 0.9)]), body)).toBe(1);
});

test('only usable idle loops stand; motions saved before the measure fall back to the list order', () => {
  // Not a loop, not an idle, a pose of length 0: never the standing idle.
  const once = idle('once', 0.466, { loop: false }),
    move = idle('move', 0.466, { role: 'move' }),
    pose = { ...idle('pose', 0.466), source: { ...idle('pose', 0.466).source, duration: 0 } },
    low = idle('low', 0.2);
  expect(standingIdle(settings([once, move, pose, low]), body)).toBe(3);
  expect(standingIdle(settings([once, move, pose]), body)).toBe(-1);
  // v15 motions carry no hips height: the first idle loop, as before.
  expect(standingIdle(settings([idle('a'), idle('b')]), body)).toBe(0);
  // A measured one ranks before an unmeasured one (its height is known).
  expect(standingIdle(settings([idle('old'), idle('new', 0.3)]), body)).toBe(1);
});
