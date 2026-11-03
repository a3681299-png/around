import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as current from '../../src/world/operations';
import * as reference from '../g12v-preindex/src/world/operations';
import { inspectAsset } from '../../src/assets/inspect';
import { modelFixture } from '../../tests/helpers/model-fixture';
import { defaultModelSettings } from '../../src/models/types';
import { defaultFollowMotion } from '../../src/signals/motion';
import { defaultScrollOpacityRule } from '../../src/signals/keyframes';
import * as newTakes from '../../src/world/takes';
import * as oldTakes from '../g12-557/src/world/takes';
const surface = (patch: any = {}) => ({
  id: 's',
  owner: 'native',
  generation: { documentId: 1, geometry: 1 },
  kind: 'click',
  shape: { left: 100, top: 100, width: 20, height: 20 },
  protectedEnvelope: { left: 100, top: 100, width: 20, height: 20 },
  availability: {
    present: true,
    visible: true,
    disabled: false,
    focused: false,
    editing: false,
    dragging: false,
    captured: false,
  },
  policy: {
    transform: 'fixed-plane',
    occlusion: 'forbid',
    input: 'native-only',
  },
  compositionCapability: 'exclusion',
  scrolls: false,
  ...patch,
});
const snapshot = (surfaces: any[]) => ({
  generation: { documentId: 1, geometry: 1 },
  viewport: { width: 1920, height: 1080 },
  supported: true,
  surfaces,
});

const plain = (state: any) => ({
  near: [...state.near].sort(([a], [b]) => a.localeCompare(b)),
  held: [...state.held].map(([r, s]) => [r, [...s].sort()]).sort(([a], [b]) => a.localeCompare(b)),
});
test('boundary and stateful differential checks against the actual pre-index full scan', () => {
  let seed = 671203,
    cases = 0;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const bands = [-8192, -256, -128, 0, 128, 256, 8192];
  const deltas = [
    -72.000001, -72, -71.999999, -40.000001, -40, -39.999999, -0.000001, 0, 0.000001, 39.999999, 40, 40.000001,
    71.999999, 72, 72.000001,
  ];
  for (const band of bands)
    for (const offset of deltas)
      for (const height of [0.001, 1, 127.999, 128, 256, 9000]) {
        const r = { left: 100, top: band + offset, width: 500, height };
        const snap = snapshot([surface({ shape: r, protectedEnvelope: r })]);
        for (const [from, to] of [
          [
            { x: 110, y: band - 130 },
            { x: 550, y: band + 130 },
          ],
          [
            { x: 200, y: band },
            { x: 200, y: band },
          ],
        ]) {
          let a = current.initialApproach(),
            b = reference.initialApproach();
          for (const timeMs of [0, 1, 349, 350, 351, 702]) {
            const input = {
              timeMs,
              keyed: false,
              point: to,
              previousPoint: from,
            };
            a = current.stepApproach(a, snap, input, []);
            b = reference.stepApproach(b, snap, input, []);
            expect(plain(a)).toEqual(plain(b));
            cases++;
          }
        }
      }
  for (let run = 0; run < 1000; run++) {
    const surfaces = Array.from({ length: 1 + Math.floor(rand() * 55) }, (_, id) => {
      const rect = {
        left: rand() * 2000 - 500,
        top: (Math.floor(rand() * 100) - 50) * 128 + rand(),
        width: 1 + rand() * 1600,
        height: rand() < 0.1 ? 9000 : 1 + rand() * 500,
      };
      const flags = surface().availability;
      return surface({
        id: String(id),
        shape: rect,
        protectedEnvelope: rect,
        availability: {
          ...flags,
          visible: rand() > 0.1,
          focused: rand() < 0.025,
          dragging: rand() < 0.02,
          captured: rand() < 0.02,
        },
        ...(rand() < 0.05
          ? {
              policy: {
                transform: 'fixed-plane',
                occlusion: 'allow',
                input: 'native-only',
              },
            }
          : {}),
      });
    });
    const snap = snapshot(surfaces);
    const paints = Array.from({ length: 12 }, (_, id) => ({
      id: `p${id}`,
      root: `g${id % 4}`,
      dynamic: true,
      opacity: 1,
      pointerEvents: false,
      composition: 'overlay' as const,
      outset: rand() * 20,
      bounds: { left: 0, top: 0, right: 0, bottom: 0 },
    }));
    let a = current.initialApproach(),
      b = reference.initialApproach();
    let before = { x: rand() * 1500, y: rand() * 1500 - 500 };
    for (let step = 0; step < 16; step++) {
      const point = { x: rand() * 1500, y: rand() * 1500 - 500 };
      for (const p of paints) {
        const x = rand() * 1500,
          y = rand() * 1500 - 500;
        p.bounds = { left: x, top: y, right: x + 200, bottom: y + 100 };
      }
      const input = {
        timeMs: step * 83,
        point,
        previousPoint: before,
        keyed: rand() < 0.1,
        ...(rand() < 0.1 ? { pressed: point } : {}),
      };
      a = current.stepApproach(a, snap, input, paints);
      b = reference.stepApproach(b, snap, input, paints);
      expect(plain(a), `run ${run} step ${step}`).toEqual(plain(b));
      cases++;
      before = point;
    }
  }
  writeFileSync(
    '.work/g12v-evidence/index-differential.json',
    JSON.stringify(
      {
        current: '4d3f39b',
        reference: '2acc2b5',
        seed: 671203,
        cases,
        mismatch: 0,
      },
      null,
      2,
    ),
  );
});

test('D4 keeps every holding cause and D1 holds a whole root', () => {
  const rect = { left: 100, top: 100, width: 20, height: 20 };
  const a = surface({
    id: 'a',
    shape: rect,
    protectedEnvelope: rect,
    availability: { ...surface().availability, focused: true },
  });
  const b = surface({
    id: 'b',
    shape: rect,
    protectedEnvelope: rect,
    availability: { ...surface().availability, captured: true },
  });
  const paint = {
    id: 'child',
    root: 'group',
    dynamic: true,
    opacity: 1,
    pointerEvents: false,
    composition: 'overlay' as const,
    outset: 0,
    bounds: { left: 100, top: 100, right: 120, bottom: 120 },
  };
  let state = current.stepApproach(current.initialApproach(), snapshot([a, b]), { timeMs: 0, keyed: false }, [paint]);
  expect(state.held.get('group')).toEqual(['a', 'b']);
  const released = (s: typeof a) => ({
    ...s,
    availability: { ...s.availability, focused: false, captured: false },
  });
  state = current.stepApproach(state, snapshot([released(a), b]), { timeMs: 1, keyed: false }, []);
  state = current.stepApproach(state, snapshot([released(a), b]), { timeMs: 352, keyed: false }, []);
  expect(state.held.get('group')).toEqual(['b']);
  state = current.stepApproach(state, snapshot([released(a), released(b)]), { timeMs: 353, keyed: false }, []);
  state = current.stepApproach(state, snapshot([released(a), released(b)]), { timeMs: 702, keyed: false }, []);
  expect(state.held.has('group')).toBe(true);
  state = current.stepApproach(state, snapshot([released(a), released(b)]), { timeMs: 703, keyed: false }, []);
  expect(state.held.size).toBe(0);
});

test('the actual clip and paint protection functions are byte-identical to 557b978', () => {
  const functions = (name: string) => {
    const text = readFileSync(name, 'utf8'),
      file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    return new Map(
      file.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name?.text, node.getText(file)]),
    );
  };
  const before = functions('.work/g12-557/src/world/operations.ts'),
    after = functions('src/world/operations.ts');
  const hashes: Record<string, string> = {};
  for (const name of ['guardPaint', 'safePaintRegions', 'pagePaintRegions', 'protectionClip', 'editorClaims']) {
    expect(after.get(name), name).toBe(before.get(name));
    hashes[name] = createHash('sha256').update(after.get(name)!).digest('hex');
  }
  writeFileSync('.work/g12v-evidence/protection-functions.json', JSON.stringify(hashes, null, 2));
});

test('historical take: all recorded timestamps and fractional/reverse seeks agree with 557b978', () => {
  const source = inspectAsset(modelFixture()).model!,
    model = defaultModelSettings(source);
  model.locomotion = {
    ...model.locomotion,
    enabled: true,
    idle: 0,
    walk: 1,
    run: 2,
    runSpeed: 200,
  };
  const rig: any = {
    kind: 'model3d',
    id: 'rig',
    name: 'Rig',
    assetId: `asset-${'f'.repeat(64)}`,
    source,
    model,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    placement: {
      anchor: { kind: 'viewport' },
      x: 0.2,
      y: 0.5,
      widthPx: 200,
      heightPx: 200,
      rotationDeg: 25,
    },
    motion: defaultFollowMotion(),
  };
  const image: any = {
    kind: 'image',
    id: 'petal',
    name: 'Petal',
    assetId: `asset-${'e'.repeat(64)}`,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    placement: {
      anchor: { kind: 'viewport' },
      x: 0.7,
      y: 0.3,
      widthPx: 120,
      heightPx: 90,
      rotationDeg: 0,
    },
    motion: { ...defaultFollowMotion(), mode: 'smooth' },
  };
  const scene = {
    decorations: [rig, image],
    signalRules: [defaultScrollOpacityRule('petal')],
  };
  const fixture = JSON.parse(readFileSync('tests/fixtures/takes/pre-g12-take.json', 'utf8'));
  const old = oldTakes.createTakeSampler(scene, oldTakes.parseSignalTake(fixture.take));
  const now = newTakes.createTakeSampler(scene, newTakes.parseSignalTake(fixture.take));
  const positions = [
    ...fixture.expected.map((e: any) => e.positionMs),
    ...fixture.take.inputs.map((e: any) => e.timeMs - fixture.take.inputs[0].timeMs),
    ...Array.from({ length: 100 }, (_, n) => n * 19.87654),
  ];
  for (const { positionMs, result } of fixture.expected)
    expect(JSON.parse(JSON.stringify(old.at(positionMs)))).toEqual(result);
  let cases = 0;
  for (const p of [...positions, ...positions.toReversed()]) {
    expect(JSON.parse(JSON.stringify(now.at(p))), String(p)).toEqual(JSON.parse(JSON.stringify(old.at(p))));
    now.at(p, { layers: { petal: [], rig: [] } });
    expect(JSON.parse(JSON.stringify(now.at(p))), `unpolluted ${p}`).toEqual(JSON.parse(JSON.stringify(old.at(p))));
    cases++;
  }
  writeFileSync(
    '.work/g12v-evidence/take-differential.json',
    JSON.stringify(
      {
        baseline: '557b978',
        positions: cases,
        fixtureExpectedPositions: fixture.expected.length,
        mismatch: 0,
        liveRestrictionsPollutedCheckpoints: false,
      },
      null,
      2,
    ),
  );
});
