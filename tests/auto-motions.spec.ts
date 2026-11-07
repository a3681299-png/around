import { test, expect } from '@playwright/test';
import { assignBehaviours, classifyMotion, reassignBehaviours } from '../src/characters/auto-motions';
import type { CharacterMotion } from '../src/characters/settings';
import type { VrmAnimationInfo } from '../src/characters/motion-info';

const info = (name: string, duration = 1.5, travel: [number, number, number] = [0, 0, 0]): VrmAnimationInfo => ({
  format: 'vrma',
  name,
  duration,
  bones: ['hips'],
  hipsTranslation: true,
  restHipsHeight: 0.5,
  hipsTravel: travel,
});
const motion = (id: string, duration = 1.5, role: CharacterMotion['role'] = 'idle', loop = true): CharacterMotion => ({
  id,
  assetId: `asset-${'a'.repeat(64)}`,
  role,
  origin: 'character',
  loop,
  source: info(id, duration),
});

test('common library names give the role, the kind and whether the motion loops', () => {
  const cases: [string, string, string, boolean][] = [
    // Quaternius Universal Animation Library
    ['Idle_Loop.vrma', 'idle', 'idle', true],
    ['Idle_Talking_Loop.vrma', 'gesture', 'talk', true],
    ['Walk_Loop.vrma', 'move', 'walk', true],
    ['Walk_Formal_Loop.vrma', 'move', 'walk', true],
    ['Jog_Fwd_Loop.vrma', 'move', 'run', true],
    ['Sprint_Loop.vrma', 'move', 'run', true],
    ['Sitting_Idle_Loop.vrma', 'sit', 'sit', true],
    ['Sitting_Enter.vrma', 'sit', 'sit', false],
    ['Jump_Start.vrma', 'react', 'jump', false],
    ['Hit_Head.vrma', 'react', 'surprise', false],
    ['Dance_Loop.vrma', 'dance', 'happy', true],
    ['Interact.vrma', 'gesture', 'gesture', false],
    // Mixamo's names
    ['Walking.vrma', 'move', 'walk', true],
    ['Slow Run.vrma', 'move', 'run', true],
    ['Sitting Idle.vrma', 'sit', 'sit', true],
    ['Bored.vrma', 'idle', 'idle', true],
    ['Sleeping.vrma', 'sit', 'sleep', true],
  ];
  for (const [name, role, kind, loop] of cases)
    expect(classifyMotion(name, info(name)), name).toMatchObject({ role, kind, loop });
});

test('what the file measures wins over its name; an unknown name is a gesture held back', () => {
  // Named idle, but the hips travel 0.4 m in a second (0.8 hips heights): it walks; 1.2 m runs.
  expect(classifyMotion('Idle.vrma', info('Idle', 1, [0, 0, 0.4]))).toMatchObject({ role: 'move', kind: 'walk' });
  expect(classifyMotion('Idle.vrma', info('Idle', 1, [0, 0, 1.2]))).toMatchObject({ role: 'move', kind: 'run' });
  // One frame: a pose to sit or stand in, whatever its name.
  expect(classifyMotion('Wave.vrma', info('Wave', 0))).toMatchObject({ role: 'sit', kind: 'pose' });
  const unknown = classifyMotion('xyzzy.vrma', info('xyzzy'));
  expect(unknown).toMatchObject({ role: 'gesture', kind: 'gesture' });
  expect(unknown.confidence).toBeLessThan(0.5);
  expect(classifyMotion('Walk_Loop.vrma', info('Walk')).confidence).toBeGreaterThan(0.5);
});

test("the autonomy's behaviours get the best motion of each kind; the author's choices stay", () => {
  const motions = [
    motion('idle-talking-loop'),
    motion('idle-loop', 2.5),
    motion('walk-formal-loop', 1.33, 'move'),
    motion('walk-loop', 1.33, 'move'),
    motion('jog-fwd-loop', 0.93, 'move'),
    motion('sitting-enter', 1.3, 'sit', false),
    motion('sitting-idle-loop', 1.67, 'sit'),
    motion('hit-head', 0.43, 'react', false),
  ];
  // At rest it sits on the edge of its home (chunk 3's corner; the engine seats a sitting role on
  // the edge), so a sitting loop comes first; a standing idle when there is none.
  expect(assignBehaviours(motions, undefined)).toEqual({
    rest: { motion: 'sitting-idle-loop', from: 0, to: 1.67, speed: 1 },
    flee: { motion: 'jog-fwd-loop', from: 0, to: 0.93, speed: 1 },
    approach: { motion: 'walk-loop', from: 0, to: 1.33, speed: 1 },
    return: { motion: 'walk-loop', from: 0, to: 1.33, speed: 1 },
    doze: { motion: 'sitting-idle-loop', from: 0, to: 1.67, speed: 1 },
  });
  expect(
    assignBehaviours(
      motions.filter((m) => m.role !== 'sit'),
      undefined,
    ).rest,
  ).toMatchObject({
    motion: 'idle-loop',
  });
  // Without a run, fleeing walks; the author's own rest is kept as it is.
  const mine = { rest: { motion: 'idle-talking-loop', from: 0.5, to: 1, speed: 2 } };
  expect(
    assignBehaviours(
      motions.filter((m) => m.id !== 'jog-fwd-loop'),
      mine,
    ),
  ).toMatchObject({
    rest: mine.rest,
    flee: { motion: 'walk-loop' },
  });
  // Motions arriving in several reads: the automatic picks follow the whole set; only rows the
  // author changed stay (they differ from what the earlier set would have given).
  const first = motions.filter((m) => ['idle-loop', 'jog-fwd-loop'].includes(m.id));
  const early = assignBehaviours(first, undefined);
  // (No walk yet: going home runs, but approaching is left to the computed motion.)
  expect(early).toMatchObject({ rest: { motion: 'idle-loop' }, return: { motion: 'jog-fwd-loop' } });
  expect(early.approach).toBeUndefined();
  expect(reassignBehaviours(first, motions, early)).toMatchObject({
    rest: { motion: 'sitting-idle-loop' },
    approach: { motion: 'walk-loop' },
  });
  const edited = { ...early, flee: { motion: 'jog-fwd-loop', from: 0, to: 0.5, speed: 2 } };
  expect(reassignBehaviours(first, motions, edited)).toMatchObject({
    rest: { motion: 'sitting-idle-loop' },
    flee: { motion: 'jog-fwd-loop', to: 0.5, speed: 2 },
  });
  // The part ends inside the motion: a length of 1.6667 s gives 1.66, never 1.67.
  expect(assignBehaviours([motion('walk-loop', 1.6667, 'move')], undefined).approach!.to).toBe(1.66);
  // Nothing fits: nothing is assigned (the computed motion plays).
  expect(assignBehaviours([motion('xyzzy', 1.5, 'gesture', false)], undefined)).toEqual({});
});
