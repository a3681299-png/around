import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { migrateV14ToV15 } from '../src/design/migrations';
import { applyCharacterPatch } from '../src/characters/settings';
import type { ModelDecoration } from '../src/design/types';

/** DesignDocument v15 (chunk 3): a character's personality and the author's two switches. */
const v14 = JSON.parse(readFileSync('tests/fixtures/designs/history-v14.json', 'utf8'));
const withCharacter = (extra: Record<string, unknown>, version = 15) => {
  const doc = structuredClone(v14);
  doc.schemaVersion = version;
  Object.assign(doc.decorations[0].character, extra);
  return doc;
};
const character = (doc: { decorations: unknown[] }) => (doc.decorations[0] as ModelDecoration).character!;

test('v15 roundtrips personality and the switches; absent keys keep v14 behaviour', () => {
  const parsed = parseDesign(
    withCharacter({
      personality: { shyness: 0.8, curiosity: 0.2, sleepiness: 0.35 },
      computedMotion: false,
      autonomy: true,
    }),
  );
  expect(character(parsed)).toMatchObject({
    personality: { shyness: 0.8, curiosity: 0.2, sleepiness: 0.35 },
    computedMotion: false,
    autonomy: true,
  });
  expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
  // A migrated v14 character has none of the keys: computed motion on, autonomy off.
  const migrated = character(parseDesign(v14));
  expect(Object.hasOwn(migrated, 'personality')).toBe(false);
  expect(Object.hasOwn(migrated, 'computedMotion')).toBe(false);
  expect(Object.hasOwn(migrated, 'autonomy')).toBe(false);
});

test('a v14 document cannot carry the v15 keys', () => {
  for (const extra of [
    { personality: { shyness: 0.5, curiosity: 0.5, sleepiness: 0.5 } },
    { computedMotion: true },
    { autonomy: false },
  ]) {
    expect(() => migrateV14ToV15(withCharacter(extra, 14))).toThrow('v15');
    expect(() => parseDesign(withCharacter(extra, 14))).toThrow();
  }
  // Without them, v14 migrates.
  expect(migrateV14ToV15(v14)['schemaVersion']).toBe(15);
});

test('personality is three numbers in 0…1 and nothing else; the switches are booleans', () => {
  const bad: unknown[] = [
    { shyness: 1.01, curiosity: 0.5, sleepiness: 0.5 },
    { shyness: -0.01, curiosity: 0.5, sleepiness: 0.5 },
    { shyness: Number.NaN, curiosity: 0.5, sleepiness: 0.5 },
    { shyness: '0.5', curiosity: 0.5, sleepiness: 0.5 },
    { shyness: 'calc(1)', curiosity: 0.5, sleepiness: 0.5 },
    { shyness: 0.5, curiosity: 0.5 },
    { shyness: 0.5, curiosity: 0.5, sleepiness: 0.5, courage: 1 },
    { shyness: 0.5, curiosity: 0.5, sleepiness: 0.5, formula: 'x*2' },
    [0.5, 0.5, 0.5],
    'shy',
  ];
  for (const personality of bad)
    expect(() => parseDesign(withCharacter({ personality })), JSON.stringify(personality)).toThrow();
  for (const value of ['yes', 1, null, 'javascript:alert(1)'])
    for (const key of ['computedMotion', 'autonomy'])
      expect(() => parseDesign(withCharacter({ [key]: value })), `${key}=${value}`).toThrow();
  // Bounds are inclusive; values are kept to 0.01 so equal settings serialise equally.
  const edge = character(parseDesign(withCharacter({ personality: { shyness: 0, curiosity: 1, sleepiness: 0.333 } })));
  expect(edge.personality).toEqual({ shyness: 0, curiosity: 1, sleepiness: 0.33 });
});

test('a motion patch keeps the personality and switches', () => {
  const layer = parseDesign(
    withCharacter({ personality: { shyness: 0.9, curiosity: 0.1, sleepiness: 0.5 }, autonomy: true }),
  ).decorations[0] as ModelDecoration;
  const patched = applyCharacterPatch(
    { source: layer.source, character: layer.character!, model: layer.model },
    { keep: layer.character!.motions.map((m) => m.id).reverse() },
  );
  expect(patched.character.personality).toEqual({ shyness: 0.9, curiosity: 0.1, sleepiness: 0.5 });
  expect(patched.character.autonomy).toBe(true);
  const switched = applyCharacterPatch(
    { source: layer.source, character: layer.character!, model: layer.model },
    { computedMotion: false, personality: { shyness: 0.2, curiosity: 0.2, sleepiness: 0.2 } },
  );
  expect(switched.character).toMatchObject({ computedMotion: false, autonomy: true });
});
