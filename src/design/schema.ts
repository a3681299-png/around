import {
  GROUP_LIMITS,
  IMAGE_LIMITS,
  STYLE_LIMITS,
  type DesignDocument,
  type SurfaceStyle,
  type Decoration,
  type PlacementAnchor,
  type GroupLayer,
} from './types';
import { MODEL_LIMITS, parseModelInfo, parseModelSettings } from '../models/types';
import { ASSET_LIMITS, ASSET_MESSAGES } from '../assets/limits';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { parseEffects } from '../effects/schema';
import { sameAnchor } from './hierarchy';
import { parseMotion } from '../signals/motion';
import { parseSignalRules } from '../signals/keyframe-schema';

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^asset-[a-f0-9]{64}$/.test(value);
}

export function isDesignId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw new Error('デザインの形式が不正です。');
  }
  return value as Record<string, unknown>;
}

function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) {
    throw new Error('色は6桁のHEXで指定してください。');
  }
  return value.toLowerCase();
}

function pixels(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`大きさは0〜${max}pxの整数で指定してください。`);
  }
  return value;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('画像の配置値が範囲外です。');
  return value;
}

function group(value: unknown, version: number): GroupLayer {
  const input = record(value, [
    'kind',
    'id',
    'name',
    'opacity',
    'zIndex',
    'visible',
    'locked',
    'effects',
    'children',
    ...(version >= 9 ? ['motion'] : []),
  ]);
  if (
    input['kind'] !== 'group' ||
    !isDesignId(input['id']) ||
    typeof input['name'] !== 'string' ||
    !input['name'].length ||
    input['name'].length > 120 ||
    /[\u0000-\u001f]/.test(input['name']) ||
    typeof input['visible'] !== 'boolean' ||
    typeof input['locked'] !== 'boolean' ||
    !Array.isArray(input['children']) ||
    !input['children'].length ||
    input['children'].length > IMAGE_LIMITS.count ||
    !input['children'].every(isDesignId) ||
    new Set(input['children']).size !== input['children'].length
  )
    throw new Error('グループの形式が不正です。');
  const zIndex = number(input['zIndex'], -IMAGE_LIMITS.maxZ, IMAGE_LIMITS.maxZ);
  if (!Number.isInteger(zIndex)) throw new Error('重なり順は整数で指定してください。');
  return {
    kind: 'group',
    id: input['id'],
    name: input['name'],
    opacity: number(input['opacity'], 0, 1),
    zIndex,
    visible: input['visible'],
    locked: input['locked'],
    children: [...input['children']],
    ...(Object.hasOwn(input, 'motion') ? { motion: parseMotion(input['motion']) } : {}),
    ...(Object.hasOwn(input, 'effects') ? { effects: parseEffects(input['effects']) } : {}),
  };
}

function image(value: unknown, version: number): Decoration {
  const item = record(value, [
    'kind',
    'id',
    'assetId',
    'name',
    'placement',
    'opacity',
    'zIndex',
    'visible',
    ...(version >= 3 ? ['locked'] : []),
    ...(version >= 4 ? ['format', 'playback'] : []),
    ...(version >= 5 ? ['effects'] : []),
    ...(version >= 9 ? ['motion'] : []),
    ...(version >= 10 ? ['model', 'source'] : []),
  ]);
  if (
    !['image', ...(version >= 4 ? ['animation'] : []), ...(version >= 10 ? ['model3d'] : [])].includes(
      item['kind'] as string,
    ) ||
    !isDesignId(item['id']) ||
    !isAssetId(item['assetId']) ||
    typeof item['name'] !== 'string' ||
    item['name'].length < 1 ||
    item['name'].length > 120 ||
    /[\u0000-\u001f]/.test(item['name']) ||
    typeof item['visible'] !== 'boolean' ||
    (version >= 3 && typeof item['locked'] !== 'boolean')
  )
    throw new Error('素材レイヤーの形式が不正です。');
  const placement = record(item['placement'], ['anchor', 'x', 'y', 'widthPx', 'heightPx', 'rotationDeg']);
  const inputAnchor = record(placement['anchor'], ['kind', 'target']);
  let anchor: PlacementAnchor;
  if (inputAnchor['kind'] === 'viewport' && !Object.hasOwn(inputAnchor, 'target')) anchor = { kind: 'viewport' };
  else if (inputAnchor['kind'] === 'surface' && isDesignId(inputAnchor['target']))
    anchor = { kind: 'surface', target: inputAnchor['target'] };
  else throw new Error('素材の配置基準が不正です。');
  const zIndex = number(item['zIndex'], -IMAGE_LIMITS.maxZ, IMAGE_LIMITS.maxZ);
  if (!Number.isInteger(zIndex)) throw new Error('重なり順は整数で指定してください。');
  const common = {
    id: item['id'],
    assetId: item['assetId'],
    name: item['name'],
    placement: {
      anchor,
      x: number(placement['x'], 0, 1),
      y: number(placement['y'], 0, 1),
      widthPx: number(placement['widthPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
      heightPx: number(placement['heightPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
      rotationDeg: number(placement['rotationDeg'], -180, 180),
    },
    opacity: number(item['opacity'], 0, 1),
    zIndex,
    visible: item['visible'],
    locked: version >= 3 ? (item['locked'] as boolean) : false,
    ...(Object.hasOwn(item, 'motion') ? { motion: parseMotion(item['motion']) } : {}),
    ...(Object.hasOwn(item, 'effects') ? { effects: parseEffects(item['effects']) } : {}),
  };
  if (item['kind'] === 'model3d') {
    if (Object.hasOwn(item, 'format') || Object.hasOwn(item, 'playback')) throw new Error('3D素材の設定が不正です。');
    const source = parseModelInfo(item['source']);
    if (source.vrm && version < 11) throw new Error('VRMにはDesignDocument v11が必要です。');
    return { ...common, kind: 'model3d', source, model: parseModelSettings(item['model'], source) };
  }
  if (Object.hasOwn(item, 'model') || Object.hasOwn(item, 'source'))
    throw new Error('3D素材以外には3D設定を指定できません。');
  if (item['kind'] === 'image') {
    if (Object.hasOwn(item, 'format') || Object.hasOwn(item, 'playback'))
      throw new Error('静止画像には再生設定を指定できません。');
    return { ...common, kind: 'image' };
  }
  const format = item['format'];
  if (
    format !== 'gif' &&
    format !== 'animated-webp' &&
    format !== 'lottie' &&
    !(version >= 7 && (format === 'apng' || format === 'webm'))
  )
    throw new Error('未対応のアニメーション形式です。');
  const playback = record(item['playback'], ['playing', 'loop', 'speed', ...(version >= 7 ? ['mode'] : [])]);
  if (typeof playback['playing'] !== 'boolean' || typeof playback['loop'] !== 'boolean')
    throw new Error('再生設定が不正です。');
  const speed = number(playback['speed'], ANIMATION_LIMITS.speedMin, ANIMATION_LIMITS.speedMax);
  if (version < 7 && format !== 'lottie' && speed !== 1) throw new Error('再生速度はLottieでのみ変更できます。');
  const mode = playback['mode'];
  if ((mode !== undefined && mode !== 'auto' && mode !== 'controlled') || (format === 'webm' && mode === 'controlled'))
    throw new Error('未対応の再生モードです。');
  return {
    ...common,
    kind: 'animation',
    format,
    playback: { playing: playback['playing'], loop: playback['loop'], speed, ...(mode === undefined ? {} : { mode }) },
  };
}

/** Rebuilds trusted data; never spreads user-provided objects into CSS or markup. */
export function parseDesign(value: unknown): DesignDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('デザインの形式が不正です。');
  const version = (value as Record<string, unknown>)['schemaVersion'];
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6 &&
    version !== 7 &&
    version !== 8 &&
    version !== 9 &&
    version !== 10 &&
    version !== 11
  )
    throw new Error('このデザインのバージョンには対応していません。');
  const data = record(
    value,
    version === 1
      ? ['schemaVersion', 'id', 'siteId', 'baseThemeId', 'rules']
      : [
          'schemaVersion',
          'id',
          'siteId',
          'baseThemeId',
          'rules',
          'decorations',
          ...(version >= 6 ? ['groups'] : []),
          ...(version >= 8 ? ['signalRules'] : []),
        ],
  );
  if (
    !isDesignId(data['id']) ||
    !isDesignId(data['siteId']) ||
    (data['baseThemeId'] !== null && !isDesignId(data['baseThemeId']))
  ) {
    throw new Error('デザインの識別子が不正です。');
  }
  if (!Array.isArray(data['rules']) || data['rules'].length > 16) {
    throw new Error('デザインのルールが不正です。');
  }
  const seen = new Set<string>();
  const rules = data['rules'].map((value) => {
    const rule = record(value, ['kind', 'target', 'style']);
    if (rule['kind'] !== 'surface-style' || !isDesignId(rule['target']) || seen.has(rule['target'])) {
      throw new Error('未対応または重複した編集対象です。');
    }
    seen.add(rule['target']);
    const input = record(rule['style'], ['backgroundColor', 'border', 'borderRadiusPx']);
    const style: SurfaceStyle = {};
    if (Object.hasOwn(input, 'backgroundColor')) style.backgroundColor = color(input['backgroundColor']);
    if (Object.hasOwn(input, 'border')) {
      const border = record(input['border'], ['color', 'widthPx']);
      style.border = { color: color(border['color']), widthPx: pixels(border['widthPx'], STYLE_LIMITS.borderWidth) };
    }
    if (Object.hasOwn(input, 'borderRadiusPx'))
      style.borderRadiusPx = pixels(input['borderRadiusPx'], STYLE_LIMITS.borderRadius);
    return { kind: 'surface-style' as const, target: rule['target'], style };
  });
  let decorations: Decoration[] = [];
  if (version >= 2) {
    if (!Array.isArray(data['decorations']) || data['decorations'].length > IMAGE_LIMITS.count)
      throw new Error(ASSET_MESSAGES.layerCount);
    decorations = data['decorations'].map((value) => image(value, version));
    if (decorations.filter((item) => item.kind === 'model3d').length > MODEL_LIMITS.count)
      throw new Error(ASSET_MESSAGES.modelCount);
    if (new Set(decorations.map((item) => item.id)).size !== decorations.length)
      throw new Error('素材レイヤーのIDが重複しています。');
    if (
      decorations.filter((item) => item.kind === 'animation').length >
      (version < 7 ? ASSET_LIMITS.legacyAnimationCount : ANIMATION_LIMITS.count)
    )
      throw new Error(version < 7 ? ASSET_MESSAGES.legacyAnimationCount : ASSET_MESSAGES.layerCount);
  }
  let groups: GroupLayer[] = [];
  if (Object.hasOwn(data, 'groups')) {
    if (!Array.isArray(data['groups']) || data['groups'].length > GROUP_LIMITS.count)
      throw new Error('グループは16個までです。');
    groups = data['groups'].map((value) => group(value, version));
    const allIds = [...decorations, ...groups].map((layer) => layer.id),
      assigned = new Set<string>();
    if (new Set(allIds).size !== allIds.length) throw new Error('レイヤーのIDが重複しています。');
    for (const group of groups) {
      const children = group.children.map((id) => decorations.find((layer) => layer.id === id));
      if (children.some((child) => !child) || group.children.some((id) => assigned.has(id)))
        throw new Error('グループの参照が不正です。多重所属・ネストには対応していません。');
      if (children.some((child) => !sameAnchor(child!.placement.anchor, children[0]!.placement.anchor)))
        throw new Error('同じ配置基準のレイヤーだけをグループ化できます。');
      group.children.forEach((id) => assigned.add(id));
    }
  }
  const signalRules = Object.hasOwn(data, 'signalRules')
    ? parseSignalRules(data['signalRules'], new Set([...decorations, ...groups].map((layer) => layer.id)), version < 9)
    : [];
  return {
    schemaVersion: 11,
    id: data['id'],
    siteId: data['siteId'],
    baseThemeId: data['baseThemeId'],
    rules,
    decorations,
    ...(groups.length ? { groups } : {}),
    ...(signalRules.length ? { signalRules } : {}),
  };
}

export function emptyDesign(siteId: string, baseThemeId: string | null): DesignDocument {
  return parseDesign({ schemaVersion: 11, id: `${siteId}-custom`, siteId, baseThemeId, rules: [], decorations: [] });
}

export function sameDesign(a: DesignDocument | undefined, b: DesignDocument | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
