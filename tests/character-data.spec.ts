import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { inspectVrma } from '../src/assets/vrma';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { migrateV13ToV14 } from '../src/design/migrations';
import { designAssetIds } from '../src/design/references';
import { defaultModelSettings, type ModelInfo } from '../src/models/types';
import {
  applyCharacterPatch,
  CHARACTER_LIMITS,
  modelClips,
  motionUsable,
  standardMotionsUsable,
} from '../src/characters/settings';
import type { CharacterSettings, ModelDecoration } from '../src/design/types';
import { vrmFixture } from './helpers/vrm-fixture';
import { vrmaFixture } from './helpers/vrma-fixture';
import { modelFixture } from './helpers/model-fixture';

const asset = (n: number) => `asset-${n.toString(16).padStart(64, '0')}`;
const vrmSource = () => inspectAsset(new Uint8Array(vrmFixture())).model!;
// As the importer measured a motion before v16 (these documents are v14/v15): no hips height.
const motionSource = () => {
  const { hipsHeight: _, ...info } = inspectVrma(new Uint8Array(vrmaFixture())).info;
  return info;
};
function character(patch: Partial<CharacterSettings> = {}): CharacterSettings {
  return {
    standardMotions: 'auto',
    motions: [
      { id: 'idle', assetId: asset(2), role: 'idle', origin: 'character', loop: true, source: motionSource() },
      { id: 'sit', assetId: asset(3), role: 'sit', origin: 'standard', loop: true, source: motionSource() },
    ],
    ...patch,
  };
}
function layer(source: ModelInfo, extra: Record<string, unknown> = {}) {
  return {
    kind: 'model3d',
    id: 'trusie',
    assetId: asset(1),
    name: 'Trusie',
    placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 120, heightPx: 160, rotationDeg: 0 },
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    source,
    model: defaultModelSettings(source),
    ...extra,
  };
}
const doc = (decorations: unknown[], schemaVersion = 14) => ({
  ...emptyDesign('youtube', null),
  schemaVersion,
  decorations,
});

test('a VRM source carries its body measure; GLB sources do not', () => {
  const source = vrmSource();
  expect(source.vrm!.body).toMatchObject({ height: expect.closeTo(1.1, 6), headLength: expect.closeTo(0.25, 6) });
  expect(inspectAsset(new Uint8Array(modelFixture())).model!.vrm).toBeUndefined();
});

test('v14 character roundtrips; clip indices then address its motions', () => {
  const source = vrmSource();
  const input = doc([layer(source, { character: character(), model: { ...defaultModelSettings(source), clip: 1 } })]);
  const parsed = parseDesign(input);
  expect(parsed).toStrictEqual(parseDesign(JSON.parse(JSON.stringify(parsed))));
  const model = parsed.decorations[0] as ModelDecoration;
  expect(model.character).toEqual(character());
  expect(modelClips(model)).toEqual([
    { name: 'idle', duration: 1 },
    { name: 'sit', duration: 1 },
  ]);
  // Index 2 is past the two motions, though the asset itself would allow none either.
  expect(() =>
    parseDesign(doc([layer(source, { character: character(), model: { ...defaultModelSettings(source), clip: 2 } })])),
  ).toThrow();
});

test('the motion assets are kept alive with the model', () => {
  const parsed = parseDesign(doc([layer(vrmSource(), { character: character() })]));
  expect(designAssetIds(parsed).sort()).toEqual([asset(1), asset(2), asset(3)]);
});

test('standard motions follow the body unless the user overrides; character motions always play', () => {
  const source = vrmSource();
  const stage1 = { ...source.vrm!.body!, headsTall: 3 },
    stage2 = { ...source.vrm!.body!, headsTall: 6, legRatio: 0.5, hipsRatio: 0.6 };
  const c = character();
  expect(standardMotionsUsable(c, stage1)).toBe(false);
  expect(standardMotionsUsable(c, stage2)).toBe(true);
  expect(standardMotionsUsable(c, undefined)).toBe(false); // unknown body: the safe, simple motions
  expect(standardMotionsUsable({ ...c, standardMotions: 'on' }, stage1)).toBe(true);
  expect(standardMotionsUsable({ ...c, standardMotions: 'off' }, stage2)).toBe(false);
  // Stage 3: the character's own motion plays whatever the measure says.
  expect(motionUsable(c, 0, stage1)).toBe(true);
  expect(motionUsable({ ...c, standardMotions: 'off' }, 0, stage2)).toBe(true);
  expect(motionUsable(c, 1, stage1)).toBe(false);
  expect(motionUsable(c, 1, stage2)).toBe(true);
  expect(motionUsable(c, 5, stage2)).toBe(false);
});

const bad: [string, (c: Record<string, any>) => void][] = [
  ['an unknown key', (c) => (c.mood = 'happy')],
  ['an unknown motion key', (c) => (c.motions[0].script = 'alert(1)')],
  ['a bad motion id', (c) => (c.motions[0].id = 'Idle Motion')],
  ['a duplicate motion id', (c) => (c.motions[1].id = 'idle')],
  ['a bad asset id', (c) => (c.motions[0].assetId = 'https://example.com/idle.vrma')],
  ['an unknown role', (c) => (c.motions[0].role = 'fly')],
  ['an unknown origin', (c) => (c.motions[0].origin = 'mixamo')],
  ['an unknown standard mode', (c) => (c.standardMotions = 'maybe')],
  ['a source with an unknown bone', (c) => (c.motions[0].source.bones = ['hips', 'tail'])],
  ['a source without hips', (c) => (c.motions[0].source.bones = ['spine'])],
  ['a negative duration', (c) => (c.motions[0].source.duration = -1)],
  ['a non-finite travel', (c) => (c.motions[0].source.hipsTravel = [0, Number.NaN, 0])],
  ['a CSS-looking name', (c) => (c.motions[0].source.name = 'a\u0000b')],
  [
    'too many motions',
    (c) =>
      (c.motions = Array.from({ length: CHARACTER_LIMITS.motions + 1 }, (_, i) => ({ ...c.motions[0], id: `m${i}` }))),
  ],
];
for (const [name, mutate] of bad)
  test(`character rejects ${name}`, () => {
    const c = JSON.parse(JSON.stringify(character()));
    mutate(c);
    expect(() => parseDesign(doc([layer(vrmSource(), { character: c })]))).toThrow();
  });

// v16 documents, so the value itself (not the version gate) is what is refused.
const badHips: [string, unknown][] = [
  ['non-finite', Number.POSITIVE_INFINITY],
  ['past the limit', CHARACTER_LIMITS.metres + 1],
  ['below the limit', -CHARACTER_LIMITS.metres - 1],
  ['text', '0.9'],
];
for (const [name, value] of badHips)
  test(`character rejects a hips height that is ${name}`, () => {
    const c = JSON.parse(JSON.stringify(character()));
    c.motions[0].source.hipsHeight = value;
    expect(() => parseDesign(doc([layer(vrmSource(), { character: c })], 16))).toThrow('範囲外');
  });

test('a motion hips height roundtrips at its limit and stays absent when not given', () => {
  const c = character();
  c.motions[0]!.source = { ...c.motions[0]!.source, hipsHeight: CHARACTER_LIMITS.metres };
  const parsed = parseDesign(doc([layer(vrmSource(), { character: c })], 16));
  const motions = (parsed.decorations[0] as ModelDecoration).character!.motions;
  expect(motions[0]!.source.hipsHeight).toBe(CHARACTER_LIMITS.metres);
  expect(Object.hasOwn(motions[1]!.source, 'hipsHeight')).toBe(false);
  expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
});

test('the motion count limit is inclusive', () => {
  const c = character();
  c.motions = Array.from({ length: CHARACTER_LIMITS.motions }, (_, i) => ({ ...c.motions[0]!, id: `m${i}` }));
  expect(
    (parseDesign(doc([layer(vrmSource(), { character: c })])).decorations[0] as ModelDecoration).character!.motions,
  ).toHaveLength(CHARACTER_LIMITS.motions);
});

test('a character needs a VRM model', () => {
  const glb = inspectAsset(new Uint8Array(modelFixture())).model!;
  expect(() => parseDesign(doc([layer(glb, { character: character() })]))).toThrow();
});

test('body measure values are bounded', () => {
  const source = vrmSource();
  for (const value of [-1, Number.NaN, 1e9])
    expect(() =>
      parseDesign(doc([layer({ ...source, vrm: { ...source.vrm!, body: { ...source.vrm!.body!, height: value } } })])),
    ).toThrow();
  const { body: _, ...vrm } = source.vrm!;
  expect(parseDesign(doc([layer({ ...source, vrm })])).decorations).toHaveLength(1); // body stays optional
});

test('a character patch changes the mode and keeps clip indices on the same motions', () => {
  const source = vrmSource();
  const c = character();
  c.motions.push({ ...c.motions[0]!, id: 'wave', role: 'gesture' });
  const model = {
    ...defaultModelSettings(source),
    clip: 2,
    locomotion: { ...defaultModelSettings(source).locomotion, idle: 0, walk: 1 },
  };
  const result = applyCharacterPatch(
    { source, character: c, model },
    { standardMotions: 'on', keep: ['idle', 'wave'] },
  );
  expect(result.character.standardMotions).toBe('on');
  expect(result.character.motions.map((m) => m.id)).toEqual(['idle', 'wave']);
  expect(result.model.clip).toBe(1); // wave moved from 2 to 1
  expect(result.model.locomotion.idle).toBe(0);
  expect(result.model.locomotion.walk).toBeNull(); // sit was removed
  expect(() => applyCharacterPatch({ source, character: c, model }, { keep: ['nope'] })).toThrow();
  expect(() => applyCharacterPatch({ source, character: c, model }, { keep: ['idle', 'idle'] })).toThrow();
  // The model's own clip list is untouched by a character patch.
  expect(applyCharacterPatch({ source, character: c, model }, {}).model).toEqual(model);
});

test('v13 documents cannot carry a character or a body measure, and migrate to v14 unchanged', () => {
  const source = vrmSource();
  const { body: _, ...vrm } = source.vrm!;
  const plain = { ...source, vrm };
  expect(() => migrateV13ToV14(doc([layer(plain, { character: character() })], 13))).toThrow();
  expect(() => migrateV13ToV14(doc([layer(source)], 13))).toThrow();
  const v13 = doc([layer(plain)], 13);
  const migrated = parseDesign(v13);
  expect(migrated.schemaVersion).toBe(16);
  expect((migrated.decorations[0] as ModelDecoration).character).toBeUndefined();
});
