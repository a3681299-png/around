import { oneOf } from '../validation';

/** Data only. Node/clip indices refer to the immutable GLB asset. */
export interface ModelInfo {
  format: 'glb' | 'vrm';
  vrm?: VrmInfo;
  clips: { name: string; duration: number }[];
  bones: { node: number; name: string }[];
  vertices: number;
  triangles: number;
  textureBytes: number;
}
export interface VrmInfo {
  version: '1.0' | '0.x';
  humanoid: { bone: string; node: number }[];
  expressions: string[];
  lookAt: boolean;
  springBone: boolean;
  mtoon: boolean;
}
export interface VrmSettings {
  lookAt: boolean;
  headFollow: boolean;
  springBone: boolean;
  expressions: Record<string, number>;
}
export interface ModelSettings {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  clip: number | null;
  playing: boolean;
  loop: boolean;
  speed: number;
  crossFadeMs: number;
  inPlace: boolean;
  locomotion: {
    enabled: boolean;
    idle: number | null;
    walk: number | null;
    run: number | null;
    walkSpeed: number;
    runSpeed: number;
    faceMovement: boolean;
    forwardDeg: number;
  };
  look: { enabled: boolean; bone: number | null; yawLimit: number; pitchLimit: number; lagMs: number };
  vrm?: VrmSettings;
}
export const MODEL_LIMITS = Object.freeze({
  count: 8,
  nodes: 2048,
  vertices: 1_000_000,
  triangles: 1_000_000,
  textureBytes: 64 * 1024 * 1024,
  clips: 64,
  bones: 512,
});
export function defaultModelSettings(info: ModelInfo): ModelSettings {
  return {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    clip: info.clips.length ? 0 : null,
    playing: true,
    loop: true,
    speed: 1,
    crossFadeMs: 250,
    inPlace: true,
    locomotion: {
      enabled: false,
      idle: null,
      walk: null,
      run: null,
      walkSpeed: 10,
      runSpeed: 220,
      faceMovement: true,
      forwardDeg: 0,
    },
    look: {
      enabled: info.format === 'vrm',
      bone: info.vrm?.humanoid.find((b) => b.bone === 'head')?.node ?? null,
      yawLimit: 50,
      pitchLimit: 30,
      lagMs: 160,
    },
    ...(info.vrm
      ? { vrm: { lookAt: info.vrm.lookAt, headFollow: true, springBone: info.vrm.springBone, expressions: {} } }
      : {}),
  };
}
export function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('3D設定の形式が不正です。');
  return value as Record<string, unknown>;
}
export function numeric(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('3D設定の値が範囲外です。');
  return value;
}
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw new Error('3D設定が不正です。');
  return v;
};
const label = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 120 || /[\u0000-\u001f]/.test(v)) throw new Error('3D素材名が不正です。');
  return v;
};
export function parseModelInfo(value: unknown): ModelInfo {
  const v = object(value, ['format', 'vrm', 'clips', 'bones', 'vertices', 'triangles', 'textureBytes']);
  if (
    !oneOf(v['format'], ['glb', 'vrm']) ||
    !Array.isArray(v['clips']) ||
    v['clips'].length > MODEL_LIMITS.clips ||
    !Array.isArray(v['bones']) ||
    v['bones'].length > MODEL_LIMITS.bones
  )
    throw new Error('3D素材情報が不正です。');
  const clips = v['clips'].map((c) => {
    const e = object(c, ['name', 'duration']);
    return { name: label(e['name']), duration: numeric(e['duration'], 0, 86400) };
  });
  const bones = v['bones'].map((b) => {
    const e = object(b, ['node', 'name']),
      node = numeric(e['node'], 0, MODEL_LIMITS.nodes - 1);
    if (!Number.isInteger(node)) throw new Error('ボーン参照が不正です。');
    return { node, name: label(e['name']) };
  });
  if (new Set(bones.map((b) => b.node)).size !== bones.length) throw new Error('ボーンが重複しています。');
  let vrm: VrmInfo | undefined;
  if (v['format'] === 'vrm') {
    const r = object(v['vrm'], ['version', 'humanoid', 'expressions', 'lookAt', 'springBone', 'mtoon']);
    if (
      !oneOf(r['version'], ['1.0', '0.x']) ||
      !Array.isArray(r['humanoid']) ||
      r['humanoid'].length > 64 ||
      !Array.isArray(r['expressions']) ||
      r['expressions'].length > 128
    )
      throw new Error('VRM情報が不正です。');
    const humanoid = r['humanoid'].map((b) => {
      const x = object(b, ['bone', 'node']);
      const node = numeric(x['node'], 0, MODEL_LIMITS.nodes - 1);
      if (!Number.isInteger(node) || !bones.some((b) => b.node === node)) throw new Error('Humanoid参照が不正です。');
      return { bone: label(x['bone']), node };
    });
    const expressions = r['expressions'].map(label);
    if (
      new Set(humanoid.map((b) => b.bone)).size !== humanoid.length ||
      new Set(expressions).size !== expressions.length
    )
      throw new Error('VRM情報が重複しています。');
    vrm = {
      version: r['version'] as VrmInfo['version'],
      humanoid,
      expressions,
      lookAt: bool(r['lookAt']),
      springBone: bool(r['springBone']),
      mtoon: bool(r['mtoon']),
    };
  } else if (v['vrm'] !== undefined) throw new Error('GLBにVRM情報は指定できません。');
  return {
    format: v['format'] as ModelInfo['format'],
    ...(vrm ? { vrm } : {}),
    clips,
    bones,
    vertices: numeric(v['vertices'], 0, MODEL_LIMITS.vertices),
    triangles: numeric(v['triangles'], 0, MODEL_LIMITS.triangles),
    textureBytes: numeric(v['textureBytes'], 0, MODEL_LIMITS.textureBytes),
  };
}
export function parseModelSettings(value: unknown, info: ModelInfo): ModelSettings {
  const v = object(value, [
    'rotationX',
    'rotationY',
    'rotationZ',
    'clip',
    'playing',
    'loop',
    'speed',
    'crossFadeMs',
    'inPlace',
    'locomotion',
    'look',
    'vrm',
  ]);
  let vrm: VrmSettings | undefined;
  if (info.vrm) {
    const r = object(v['vrm'] ?? defaultModelSettings(info).vrm, ['lookAt', 'headFollow', 'springBone', 'expressions']);
    const expressions = object(r['expressions'], info.vrm.expressions);
    vrm = {
      lookAt: bool(r['lookAt']),
      headFollow: bool(r['headFollow']),
      springBone: bool(r['springBone']),
      expressions: Object.fromEntries(Object.entries(expressions).map(([key, value]) => [key, numeric(value, 0, 1)])),
    };
  } else if (v['vrm'] !== undefined) throw new Error('VRM以外にVRM設定は指定できません。');
  const clip = (c: unknown) => {
    if (c === null) return null;
    const n = numeric(c, 0, info.clips.length - 1);
    if (!Number.isInteger(n)) throw new Error('クリップ参照が不正です。');
    return n;
  };
  const l = object(v['locomotion'], [
    'enabled',
    'idle',
    'walk',
    'run',
    'walkSpeed',
    'runSpeed',
    'faceMovement',
    'forwardDeg',
  ]);
  const look = object(v['look'], ['enabled', 'bone', 'yawLimit', 'pitchLimit', 'lagMs']);
  const bone = look['bone'];
  if (bone !== null && !info.bones.some((b) => b.node === bone)) throw new Error('ボーン参照が不正です。');
  const walkSpeed = numeric(l['walkSpeed'], 0.1, 10000),
    runSpeed = numeric(l['runSpeed'], 0.1, 10000);
  if (runSpeed < walkSpeed) throw new Error('走る速度は歩く速度以上にしてください。');
  return {
    rotationX: numeric(v['rotationX'], -180, 180),
    rotationY: numeric(v['rotationY'], -180, 180),
    rotationZ: numeric(v['rotationZ'], -180, 180),
    clip: clip(v['clip']),
    playing: bool(v['playing']),
    loop: bool(v['loop']),
    speed: numeric(v['speed'], 0.1, 4),
    crossFadeMs: numeric(v['crossFadeMs'], 0, 5000),
    inPlace: bool(v['inPlace']),
    locomotion: {
      enabled: bool(l['enabled']),
      idle: clip(l['idle']),
      walk: clip(l['walk']),
      run: clip(l['run']),
      walkSpeed,
      runSpeed,
      faceMovement: bool(l['faceMovement']),
      forwardDeg: numeric(l['forwardDeg'], -180, 180),
    },
    look: {
      enabled: bool(look['enabled']),
      bone: bone as number | null,
      yawLimit: numeric(look['yawLimit'], 0, 90),
      pitchLimit: numeric(look['pitchLimit'], 0, 80),
      lagMs: numeric(look['lagMs'], 0, 5000),
    },
    ...(vrm ? { vrm } : {}),
  };
}

export type ModelPatch = Partial<Omit<ModelSettings, 'locomotion' | 'look' | 'vrm'>> & {
  locomotion?: Partial<ModelSettings['locomotion']>;
  look?: Partial<ModelSettings['look']>;
  vrm?: Partial<VrmSettings>;
};
export function patchModel(model: ModelSettings, patch: ModelPatch | undefined, source: ModelInfo): ModelSettings {
  return parseModelSettings(
    {
      ...model,
      ...patch,
      locomotion: { ...model.locomotion, ...patch?.locomotion },
      look: { ...model.look, ...patch?.look },
      ...(model.vrm
        ? {
            vrm: { ...model.vrm, ...patch?.vrm, expressions: { ...model.vrm.expressions, ...patch?.vrm?.expressions } },
          }
        : {}),
    },
    source,
  );
}
