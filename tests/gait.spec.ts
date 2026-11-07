import { test, expect } from '@playwright/test';
import { GAIT, gaitSpeedPx, matchGait } from '../src/world/gait';
import type { BodyMeasure } from '../src/characters/humanoid';
import type { CharacterMotion } from '../src/characters/settings';

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
