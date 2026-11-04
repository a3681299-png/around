import { test, expect } from '@playwright/test';
import { draftMotions, motionId, parseMotionLabels, parseMotionManifest } from '../src/characters/manifest';
import { CHARACTER_LIMITS, type CharacterMotion } from '../src/characters/settings';
import { inspectVrma } from '../src/assets/vrma';
import { vrmaFixture } from './helpers/vrma-fixture';

const source = inspectVrma(new Uint8Array(vrmaFixture())).info;
const pose = inspectVrma(
  new Uint8Array(vrmaFixture({ times: [0], hips: [[0, 0.5, 0]], rotations: [[0, 0, 0, 1]] })),
).info;
const manifest = JSON.stringify({
  model: 'trusie.vrm',
  clips: [
    {
      name: 'jump_down',
      category: 'edge',
      file: 'trusie/jump_down.vrma',
      file_any_model: 'jump_down.vrma',
      loop: false,
    },
    { name: 'idle', category: 'idle', file: 'trusie/idle.vrma', file_any_model: 'idle.vrma', loop: true },
    { name: 'bad', category: 'fly', file: 'trusie/bad.vrma' },
    { name: 42, category: 'idle', file: 'x.vrma' },
    'not an object',
  ],
});

test('the manifest labels files by name, role and loop, skipping malformed entries', () => {
  const labels = parseMotionManifest(manifest);
  expect(labels.get('jump_down.vrma')).toEqual({ name: 'jump_down', role: 'edge', loop: false });
  expect(labels.get('idle.vrma')).toEqual({ name: 'idle', role: 'idle', loop: true });
  expect(labels.has('bad.vrma')).toBe(false);
  expect(labels.has('x.vrma')).toBe(false);
  expect(() => parseMotionManifest('{')).toThrow();
  expect(() => parseMotionManifest('{"clips":3}')).toThrow();
  expect(() => parseMotionManifest(' '.repeat(256 * 1024 + 1))).toThrow();
});

test('labels crossing the Studio boundary are rebuilt and malformed ones refused', () => {
  const labels = parseMotionLabels([...parseMotionManifest(manifest)]);
  expect(labels.get('jump_down.vrma')).toEqual({ name: 'jump_down', role: 'edge', loop: false });
  for (const bad of [
    'x',
    [['a.vrma']],
    [['a.vrma', { name: 'a', role: 'fly', loop: true }]],
    [['a.vrma', { name: 'a', role: 'idle', loop: 'yes' }]],
    [['a.vrma', { name: 'a', role: 'idle', loop: true, css: 'x' }]],
    Array.from({ length: 257 }, (_, i) => [`${i}.vrma`, { name: 'a', role: 'idle', loop: true }]),
  ])
    expect(() => parseMotionLabels(bad)).toThrow();
});

test('motion IDs follow the engine pattern and stay unique', () => {
  expect(motionId('jump_down', new Set())).toBe('jump-down');
  expect(motionId('Sit 2.vrma', new Set())).toBe('sit-2');
  expect(motionId('3d spin', new Set())).toBe('m-3d-spin');
  expect(motionId('日本語', new Set())).toBe('motion');
  expect(motionId('idle', new Set(['idle', 'idle-2']))).toBe('idle-3');
  expect(motionId('a'.repeat(200), new Set())).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
});

test('drafted motions take the manifest label, measured facts and the chosen origin', () => {
  const labels = parseMotionManifest(manifest);
  const existing: CharacterMotion[] = [
    { id: 'idle', assetId: `asset-${'0'.repeat(64)}`, role: 'idle', origin: 'character', loop: true, source },
  ];
  const motions = draftMotions(
    existing,
    [
      { id: `asset-${'1'.repeat(64)}`, name: 'jump_down.vrma', vrmAnimation: source },
      { id: `asset-${'2'.repeat(64)}`, name: 'idle.vrma', vrmAnimation: source },
      { id: `asset-${'3'.repeat(64)}`, name: 'sit_floor_hug.vrma', vrmAnimation: pose },
    ],
    labels,
    'standard',
  );
  expect(motions.map((m) => [m.id, m.role, m.loop, m.origin])).toEqual([
    ['jump-down', 'edge', false, 'standard'],
    ['idle-2', 'idle', true, 'standard'],
    ['sit-floor-hug', 'sit', true, 'standard'], // unlabelled one-frame pose
  ]);
  expect(motions[0]!.source).toBe(source); // facts from the file, not the manifest
});

test('drafting refuses to pass the motion limit', () => {
  const many = Array.from({ length: CHARACTER_LIMITS.motions }, (_, i) => ({
    id: `asset-${i.toString(16).padStart(64, '0')}`,
    name: `m${i}.vrma`,
    vrmAnimation: source,
  }));
  expect(draftMotions([], many, new Map(), 'character')).toHaveLength(CHARACTER_LIMITS.motions);
  expect(() => draftMotions([], [...many, many[0]!], new Map(), 'character')).toThrow();
});
