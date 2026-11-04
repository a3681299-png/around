import { ASSET_LIMITS, ASSET_MESSAGES } from '../assets/limits';
import { IMAGE_LIMITS } from './types';

// Intermediate objects are untrusted. Only schema.ts's final v14 validation may
// produce a DesignDocument; migration never grants immutable.ts's validated mark.
type Data = Record<string, unknown>;
interface Shape {
  root: readonly string[];
  layer?: readonly string[];
  kinds?: readonly string[];
  group?: readonly string[];
  rule?: readonly string[];
}
const root1 = ['schemaVersion', 'id', 'siteId', 'baseThemeId', 'rules'];
const root2 = [...root1, 'decorations'];
const root6 = [...root2, 'groups'];
const root8 = [...root6, 'signalRules'];
const layer2 = ['kind', 'id', 'assetId', 'name', 'placement', 'opacity', 'zIndex', 'visible'];
const layer3 = [...layer2, 'locked'];
const layer4 = [...layer3, 'format', 'playback'];
const layer5 = [...layer4, 'effects'];
const layer9 = [...layer5, 'motion'];
const layer10 = [...layer9, 'model', 'source'];
const group6 = ['kind', 'id', 'name', 'opacity', 'zIndex', 'visible', 'locked', 'effects', 'children'];
const group9 = [...group6, 'motion'];
const layer12 = [...layer10, 'renderMode'];
const group12 = [...group9, 'renderMode'];
const rule1 = ['kind', 'target', 'style'];
const rule13 = [...rule1, 'skin'];
const images = ['image'];
const media = [...images, 'animation'];
const models = [...media, 'model3d'];

function record(value: unknown, fields?: readonly string[]): Data {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (fields && Object.keys(value).some((key) => !fields.includes(key)))
  )
    throw new Error('デザインの形式が不正です。');
  return value as Data;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('デザインの形式が不正です。');
  return value;
}
/** Check only historical gates here. Required fields, ranges and references are
 * checked once, against the final schema, after the entire chain. */
function stage(value: unknown, version: number, shape: Shape): Data {
  const data = record(value, shape.root);
  if (data['schemaVersion'] !== version) throw new Error('移行元のバージョンが不正です。');
  if (shape.layer) {
    const decorations = list(data['decorations']);
    if (decorations.length > IMAGE_LIMITS.count) throw new Error(ASSET_MESSAGES.layerCount);
    for (const value of decorations) {
      const layer = record(value, shape.layer);
      if (!shape.kinds?.includes(layer['kind'] as string)) throw new Error('素材レイヤーの形式が不正です。');
    }
  }
  if (Object.hasOwn(data, 'groups')) for (const group of list(data['groups'])) record(group, shape.group);
  if (shape.rule) for (const rule of list(data['rules'])) record(rule, shape.rule);
  return data;
}
const next = (data: Data, version: number): Data => ({ ...data, schemaVersion: version });
function legacyPlayback(data: Data): void {
  const animations = list(data['decorations'])
    .map((layer) => record(layer))
    .filter((layer) => layer['kind'] === 'animation');
  if (animations.length > ASSET_LIMITS.legacyAnimationCount) throw new Error(ASSET_MESSAGES.legacyAnimationCount);
  for (const layer of animations) {
    if (!['gif', 'animated-webp', 'lottie'].includes(layer['format'] as string))
      throw new Error('未対応のアニメーション形式です。');
    const playback = record(layer['playback'], ['playing', 'loop', 'speed']);
    if (layer['format'] !== 'lottie' && playback['speed'] !== 1)
      throw new Error('再生速度はLottieでのみ変更できます。');
  }
}

export function migrateV1ToV2(value: unknown): Data {
  const data = stage(value, 1, { root: root1 });
  return { ...next(data, 2), decorations: [] };
}
export function migrateV2ToV3(value: unknown): Data {
  const data = stage(value, 2, { root: root2, layer: layer2, kinds: images });
  return {
    ...next(data, 3),
    decorations: list(data['decorations']).map((layer) => ({ ...record(layer), locked: false })),
  };
}
export function migrateV3ToV4(value: unknown): Data {
  return next(stage(value, 3, { root: root2, layer: layer3, kinds: images }), 4);
}
export function migrateV4ToV5(value: unknown): Data {
  const data = stage(value, 4, { root: root2, layer: layer4, kinds: media });
  legacyPlayback(data);
  return next(data, 5);
}
export function migrateV5ToV6(value: unknown): Data {
  const data = stage(value, 5, { root: root2, layer: layer5, kinds: media });
  legacyPlayback(data);
  return next(data, 6);
}
export function migrateV6ToV7(value: unknown): Data {
  const data = stage(value, 6, { root: root6, layer: layer5, kinds: media, group: group6 });
  legacyPlayback(data);
  return next(data, 7);
}
export function migrateV7ToV8(value: unknown): Data {
  return next(stage(value, 7, { root: root6, layer: layer5, kinds: media, group: group6 }), 8);
}
export function migrateV8ToV9(value: unknown): Data {
  const data = stage(value, 8, { root: root8, layer: layer5, kinds: media, group: group6 });
  if (Object.hasOwn(data, 'signalRules'))
    for (const value of list(data['signalRules'])) {
      const rule = record(value),
        source = record(rule['source']),
        target = record(rule['target']);
      if (
        source['signal'] !== 'page.scroll.progress' ||
        source['space'] !== 'page' ||
        source['axis'] !== 'y' ||
        !Array.isArray(source['inputRange']) ||
        source['inputRange'].some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) ||
        target['property'] !== 'opacity'
      )
        throw new Error('v8以前のルールはスクロール進捗による不透明度の変更です。');
    }
  return next(data, 9);
}
export function migrateV9ToV10(value: unknown): Data {
  return next(stage(value, 9, { root: root8, layer: layer9, kinds: media, group: group9 }), 10);
}
export function migrateV10ToV11(value: unknown): Data {
  const data = stage(value, 10, { root: root8, layer: layer10, kinds: models, group: group9 });
  for (const value of list(data['decorations'])) {
    const layer = record(value);
    if (layer['kind'] !== 'model3d') continue;
    const source = record(layer['source']);
    if (source['format'] === 'vrm' || source['vrm'] !== undefined)
      throw new Error('VRMにはDesignDocument v11が必要です。');
  }
  return next(data, 11);
}

export function migrateV11ToV12(value: unknown): Data {
  // renderMode is new in v12; every earlier layer keeps normal rendering by omission.
  return next(stage(value, 11, { root: root8, layer: layer10, kinds: models, group: group9 }), 12);
}

export function migrateV12ToV13(value: unknown): Data {
  // Rules pass unchanged through every earlier step, so this gate covers v1–v12:
  // skin is new in v13 and every earlier rule keeps its native look by omission.
  return next(stage(value, 12, { root: root8, layer: layer12, kinds: models, group: group12, rule: rule1 }), 13);
}

export function migrateV13ToV14(value: unknown): Data {
  // Layers and source facts pass unchanged through every earlier step, so this gate covers
  // v1–v13: a character and a measured body are new in v14; older VRM layers keep their own
  // clips and simply have no measure.
  const data = stage(value, 13, { root: root8, layer: layer12, kinds: models, group: group12, rule: rule13 });
  for (const value of list(data['decorations'])) {
    const layer = record(value);
    if (layer['kind'] !== 'model3d' || layer['source'] === undefined) continue;
    const vrm = record(layer['source'])['vrm'];
    if (vrm !== undefined && Object.hasOwn(record(vrm), 'body'))
      throw new Error('体型の測定にはDesignDocument v14が必要です。');
  }
  return next(data, 14);
}

export const DESIGN_MIGRATIONS = Object.freeze([
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
  migrateV11ToV12,
  migrateV12ToV13,
  migrateV13ToV14,
]);

/** Pure chain; a returned v14 object is still unvalidated external input. */
export function migrateDesign(value: unknown): Data {
  let data = record(value);
  const version = data['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 14)
    throw new Error('このデザインのバージョンには対応していません。');
  for (let from = version; from < 14; from++) data = DESIGN_MIGRATIONS[from - 1]!(data);
  return data;
}
