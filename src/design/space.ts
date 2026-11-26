/**
 * The artwork's space (DesignDocument v17, docs/depth-foundation.md): which room is behind the UI
 * and the numbers of the engine's fixed effects — the light layers' weights, the camera's
 * movement, the glass plates' look, the video's light. No shader, no selector, no CSS: names of
 * the asset contract's light layers and bounded numbers only.
 */
// The same form as schema.ts isAssetId; schema.ts imports this module, so it is not imported back.
const isAssetId = (value: unknown): value is string => typeof value === 'string' && /^asset-[a-f0-9]{64}$/.test(value);

/** Light layer names from the room asset contract (部屋の素材の約束): sun_<time>, room and
 * room_<lamp>, screen, screen_monitor. */
export const ROOM_LIGHT_LAYER = /^(sun_(morning|noon|evening|night)|room(_[a-z0-9]{1,16})?|screen|screen_monitor)$/;
export const SPACE_LIMITS = Object.freeze({
  lights: 16,
  weight: 4,
  follow: { min: 0.1, max: 4 },
  videoLight: 2,
  /** Metres from camera_main a shape may stand (a room built larger shows no outside further out). */
  shotReach: 6,
  fov: { min: 10, max: 100 },
  shift: 1,
  orbit: 30,
  transition: { min: 0.2, max: 6 },
  /** Metres from the room's origin a place or a floor corner may be. */
  roomReach: 50,
  spots: 32,
  floor: 32,
});

export interface SpaceGlass {
  /** 0–1 each: frosted blur, edge refraction, rim highlight, tint from the room, the plates' shadow on the room. */
  blur: number;
  refraction: number;
  highlight: number;
  tint: number;
  shadow: number;
}
/** A camera shape (v18, world/camera-shots.ts): metres from camera_main in its own axes (z back),
 * the vertical field of view, the lens shift (fractions of the half frame), a turn about the
 * room's middle and how far the pointer sways it. */
export interface SpaceShot {
  x: number;
  y: number;
  z: number;
  fovDeg: number;
  shiftX: number;
  shiftY: number;
  orbitDeg: number;
  sway: number;
}
export interface SpaceCameraLook {
  /** 0–1: share of the room's measured camera range (world/space.ts ROOM_CAMERA_RANGE). */
  sway: number;
  dolly: number;
  /** Seconds to follow the signals. */
  follow: number;
  /** v18: the shapes per page state. With them, sway and dolly above are not used: the shapes say
   * everything (each its own pointer sway); without them the camera moves as in v17. */
  shots?: { top: SpaceShot; comments: SpaceShot; theater: SpaceShot };
  /** v18: seconds a change of shape takes (default 1.6). */
  transition?: number;
}
/** v18: a place in the room (metres, the room's own axes, y up); the heading in degrees about y. */
export interface SpaceSpot {
  kind: 'sit' | 'hide' | 'stand';
  x: number;
  y: number;
  z: number;
  headingDeg: number;
}
/** v18: the room's layout given by the artwork (it replaces the room asset's own markers and
 * walkable floor): floor rectangles on the floor plane and places. */
export interface SpaceLayout {
  floorY: number;
  floor: readonly { x0: number; z0: number; x1: number; z1: number }[];
  spots: readonly SpaceSpot[];
}
/** v18: the character that lives in the room: a 3D layer of the artwork (by id) with a character. */
export interface SpaceResident {
  layerId: string;
  /** 0–1: how readily it comes to the front of the UI while the room is hidden (0 never). */
  front: number;
}
export interface DesignSpace {
  room: { assetId: string };
  /** Weight per light layer, 0–4. A layer the room has but the artwork does not name is off. */
  lights: Readonly<Record<string, number>>;
  camera: SpaceCameraLook;
  glass: SpaceGlass;
  /** 0–2: how strongly the video lights the room and the plates' rims. */
  videoLight: number;
  resident?: SpaceResident;
  layout?: SpaceLayout;
}
/** What the room renderer draws with (the space minus the asset reference). */
export type RoomLook = Pick<DesignSpace, 'lights' | 'glass' | 'videoLight'>;

export const DEFAULT_SPACE_LOOK: Omit<DesignSpace, 'room'> = Object.freeze({
  lights: Object.freeze({ sun_night: 1, room_desk: 1, room_pendant: 0.6, screen: 0.5, screen_monitor: 0.8 }),
  camera: Object.freeze({ sway: 1, dolly: 0.6, follow: 0.8 }),
  glass: Object.freeze({ blur: 0.7, refraction: 0.6, highlight: 0.6, tint: 0.5, shadow: 0.6 }),
  videoLight: 1,
});

type Data = Record<string, unknown>;
const record = (value: unknown, fields: readonly string[]): Data => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('空間の設定の形式が不正です。');
  return value as Data;
};
const number = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('空間の設定の値が範囲外です。');
  return value;
};

const SHOT_KEYS = ['x', 'y', 'z', 'fovDeg', 'shiftX', 'shiftY', 'orbitDeg', 'sway'] as const;
function parseShot(value: unknown): SpaceShot {
  const s = record(value, SHOT_KEYS);
  const L = SPACE_LIMITS;
  return {
    x: number(s['x'], -L.shotReach, L.shotReach),
    y: number(s['y'], -L.shotReach, L.shotReach),
    z: number(s['z'], -L.shotReach, L.shotReach),
    fovDeg: number(s['fovDeg'], L.fov.min, L.fov.max),
    shiftX: number(s['shiftX'], -L.shift, L.shift),
    shiftY: number(s['shiftY'], -L.shift, L.shift),
    orbitDeg: number(s['orbitDeg'], -L.orbit, L.orbit),
    sway: number(s['sway'], 0, 1),
  };
}
const list = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max) throw new Error('空間の設定の形式が不正です。');
  return value as unknown[];
};
function parseLayout(value: unknown): SpaceLayout {
  const data = record(value, ['floorY', 'floor', 'spots']);
  const R = SPACE_LIMITS.roomReach;
  const floor = list(data['floor'], SPACE_LIMITS.floor).map((item) => {
    const r = record(item, ['x0', 'z0', 'x1', 'z1']);
    const out = {
      x0: number(r['x0'], -R, R),
      z0: number(r['z0'], -R, R),
      x1: number(r['x1'], -R, R),
      z1: number(r['z1'], -R, R),
    };
    if (out.x1 <= out.x0 || out.z1 <= out.z0) throw new Error('空間の設定の値が範囲外です。');
    return out;
  });
  if (!floor.length) throw new Error('空間の設定の形式が不正です。');
  const spots = list(data['spots'], SPACE_LIMITS.spots).map((item) => {
    const r = record(item, ['kind', 'x', 'y', 'z', 'headingDeg']);
    if (r['kind'] !== 'sit' && r['kind'] !== 'hide' && r['kind'] !== 'stand')
      throw new Error('空間の設定の形式が不正です。');
    return {
      kind: r['kind'],
      x: number(r['x'], -R, R),
      y: number(r['y'], -R, R),
      z: number(r['z'], -R, R),
      headingDeg: number(r['headingDeg'], -180, 180),
    } satisfies SpaceSpot;
  });
  return { floorY: number(data['floorY'], -R, R), floor, spots };
}

/** Rebuilds a trusted space from untrusted input; unknown keys and out-of-range values are refused. */
export function parseSpace(value: unknown): DesignSpace {
  const data = record(value, ['room', 'lights', 'camera', 'glass', 'videoLight', 'resident', 'layout']);
  const room = record(data['room'], ['assetId']);
  if (!isAssetId(room['assetId'])) throw new Error('部屋の素材の参照が不正です。');
  const lightsInput = record(data['lights'], Object.keys((data['lights'] as object | null) ?? {}));
  const names = Object.keys(lightsInput);
  if (names.length > SPACE_LIMITS.lights || names.some((name) => !ROOM_LIGHT_LAYER.test(name)))
    throw new Error('光の層の名前が不正です。');
  const lights: Record<string, number> = {};
  for (const name of names.sort()) lights[name] = number(lightsInput[name], 0, SPACE_LIMITS.weight);
  const camera = record(data['camera'], ['sway', 'dolly', 'follow', 'shots', 'transition']);
  const glass = record(data['glass'], ['blur', 'refraction', 'highlight', 'tint', 'shadow']);
  const shots = Object.hasOwn(camera, 'shots') ? record(camera['shots'], ['top', 'comments', 'theater']) : undefined;
  let resident: SpaceResident | undefined;
  if (Object.hasOwn(data, 'resident')) {
    const r = record(data['resident'], ['layerId', 'front']);
    if (typeof r['layerId'] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(r['layerId']))
      throw new Error('部屋の住人の参照が不正です。');
    resident = { layerId: r['layerId'], front: number(r['front'], 0, 1) };
  }
  return {
    room: { assetId: room['assetId'] },
    lights,
    camera: {
      sway: number(camera['sway'], 0, 1),
      dolly: number(camera['dolly'], 0, 1),
      follow: number(camera['follow'], SPACE_LIMITS.follow.min, SPACE_LIMITS.follow.max),
      ...(shots
        ? {
            shots: {
              top: parseShot(shots['top']),
              comments: parseShot(shots['comments']),
              theater: parseShot(shots['theater']),
            },
          }
        : {}),
      ...(Object.hasOwn(camera, 'transition')
        ? { transition: number(camera['transition'], SPACE_LIMITS.transition.min, SPACE_LIMITS.transition.max) }
        : {}),
    },
    glass: {
      blur: number(glass['blur'], 0, 1),
      refraction: number(glass['refraction'], 0, 1),
      highlight: number(glass['highlight'], 0, 1),
      tint: number(glass['tint'], 0, 1),
      shadow: number(glass['shadow'], 0, 1),
    },
    videoLight: number(data['videoLight'], 0, SPACE_LIMITS.videoLight),
    ...(resident ? { resident } : {}),
    ...(Object.hasOwn(data, 'layout') ? { layout: parseLayout(data['layout']) } : {}),
  };
}
