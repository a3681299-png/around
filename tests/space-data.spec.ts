import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { commitDesign, editDesign, readDesign } from '../src/design/immutable';
import { migrateV16ToV17 } from '../src/design/migrations';
import { designAssetIds } from '../src/design/references';
import { DEFAULT_SPACE_LOOK, SPACE_LIMITS, parseSpace } from '../src/design/space';

const fixtures = 'tests/fixtures/designs/';
/** The version before the depth foundation (v16, Mirdo's motion hips height). */
const previous = JSON.parse(readFileSync(fixtures + 'history-v16.json', 'utf8'));
const room = 'asset-' + 'a'.repeat(64);
const space = { ...DEFAULT_SPACE_LOOK, room: { assetId: room } };
const image = JSON.parse(readFileSync(fixtures + 'v3.json', 'utf8')).decorations[0];
const current = (extra: object = {}) => ({ ...previous, schemaVersion: 17, ...extra });

test('v17 roundtrips the space and a room-depth layer; omission keeps every layer in front', () => {
  const design = parseDesign(
    current({
      space,
      decorations: [
        { ...image, id: 'back', depth: 'room' },
        { ...image, id: 'front' },
      ],
    }),
  );
  expect(design.schemaVersion).toBe(17);
  expect(design.space).toEqual(space);
  expect(design.decorations[0]!.depth).toBe('room');
  expect(Object.hasOwn(design.decorations[1]!, 'depth')).toBe(false);
  expect(parseDesign(JSON.parse(JSON.stringify(design)))).toStrictEqual(design);
  // An edit that keeps the space keeps it; one that drops it drops it.
  const read = readDesign(design);
  expect(commitDesign(editDesign(read), read)).toBe(read);
  const without = commitDesign({ ...editDesign(read), space: undefined } as never, read);
  expect(Object.hasOwn(without, 'space')).toBe(false);
});

test('the v16 history document migrates to v17 unchanged but for the version', () => {
  const migrated = migrateV16ToV17(previous);
  expect(migrated).toStrictEqual({ ...previous, schemaVersion: 17 });
  expect(Object.hasOwn(parseDesign(previous), 'space')).toBe(false);
});

test('a v16 or older document cannot carry the space or a depth', () => {
  expect(() => parseDesign({ ...previous, space })).toThrow();
  expect(() => parseDesign({ ...previous, decorations: [{ ...previous.decorations[0], depth: 'room' }] })).toThrow();
  const v3 = JSON.parse(readFileSync(fixtures + 'v3.json', 'utf8'));
  expect(() => parseDesign({ ...v3, space })).toThrow();
  expect(() => parseDesign({ ...v3, decorations: [{ ...image, depth: 'room' }] })).toThrow();
});

test('the room is a referenced asset: kept alive with the artwork', () => {
  expect(designAssetIds(parseDesign(current({ space })))).toContain(room);
});

test('a group and its layers share one depth', () => {
  const group = {
    kind: 'group',
    id: 'g',
    name: 'G',
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    children: ['a'],
  };
  expect(() => parseDesign(current({ decorations: [{ ...image, id: 'a', depth: 'room' }], groups: [group] }))).toThrow(
    '同じ奥行き',
  );
  expect(
    parseDesign(current({ decorations: [{ ...image, id: 'a', depth: 'room' }], groups: [{ ...group, depth: 'room' }] }))
      .groups![0]!.depth,
  ).toBe('room');
});

test('the space takes names and bounded numbers only: no code, selectors, CSS or URLs', () => {
  const bad = (patch: object) => () => parseSpace({ ...space, ...patch });
  // Executable or foreign strings anywhere a value goes.
  expect(bad({ room: { assetId: 'javascript:alert(1)' } })).toThrow();
  expect(bad({ room: { assetId: 'https://example.com/room.glb' } })).toThrow();
  expect(bad({ room: { assetId: room, url: 'data:model/gltf-binary;base64,' } })).toThrow();
  expect(bad({ lights: { 'room_desk;}body{display:none': 1 } })).toThrow();
  expect(bad({ lights: { '#movie_player': 1 } })).toThrow();
  expect(bad({ lights: { sun_night: 'calc(100%)' } })).toThrow();
  expect(bad({ glass: { ...space.glass, shader: 'void main(){}' } })).toThrow();
  expect(bad({ camera: { ...space.camera, sway: Number.NaN } })).toThrow();
  expect(bad({ unknown: 1 })).toThrow();
  // Bounds, at the limits and one past them.
  expect(parseSpace({ ...space, lights: { sun_night: SPACE_LIMITS.weight } }).lights['sun_night']).toBe(
    SPACE_LIMITS.weight,
  );
  expect(bad({ lights: { sun_night: SPACE_LIMITS.weight + 0.001 } })).toThrow();
  expect(bad({ lights: { sun_night: -0.001 } })).toThrow();
  expect(parseSpace({ ...space, videoLight: SPACE_LIMITS.videoLight }).videoLight).toBe(SPACE_LIMITS.videoLight);
  expect(bad({ videoLight: SPACE_LIMITS.videoLight + 0.01 })).toThrow();
  expect(bad({ camera: { ...space.camera, follow: SPACE_LIMITS.follow.min - 0.01 } })).toThrow();
  expect(bad({ camera: { ...space.camera, sway: 1.01 } })).toThrow();
  expect(bad({ glass: { ...space.glass, blur: -0.1 } })).toThrow();
  const many = Object.fromEntries(Array.from({ length: SPACE_LIMITS.lights }, (_, i) => [`room_l${i}`, 1]));
  expect(Object.keys(parseSpace({ ...space, lights: many }).lights)).toHaveLength(SPACE_LIMITS.lights);
  expect(bad({ lights: { ...many, sun_noon: 1 } })).toThrow();
  // The asset contract's names are accepted.
  for (const name of [
    'sun_morning',
    'sun_noon',
    'sun_evening',
    'sun_night',
    'room',
    'room_floor',
    'screen',
    'screen_monitor',
  ])
    expect(parseSpace({ ...space, lights: { [name]: 1 } }).lights[name]).toBe(1);
  // A depth is room or omitted.
  expect(() => parseDesign(current({ decorations: [{ ...image, depth: 'front' }] }))).toThrow();
  expect(() => parseDesign(current({ decorations: [{ ...image, depth: 'behind' }] }))).toThrow();
});
