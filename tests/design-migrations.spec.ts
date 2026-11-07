import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { freezeTree, readDesign, editDesign, commitDesign } from '../src/design/immutable';
import { DESIGN_MIGRATIONS, migrateDesign } from '../src/design/migrations';
import { IMAGE_LIMITS, type DesignDocument } from '../src/design/types';
import { ASSET_MESSAGES } from '../src/assets/limits';

const fixtures = 'tests/fixtures/designs/';
const expected = JSON.parse(readFileSync(fixtures + 'chain-expected.json', 'utf8')) as {
  baseline: string;
  documents: Record<string, unknown>;
};

test('every historical layer stage rejects excess decorations before inspecting the first layer', () => {
  for (let version = 2; version < 16; version++) {
    let reads = 0;
    const decorations = new Array<unknown>(IMAGE_LIMITS.count + 1);
    Object.defineProperty(decorations, 0, {
      get() {
        reads++;
        throw new Error('layer inspection must follow the count limit');
      },
    });
    const document = {
      schemaVersion: version,
      id: 'legacy',
      siteId: 'youtube',
      baseThemeId: null,
      rules: [],
      decorations,
    };
    expect(() => DESIGN_MIGRATIONS[version - 1]!(document)).toThrow(ASSET_MESSAGES.layerCount);
    expect(() => parseDesign(document)).toThrow(ASSET_MESSAGES.layerCount);
    expect(reads).toBe(0);
  }
});
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
    doc(11, { decorations: [{ ...image, renderMode: 'atmosphere' }] }),
    doc(12, {
      rules: [
        {
          kind: 'surface-style',
          target: 'video-card',
          style: {},
          skin: {
            states: {
              normal: {
                assetId: image.assetId,
                slices: { top: 1, right: 1, bottom: 1, left: 1 },
                center: 'stretch',
                scalePct: 100,
              },
            },
          },
        },
      ],
    }),
  ];
  // v15: a motion's measured hips height arrived in v16.
  const v15 = load('history-v15.json');
  v15.decorations[0].character.motions[0].source.hipsHeight = 0.8;
  forbidden.push(v15);
  for (const value of forbidden) expect(() => parseDesign(value)).toThrow();
  expect(() => migrateDesign(v15)).toThrow('v16');
  // The same document with the field set as a v16 document is accepted and keeps the value.
  const v16 = parseDesign({ ...v15, schemaVersion: 16 }) as any;
  expect(v16.decorations[0].character.motions[0].source.hipsHeight).toBe(0.8);
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

test('every pure adjacent step advances one version without granting validation or mutating historical inputs', () => {
  for (const [file, result] of Object.entries(expected.documents)) {
    let data = freezeTree(JSON.parse(readFileSync(fixtures + file, 'utf8')));
    const original = JSON.stringify(data);
    const version = data.schemaVersion as number;
    for (let from = version; from < 16; from++) {
      const migration = DESIGN_MIGRATIONS[from - 1]!;
      const before = JSON.stringify(data);
      const migrated = migration(data);
      expect(migrated['schemaVersion']).toBe(from + 1);
      expect(JSON.stringify(data)).toBe(before);
      expect(() => migration({ ...data, schemaVersion: from + 1 })).toThrow();
      expect(() => migration({ ...data, unknown: undefined })).toThrow();
      data = freezeTree(migrated);
    }
    expect(parseDesign(data)).toStrictEqual(result);
    expect(JSON.stringify(JSON.parse(readFileSync(fixtures + file, 'utf8')))).toBe(original);
  }
  const unvalidated = migrateDesign({
    schemaVersion: 2,
    id: 'bad',
    siteId: 'youtube',
    baseThemeId: null,
    rules: [],
    decorations: [{ kind: 'image', opacity: Infinity }],
  });
  expect(unvalidated['schemaVersion']).toBe(16);
  expect(() => parseDesign(unvalidated)).toThrow();
  expect(() => readDesign(freezeTree(unvalidated))).toThrow();
  expect(() => commitDesign(unvalidated as unknown as DesignDocument)).toThrow();
});

test('historical gates reject even undefined future fields and group motion before v9', () => {
  const load = (name: string): any => JSON.parse(readFileSync(fixtures + name, 'utf8'));
  for (const version of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const data = load(`v${version}.json`);
    expect(() =>
      parseDesign({ ...data, decorations: data.decorations.map((layer: object) => ({ ...layer, source: undefined })) }),
    ).toThrow();
  }
  for (const version of [6, 7, 8]) {
    const data = load('v6.json');
    data.schemaVersion = version;
    data.groups[0].motion = undefined;
    expect(() => parseDesign(data)).toThrow();
  }
});

test('v12 renderMode keeps normal by omission, stores atmosphere, and keeps a group undivided', () => {
  const image = JSON.parse(readFileSync(fixtures + 'v3.json', 'utf8')).decorations[0];
  const doc = (decorations: object[], groups?: object[]) => ({
    schemaVersion: 12,
    id: 'modes',
    siteId: 'youtube',
    baseThemeId: null,
    rules: [],
    decorations,
    ...(groups ? { groups } : {}),
  });
  const a = { ...image, id: 'image-a' },
    b = { ...image, id: 'image-b' };
  // Every v11 document migrates with normal rendering and no new field.
  const migrated = parseDesign({ ...doc([a]), schemaVersion: 11 });
  expect(migrated.schemaVersion).toBe(16);
  expect(Object.hasOwn(migrated.decorations[0]!, 'renderMode')).toBe(false);
  expect(Object.hasOwn(parseDesign(doc([{ ...a, renderMode: 'normal' }])).decorations[0]!, 'renderMode')).toBe(false);
  const atmosphere = parseDesign(doc([{ ...a, renderMode: 'atmosphere' }]));
  expect(atmosphere.decorations[0]!.renderMode).toBe('atmosphere');
  expect(parseDesign(JSON.parse(JSON.stringify(atmosphere)))).toStrictEqual(atmosphere);
  for (const renderMode of ['overlay', 1, null, 'Atmosphere'])
    expect(() => parseDesign(doc([{ ...a, renderMode }]))).toThrow('描画モード');
  const group = {
    kind: 'group',
    id: 'group-a',
    name: 'Group',
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    children: ['image-a', 'image-b'],
  };
  const both = [
    { ...a, renderMode: 'atmosphere' },
    { ...b, renderMode: 'atmosphere' },
  ];
  expect(parseDesign(doc(both, [{ ...group, renderMode: 'atmosphere' }])).groups![0]!.renderMode).toBe('atmosphere');
  expect(() => parseDesign(doc(both, [group]))).toThrow('同じ描画モード');
  expect(() => parseDesign(doc([both[0]!, b], [{ ...group, renderMode: 'atmosphere' }]))).toThrow('同じ描画モード');
  const committed = readDesign(freezeTree(parseDesign(doc(both, [{ ...group, renderMode: 'atmosphere' }]))));
  const edited = editDesign(committed);
  edited.decorations[1] = { ...edited.decorations[1]!, renderMode: undefined } as never;
  delete (edited.decorations[1] as { renderMode?: string }).renderMode;
  expect(() => commitDesign(edited, committed)).toThrow('同じ描画モード');
});
