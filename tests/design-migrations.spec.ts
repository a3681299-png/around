import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { freezeTree, readDesign, editDesign, commitDesign } from '../src/design/immutable';

const fixtures = 'tests/fixtures/designs/';
const expected = JSON.parse(readFileSync(fixtures + 'chain-expected.json', 'utf8')) as {
  baseline: string;
  documents: Record<string, unknown>;
};
for (const [file, result] of Object.entries(expected.documents)) {
  test(`${file}: parseDesign stays exactly equal to the pre-chain result and preserves frozen inputs`, () => {
    const input = freezeTree(JSON.parse(readFileSync(fixtures + file, 'utf8')));
    const before = JSON.stringify(input);
    expect(parseDesign(input)).toStrictEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    const design = readDesign(input);
    expect(Object.isFrozen(design)).toBe(true);
    expect(commitDesign(editDesign(design), design)).toBe(design);
  });
}

test('each old version rejects fields and capabilities introduced in a later version', () => {
  const load = (name: string): any => JSON.parse(readFileSync(fixtures + name, 'utf8'));
  const image = load('v3.json').decorations[0];
  const doc = (version: number, extra: object = {}) => ({
    schemaVersion: version,
    id: 'legacy',
    siteId: 'youtube',
    baseThemeId: null,
    rules: [],
    decorations: [{ ...image }],
    ...extra,
  });
  const forbidden = [
    { ...load('v1.json'), decorations: [] },
    doc(2), // locked did not exist in v2.
    doc(3, { decorations: load('v4.json').decorations }),
    doc(4, { decorations: [{ ...image, effects: [] }] }),
    doc(5, { groups: [] }),
    doc(6, { decorations: load('history-v7.json').decorations }),
    doc(7, { signalRules: [] }),
    { ...load('history-v9.json'), schemaVersion: 8 },
    doc(8, { decorations: [{ ...image, motion: { kind: 'pointer-follow' } }] }),
    { ...load('history-v10.json'), schemaVersion: 9 },
    { ...load('history-v11.json'), schemaVersion: 10 },
  ];
  for (const value of forbidden) expect(() => parseDesign(value)).toThrow();
  for (const version of [4, 5, 6]) {
    const animation = load('v4.json').decorations[0];
    expect(() =>
      parseDesign(doc(version, { decorations: [{ ...animation, playback: { ...animation.playback, mode: 'auto' } }] })),
    ).toThrow();
    expect(() =>
      parseDesign(doc(version, { decorations: [{ ...animation, playback: { ...animation.playback, speed: 2 } }] })),
    ).toThrow();
    expect(() =>
      parseDesign(
        doc(version, { decorations: Array.from({ length: 9 }, (_, i) => ({ ...animation, id: `animation-${i}` })) }),
      ),
    ).toThrow();
  }
});
