import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { BODY_THRESHOLDS, classifyBody, measureBody, type BodyInput } from '../src/characters/humanoid';
import { vrmBodyFacts } from '../src/characters/vrm-body';
import { inspectGlb } from '../src/assets/glb';
import { vrmFixture } from './helpers/vrm-fixture';

const v = (x: number, y: number, z = 0): [number, number, number] => [x, y, z];
/** A plain adult rig: 6 heads tall, long legs (numbers chosen by hand, not from any model). */
function adult(): BodyInput {
  return {
    floor: 0,
    crown: 1.8,
    bones: {
      hips: v(0, 1),
      spine: v(0, 1.1),
      neck: v(0, 1.5),
      head: v(0, 1.55),
      leftUpperLeg: v(0.1, 0.95),
      leftLowerLeg: v(0.1, 0.5),
      leftFoot: v(0.1, 0.08),
      rightUpperLeg: v(-0.1, 0.95),
      rightLowerLeg: v(-0.1, 0.5),
      rightFoot: v(-0.1, 0.08),
      leftUpperArm: v(0.18, 1.45),
      leftLowerArm: v(0.46, 1.45),
      leftHand: v(0.71, 1.45),
      rightUpperArm: v(-0.18, 1.45),
      rightLowerArm: v(-0.46, 1.45),
      rightHand: v(-0.71, 1.45),
    },
  };
}

test('body measure: height to the crown, head from neck, limb lengths and ratios', () => {
  const m = measureBody(adult())!;
  expect(m.height).toBeCloseTo(1.8, 6);
  expect(m.headLength).toBeCloseTo(0.3, 6);
  expect(m.headsTall).toBeCloseTo(6, 6);
  expect(m.legLength).toBeCloseTo(0.45 + 0.42, 6);
  expect(m.legRatio).toBeCloseTo(0.87 / 1.8, 6);
  expect(m.armLength).toBeCloseTo(0.28 + 0.25, 6);
  expect(m.hipsRatio).toBeCloseTo(1 / 1.8, 6);
  expect(m.shoulderWidth).toBeCloseTo(0.36, 6);
  expect(classifyBody(m)).toEqual({ stage: 2, reasons: [] });
});

test('body measure: the floor is subtracted and a missing neck falls back to the head bone', () => {
  const input = adult();
  delete input.bones.neck;
  const lifted: BodyInput = {
    floor: 2,
    crown: input.crown + 2,
    bones: Object.fromEntries(
      Object.entries(input.bones).map(([k, p]) => [k, v(p![0], p![1] + 2, p![2])]),
    ) as BodyInput['bones'],
  };
  const m = measureBody(lifted)!;
  expect(m.height).toBeCloseTo(1.8, 6);
  expect(m.headLength).toBeCloseTo(0.25, 6);
});

test('body measure: required bones missing or a degenerate size gives no measure', () => {
  for (const bone of ['hips', 'head', 'leftUpperLeg', 'leftFoot', 'rightHand'] as const) {
    const input = adult();
    delete input.bones[bone];
    expect(measureBody(input), bone).toBeUndefined();
  }
  expect(measureBody({ ...adult(), crown: 0 })).toBeUndefined(); // below the hips
  expect(measureBody({ ...adult(), crown: 1.5 })).toBeUndefined(); // crown at the neck
  expect(measureBody({ ...adult(), crown: Number.NaN })).toBeUndefined();
  const bad = adult();
  bad.bones.hips = v(0, Number.POSITIVE_INFINITY);
  expect(measureBody(bad)).toBeUndefined();
});

test('stage: each threshold alone switches to stage 1, exactly at the threshold stays stage 2', () => {
  const base = measureBody(adult())!;
  const at = { ...base, headsTall: BODY_THRESHOLDS.headsTall, legRatio: BODY_THRESHOLDS.legRatio };
  expect(classifyBody({ ...at, hipsRatio: BODY_THRESHOLDS.hipsRatio }).stage).toBe(2);
  expect(classifyBody({ ...base, headsTall: 3.99 })).toEqual({ stage: 1, reasons: ['head'] });
  expect(classifyBody({ ...base, legRatio: 0.41 })).toEqual({ stage: 1, reasons: ['legs'] });
  expect(classifyBody({ ...base, hipsRatio: 0.47 })).toEqual({ stage: 1, reasons: ['hips'] });
  expect(classifyBody({ ...base, headsTall: 3, legRatio: 0.37, hipsRatio: 0.43 }).reasons).toEqual([
    'head',
    'legs',
    'hips',
  ]);
});

test('VRM facts: rest bone positions and the crown come from head-weighted skinned vertices', () => {
  const { json, bin } = inspectGlb(vrmFixture());
  const facts = vrmBodyFacts(json, bin)!;
  // Test rig: hips at 0, spine +0.1, head +0.25 above the spine; the box's top four vertices
  // are weighted to the head joint whose bind matrix assumed head at 0.25 (so +0.1 at rest).
  expect(facts.bones.hips![1]).toBeCloseTo(0, 6);
  expect(facts.bones.head![1]).toBeCloseTo(0.35, 6);
  // Each fixture bone's translation is relative to its parent: hips → upper leg (0.15, -0.1)
  // → lower leg (0, -0.15) → foot (0, -0.1, 0.05).
  expect(facts.bones.leftFoot).toEqual([expect.closeTo(0.15, 6), expect.closeTo(-0.35, 6), expect.closeTo(0.05, 6)]);
  expect(facts.crown).toBeCloseTo(0.6, 6);
  expect(facts.floor).toBeCloseTo(-0.5, 6);
  const m = measureBody(facts)!;
  expect(m.height).toBeCloseTo(1.1, 6);
  expect(m.headLength).toBeCloseTo(0.25, 6); // no neck bone: measured from the head bone
});

test('VRM facts: vertices weighted to non-humanoid children of the head do not raise the crown', () => {
  // Re-weight the top vertices to the Antenna (a non-humanoid child of the head): no
  // head-weighted vertex is left, so there is no crown and no measure.
  const bytes = vrmFixture((j) => {
    const antenna = j.nodes.findIndex((n: { name?: string }) => n.name === 'Antenna');
    j.skins[0].joints[1] = antenna;
  });
  const { json, bin } = inspectGlb(bytes);
  const facts = vrmBodyFacts(json, bin)!;
  expect(facts.crown).toBeNaN();
  expect(measureBody(facts)).toBeUndefined();
});

test('VRM facts: a GLB without VRMC_vrm humanoid gives none', () => {
  const { json, bin } = inspectGlb(vrmFixture());
  const { VRMC_vrm: _, ...others } = json.extensions;
  expect(vrmBodyFacts({ ...json, extensions: others }, bin)).toBeUndefined();
});

// Local only: the private model files are never in the repository or CI.
for (const [name, variable, heads, stage] of [
  ['trusie', 'WW_VRM_FILE', 3.0, 1],
  ['base body', 'WW_VRM_COMPARE_FILE', 5.89, 2],
] as const)
  test(`local ${name}: head-weighted measure and stage`, () => {
    const file = process.env[variable];
    // WW_VRM_FILE may name another private model; these numbers belong to the named files only.
    const expected = name === 'trusie' ? 'trusie.vrm' : 'lp_basebody.vrm';
    test.skip(!file || !fs.existsSync(file) || !file.endsWith(expected), `${variable} is not ${expected}`);
    const { json, bin } = inspectGlb(new Uint8Array(fs.readFileSync(file!)));
    const m = measureBody(vrmBodyFacts(json, bin)!)!;
    expect(m.headsTall).toBeCloseTo(heads, 1);
    expect(classifyBody(m).stage).toBe(stage);
  });
