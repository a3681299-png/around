import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseDesign } from '../src/design/schema';
import { commitDesign, editDesign, readDesign } from '../src/design/immutable';
import { migrateV16ToV17, migrateV17ToV18 } from '../src/design/migrations';
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
  expect(design.schemaVersion).toBe(18);
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

// --- v18: the living room (docs/living-room.md) ------------------------------------------------

const v17 = JSON.parse(readFileSync(fixtures + 'history-v17.json', 'utf8'));
const shot = { x: 0, y: 0.05, z: 1.5, fovDeg: 30, shiftX: 0, shiftY: 0, orbitDeg: 0, sway: 0.15 };
const living = {
  ...space,
  camera: { ...space.camera, shots: { top: shot, comments: { ...shot, z: -0.25 }, theater: shot }, transition: 1.6 },
  resident: { layerId: 'back', front: 0.5 },
  layout: {
    floorY: 0,
    floor: [{ x0: -2, z0: -4, x1: 2, z1: 0 }],
    spots: [{ kind: 'sit', x: 0.95, y: 0.5, z: -2.45, headingDeg: 180 }],
  },
};

test('v18 roundtrips the resident, the layout and the camera shapes; a v17 document reads unchanged', () => {
  const design = parseDesign({ ...v17, schemaVersion: 18, space: living });
  expect(design.schemaVersion).toBe(18);
  expect(design.space).toEqual(living);
  expect(parseDesign(JSON.parse(JSON.stringify(design)))).toStrictEqual(design);
  // The v17 history document: unchanged but for the version, and no v18 field appears.
  const migrated = migrateV17ToV18(v17);
  expect(migrated).toStrictEqual({ ...v17, schemaVersion: 18 });
  const read = parseDesign(v17);
  expect(Object.hasOwn(read.space!, 'resident')).toBe(false);
  expect(Object.hasOwn(read.space!, 'layout')).toBe(false);
  expect(Object.hasOwn(read.space!.camera, 'shots')).toBe(false);
});

test('a v17 or older document cannot carry the resident, the layout or the camera shapes', () => {
  expect(() => parseDesign({ ...v17, space: { ...v17.space, resident: living.resident } })).toThrow('v18');
  expect(() => parseDesign({ ...v17, space: { ...v17.space, layout: living.layout } })).toThrow('v18');
  expect(() => parseDesign({ ...v17, space: { ...v17.space, camera: living.camera } })).toThrow('v18');
  expect(() =>
    parseDesign({ ...v17, space: { ...v17.space, camera: { ...v17.space.camera, transition: 1 } } }),
  ).toThrow('v18');
});

test('v18 values are bounded numbers, fixed kinds and a layer id: no code, selectors, CSS or URLs', () => {
  const bad = (patch: object) => () => parseSpace({ ...living, ...patch });
  const camera = (patch: object) => bad({ camera: { ...living.camera, shots: { ...living.camera.shots, ...patch } } });
  expect(camera({ top: { ...shot, fovDeg: SPACE_LIMITS.fov.max + 0.1 } })).toThrow();
  expect(camera({ top: { ...shot, fovDeg: SPACE_LIMITS.fov.min - 0.1 } })).toThrow();
  expect(camera({ top: { ...shot, z: SPACE_LIMITS.shotReach + 0.01 } })).toThrow();
  expect(camera({ top: { ...shot, orbitDeg: SPACE_LIMITS.orbit + 1 } })).toThrow();
  expect(camera({ top: { ...shot, shiftX: 'calc(1px)' } })).toThrow();
  expect(camera({ top: { ...shot, matrix: [1, 0, 0, 1] } })).toThrow();
  expect(camera({ closeup: shot })).toThrow();
  expect(bad({ camera: { ...living.camera, shots: { top: shot } } })).toThrow();
  expect(bad({ camera: { ...living.camera, transition: SPACE_LIMITS.transition.max + 0.1 } })).toThrow();
  // At the limits.
  expect(
    parseSpace({
      ...living,
      camera: { ...living.camera, shots: { ...living.camera.shots, top: { ...shot, fovDeg: SPACE_LIMITS.fov.max } } },
    }).camera.shots!.top.fovDeg,
  ).toBe(SPACE_LIMITS.fov.max);
  // The resident names a layer id only.
  expect(bad({ resident: { layerId: '#movie_player', front: 0 } })).toThrow();
  expect(bad({ resident: { layerId: 'javascript:alert(1)', front: 0 } })).toThrow();
  expect(bad({ resident: { layerId: 'back', front: 1.01 } })).toThrow();
  expect(bad({ resident: { layerId: 'back', front: 0, script: 'x' } })).toThrow();
  // The layout: fixed kinds, bounded numbers, bounded counts, non-empty floor, ordered corners.
  const layout = (patch: object) => bad({ layout: { ...living.layout, ...patch } });
  expect(layout({ spots: [{ ...living.layout.spots[0], kind: 'dance' }] })).toThrow();
  expect(layout({ spots: [{ ...living.layout.spots[0], x: SPACE_LIMITS.roomReach + 1 }] })).toThrow();
  expect(layout({ spots: [{ ...living.layout.spots[0], headingDeg: 181 }] })).toThrow();
  expect(layout({ floor: [] })).toThrow();
  expect(layout({ floor: [{ x0: 1, z0: 0, x1: 0, z1: 1 }] })).toThrow();
  expect(layout({ spots: Array.from({ length: SPACE_LIMITS.spots + 1 }, () => living.layout.spots[0]) })).toThrow();
  expect(
    parseSpace({
      ...living,
      layout: { ...living.layout, spots: Array.from({ length: SPACE_LIMITS.spots }, () => living.layout.spots[0]) },
    }).layout!.spots,
  ).toHaveLength(SPACE_LIMITS.spots);
  expect(layout({ floor: Array.from({ length: SPACE_LIMITS.floor + 1 }, () => living.layout.floor[0]) })).toThrow();
});
