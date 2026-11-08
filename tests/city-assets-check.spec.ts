import { test, expect } from '@playwright/test';
// @ts-expect-error A plain ESM script without types; only its rules are tested here.
import { checkCityAssets, readGlb, makeGlb } from '../scripts/city-assets/check.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const real = path.resolve('src/playground/city-assets');

/** A one-triangle prop GLB whose box is y 0..height. */
function prop(options: { material?: string; height?: number; tris?: number; scale?: number[] } = {}) {
  return makeGlb({
    material: options.material ?? 'slot_wood',
    height: options.height ?? 0.5,
    tris: options.tris ?? 1,
    scale: options.scale,
  });
}

function scratch(rows: object[], files: Record<string, Buffer>) {
  const root = mkdtempSync(path.join(tmpdir(), 'ww-city-assets-'));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), bytes);
  }
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, assets: rows }));
  copyFileSync(path.join(real, 'humanoid.json'), path.join(root, 'humanoid.json'));
  return root;
}
const row = (extra: object = {}) => ({
  id: 'street-thing',
  kind: 'street',
  file: 'street/thing.glb',
  status: 'draft',
  heightM: 0.5,
  tris: 1,
  roles: [],
  cultures: [],
  source: { type: 'own', author: 'WWT', license: 'WWT', record: 'tools' },
  ...extra,
});
const problems = (rows: object[], files: Record<string, Buffer>) => {
  const root = scratch(rows, files);
  try {
    return checkCityAssets(root) as string[];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('the committed assets pass every contract check', () => {
  expect(checkCityAssets(real)).toEqual([]);
});

test('a well-formed prop passes, and its triangles and height are read from the GLB', () => {
  const glb = readGlb(prop({ tris: 3, height: 0.8 }));
  expect(glb.tris).toBe(3);
  expect(glb.max[1] - glb.min[1]).toBeCloseTo(0.8, 5);
  expect(problems([row({ heightM: 0.5 })], { 'street/thing.glb': prop() })).toEqual([]);
});

test('a material outside the slot names is refused', () => {
  expect(problems([row()], { 'street/thing.glb': prop({ material: 'Material.001' }) })).toEqual([
    'street-thing: material "Material.001" is not a contract slot',
  ]);
});

test('over the triangle budget, wrong height, unapplied scale and a missing source are refused', () => {
  const found = problems([row({ tris: 900, heightM: 0.9, source: null })], {
    'street/thing.glb': prop({ tris: 900, scale: [2, 2, 2] }),
  });
  expect(found).toContain('street-thing: 900 triangles over the street budget 800');
  expect(found).toContain('street-thing: height 0.500 m differs from heightM 0.9');
  expect(found).toContain('street-thing: node "thing" has a scale or rotation (apply transforms)');
  expect(found).toContain('street-thing: no source recorded');
});

test('files and rows must match both ways, and placeholders need no file', () => {
  const found = problems([row({ file: 'street/missing.glb' }), row({ id: 'p', file: null, status: 'placeholder' })], {
    'street/stray.glb': prop(),
  });
  expect(found).toContain('street-thing: street/missing.glb is missing');
  expect(found).toContain('street/stray.glb: a GLB that no manifest row lists');
  expect(found.some((p) => p.startsWith('p:'))).toBe(false);
});

test('a resident without the humanoid bones and attach points is refused', () => {
  const found = problems([row({ id: 'resident-x', kind: 'resident', file: 'residents/x.glb', rig: 'resident' })], {
    'residents/x.glb': prop(),
  });
  expect(found).toContain('resident-x: bone "Hips" (hips) is missing');
  expect(found).toContain('resident-x: attach point "attach_hand_r" is missing');
});

test('a forbidden name anywhere in an asset is refused', () => {
  expect(problems([row()], { 'street/thing.glb': prop({ material: 'slot_wood', height: 0.5 }) })).toEqual([]);
  const found = problems([row({ id: 'mixamo-walk' })], { 'street/thing.glb': prop() });
  expect(found).toContain('mixamo-walk: forbidden name');
});
