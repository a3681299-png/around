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
export const SPACE_LIMITS = Object.freeze({ lights: 16, weight: 4, follow: { min: 0.1, max: 4 }, videoLight: 2 });

export interface SpaceGlass {
  /** 0–1 each: frosted blur, edge refraction, rim highlight, tint from the room, the plates' shadow on the room. */
  blur: number;
  refraction: number;
  highlight: number;
  tint: number;
  shadow: number;
}
export interface SpaceCameraLook {
  /** 0–1: share of the room's measured camera range (world/space.ts ROOM_CAMERA_RANGE). */
  sway: number;
  dolly: number;
  /** Seconds to follow the signals. */
  follow: number;
}
export interface DesignSpace {
  room: { assetId: string };
  /** Weight per light layer, 0–4. A layer the room has but the artwork does not name is off. */
  lights: Readonly<Record<string, number>>;
  camera: SpaceCameraLook;
  glass: SpaceGlass;
  /** 0–2: how strongly the video lights the room and the plates' rims. */
  videoLight: number;
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

/** Rebuilds a trusted space from untrusted input; unknown keys and out-of-range values are refused. */
export function parseSpace(value: unknown): DesignSpace {
  const data = record(value, ['room', 'lights', 'camera', 'glass', 'videoLight']);
  const room = record(data['room'], ['assetId']);
  if (!isAssetId(room['assetId'])) throw new Error('部屋の素材の参照が不正です。');
  const lightsInput = record(data['lights'], Object.keys((data['lights'] as object | null) ?? {}));
  const names = Object.keys(lightsInput);
  if (names.length > SPACE_LIMITS.lights || names.some((name) => !ROOM_LIGHT_LAYER.test(name)))
    throw new Error('光の層の名前が不正です。');
  const lights: Record<string, number> = {};
  for (const name of names.sort()) lights[name] = number(lightsInput[name], 0, SPACE_LIMITS.weight);
  const camera = record(data['camera'], ['sway', 'dolly', 'follow']);
  const glass = record(data['glass'], ['blur', 'refraction', 'highlight', 'tint', 'shadow']);
  return {
    room: { assetId: room['assetId'] },
    lights,
    camera: {
      sway: number(camera['sway'], 0, 1),
      dolly: number(camera['dolly'], 0, 1),
      follow: number(camera['follow'], SPACE_LIMITS.follow.min, SPACE_LIMITS.follow.max),
    },
    glass: {
      blur: number(glass['blur'], 0, 1),
      refraction: number(glass['refraction'], 0, 1),
      highlight: number(glass['highlight'], 0, 1),
      tint: number(glass['tint'], 0, 1),
      shadow: number(glass['shadow'], 0, 1),
    },
    videoLight: number(data['videoLight'], 0, SPACE_LIMITS.videoLight),
  };
}
