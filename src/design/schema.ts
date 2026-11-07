import {
  GROUP_LIMITS,
  IMAGE_LIMITS,
  SKIN_LIMITS,
  SKIN_STATES,
  STYLE_LIMITS,
  type SkinFrame,
  type SurfaceSkin,
  type SurfaceStyleRule,
  type DesignDocument,
  type SurfaceStyle,
  type Decoration,
  type PlacementAnchor,
  type GroupLayer,
  type LayerPlacement,
  type RenderMode,
  type LayerDepth,
  renderModeOf,
  depthOf,
} from './types';
import { parseSpace } from './space';
import { MODEL_LIMITS, parseModelInfo, parseModelSettings } from '../models/types';
import { modelClips, parseCharacter } from '../characters/settings';
import { ASSET_MESSAGES } from '../assets/limits';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { parseEffects } from '../effects/schema';
import { sameAnchor } from './hierarchy';
import { parseMotion } from '../signals/motion';
import { parseSignalRules } from '../signals/keyframe-schema';
import { migrateDesign } from './migrations';

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

/** Normal is stored by omission, so equal artwork has one canonical form. */
function renderMode(input: Record<string, unknown>): { renderMode?: RenderMode } {
  if (!Object.hasOwn(input, 'renderMode')) return {};
  const value = input['renderMode'];
  if (value !== 'normal' && value !== 'atmosphere') throw new Error('描画モードが不正です。');
  return value === 'atmosphere' ? { renderMode: value } : {};
}
/** A group is rendered as one undivided subtree, so its members share its mode. */
export function checkGroupRenderMode(group: GroupLayer, children: readonly { renderMode?: RenderMode }[]): void {
  if (children.some((child) => renderModeOf(child) !== renderModeOf(group)))
    throw new Error('グループと中のレイヤーは同じ描画モードにしてください。');
}
/** v17. In front is stored by omission, so equal artwork has one canonical form. */
function depth(input: Record<string, unknown>): { depth?: LayerDepth } {
  if (!Object.hasOwn(input, 'depth')) return {};
  if (input['depth'] !== 'room') throw new Error('奥行きが不正です。');
  return { depth: 'room' };
}
/** A group is drawn as one subtree on one plane, so its members share its depth. */
export function checkGroupDepth(group: GroupLayer, children: readonly { depth?: LayerDepth }[]): void {
  if (children.some((child) => depthOf(child) !== depthOf(group)))
    throw new Error('グループと中のレイヤーは同じ奥行きにしてください。');
}

export function parseGroupLayer(value: unknown): GroupLayer {
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
    'motion',
    'renderMode',
    'depth',
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
    ...renderMode(input),
    ...depth(input),
    ...(Object.hasOwn(input, 'motion') ? { motion: parseMotion(input['motion']) } : {}),
    ...(Object.hasOwn(input, 'effects') ? { effects: parseEffects(input['effects']) } : {}),
  };
}

const PLACEMENT_FIELDS = ['anchor', 'x', 'y', 'widthPx', 'heightPx', 'rotationDeg'];
const ANCHOR_FIELDS = ['kind', 'target'];
export function parsePlacement(value: unknown): LayerPlacement {
  const placement = record(value, PLACEMENT_FIELDS);
  const inputAnchor = record(placement['anchor'], ANCHOR_FIELDS);
  let anchor: PlacementAnchor;
  if (inputAnchor['kind'] === 'viewport' && !Object.hasOwn(inputAnchor, 'target')) anchor = { kind: 'viewport' };
  else if (inputAnchor['kind'] === 'surface' && isDesignId(inputAnchor['target']))
    anchor = { kind: 'surface', target: inputAnchor['target'] };
  else throw new Error('素材の配置基準が不正です。');
  return {
    anchor,
    x: number(placement['x'], 0, 1),
    y: number(placement['y'], 0, 1),
    widthPx: number(placement['widthPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
    heightPx: number(placement['heightPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
    rotationDeg: number(placement['rotationDeg'], -180, 180),
  };
}

export function parseSurfaceStyle(value: unknown): SurfaceStyle {
  const input = record(value, ['backgroundColor', 'border', 'borderRadiusPx']);
  const style: SurfaceStyle = {};
  if (Object.hasOwn(input, 'backgroundColor')) style.backgroundColor = color(input['backgroundColor']);
  if (Object.hasOwn(input, 'border')) {
    const border = record(input['border'], ['color', 'widthPx']);
    style.border = { color: color(border['color']), widthPx: pixels(border['widthPx'], STYLE_LIMITS.borderWidth) };
  }
  if (Object.hasOwn(input, 'borderRadiusPx'))
    style.borderRadiusPx = pixels(input['borderRadiusPx'], STYLE_LIMITS.borderRadius);
  return style;
}

function sliceWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > SKIN_LIMITS.slice)
    throw new Error(`着せ替えの切り位置は0〜${SKIN_LIMITS.slice}pxの整数で指定してください。`);
  return value;
}

export function parseSkinFrame(value: unknown): SkinFrame {
  const input = record(value, ['assetId', 'slices', 'center', 'scalePct']);
  if (!isAssetId(input['assetId'])) throw new Error('着せ替えの素材が不正です。');
  const slices = record(input['slices'], ['top', 'right', 'bottom', 'left']);
  const center = input['center'];
  if (center !== 'stretch' && center !== 'repeat') throw new Error('着せ替えの中央の扱いが不正です。');
  const scale = input['scalePct'];
  if (
    typeof scale !== 'number' ||
    !Number.isInteger(scale) ||
    scale < SKIN_LIMITS.scaleMin ||
    scale > SKIN_LIMITS.scaleMax
  )
    throw new Error(`着せ替えの表示倍率は${SKIN_LIMITS.scaleMin}〜${SKIN_LIMITS.scaleMax}%の整数で指定してください。`);
  return {
    assetId: input['assetId'],
    slices: {
      top: sliceWidth(slices['top']),
      right: sliceWidth(slices['right']),
      bottom: sliceWidth(slices['bottom']),
      left: sliceWidth(slices['left']),
    },
    center,
    scalePct: scale,
  };
}

/** Only state names and frames are stored; CSS conditions belong to the site adapter. */
export function parseSurfaceSkin(value: unknown): SurfaceSkin {
  const input = record(value, ['states', 'compact']);
  const states = record(input['states'], SKIN_STATES);
  if (!Object.hasOwn(states, 'normal')) throw new Error('着せ替えには通常状態の絵が必要です。');
  const parsed = {} as Record<string, SkinFrame>;
  // Canonical order keeps equal artwork byte-identical.
  for (const state of SKIN_STATES) if (Object.hasOwn(states, state)) parsed[state] = parseSkinFrame(states[state]);
  const skin: SurfaceSkin = { states: parsed as SurfaceSkin['states'] };
  if (Object.hasOwn(input, 'compact')) {
    const compact = record(input['compact'], ['kind', 'color', 'frame']);
    if (compact['kind'] === 'color' && !Object.hasOwn(compact, 'frame'))
      skin.compact = { kind: 'color', color: color(compact['color']) };
    else if (compact['kind'] === 'frame' && !Object.hasOwn(compact, 'color'))
      skin.compact = { kind: 'frame', frame: parseSkinFrame(compact['frame']) };
    else throw new Error('小さいときの着せ替えが不正です。');
  }
  return skin;
}

export function skinAssetIds(skin: SurfaceSkin): string[] {
  const frames = Object.values(skin.states) as SkinFrame[];
  if (skin.compact?.kind === 'frame') frames.push(skin.compact.frame);
  return frames.map((frame) => frame.assetId);
}

/** One rule, shared by the full parser and incremental commits. */
export function parseStyleRule(value: unknown): SurfaceStyleRule {
  const rule = record(value, ['kind', 'target', 'style', 'skin']);
  if (rule['kind'] !== 'surface-style' || !isDesignId(rule['target'])) throw new Error('未対応の編集対象です。');
  const style = parseSurfaceStyle(rule['style']);
  return {
    kind: 'surface-style',
    target: rule['target'],
    style,
    ...(Object.hasOwn(rule, 'skin') ? { skin: parseSurfaceSkin(rule['skin']) } : {}),
  };
}

/** Rule-set invariants: count, unique targets and the skin asset budget. */
export function checkStyleRules(rules: readonly SurfaceStyleRule[]): void {
  if (rules.length > 16 || new Set(rules.map((rule) => rule.target)).size !== rules.length)
    throw new Error('未対応または重複した編集対象です。');
  const assets = new Set(rules.flatMap((rule) => (rule.skin ? skinAssetIds(rule.skin) : [])));
  if (assets.size > SKIN_LIMITS.assets) throw new Error(`着せ替えに使える素材は${SKIN_LIMITS.assets}個までです。`);
}

const DECORATION_FIELDS = [
  'kind',
  'id',
  'assetId',
  'name',
  'placement',
  'opacity',
  'zIndex',
  'visible',
  'locked',
  'format',
  'playback',
  'effects',
  'motion',
  'model',
  'source',
  'renderMode',
  'character',
  'depth',
] as const;
const DECORATION_KINDS = ['image', 'animation', 'model3d'] as const;
export function parseDecoration(value: unknown): Decoration {
  const item = record(value, DECORATION_FIELDS);
  if (
    !DECORATION_KINDS.includes(item['kind'] as Decoration['kind']) ||
    !isDesignId(item['id']) ||
    !isAssetId(item['assetId']) ||
    typeof item['name'] !== 'string' ||
    item['name'].length < 1 ||
    item['name'].length > 120 ||
    /[\u0000-\u001f]/.test(item['name']) ||
    typeof item['visible'] !== 'boolean' ||
    typeof item['locked'] !== 'boolean'
  )
    throw new Error('素材レイヤーの形式が不正です。');
  const zIndex = number(item['zIndex'], -IMAGE_LIMITS.maxZ, IMAGE_LIMITS.maxZ);
  if (!Number.isInteger(zIndex)) throw new Error('重なり順は整数で指定してください。');
  const common = {
    id: item['id'],
    assetId: item['assetId'],
    name: item['name'],
    placement: parsePlacement(item['placement']),
    opacity: number(item['opacity'], 0, 1),
    zIndex,
    visible: item['visible'],
    locked: item['locked'] as boolean,
    ...renderMode(item),
    ...depth(item),
    ...(Object.hasOwn(item, 'motion') ? { motion: parseMotion(item['motion']) } : {}),
    ...(Object.hasOwn(item, 'effects') ? { effects: parseEffects(item['effects']) } : {}),
  };
  if (item['kind'] === 'model3d') {
    if (Object.hasOwn(item, 'format') || Object.hasOwn(item, 'playback')) throw new Error('3D素材の設定が不正です。');
    const source = parseModelInfo(item['source']);
    if (!Object.hasOwn(item, 'character'))
      return { ...common, kind: 'model3d', source, model: parseModelSettings(item['model'], source) };
    // With a character, clip indices address its motions instead of the model's embedded clips.
    const character = parseCharacter(item['character'], source);
    const model = parseModelSettings(item['model'], { ...source, clips: modelClips({ source, character }) });
    return { ...common, kind: 'model3d', source, model, character };
  }
  if (Object.hasOwn(item, 'model') || Object.hasOwn(item, 'source') || Object.hasOwn(item, 'character'))
    throw new Error('3D素材以外には3D設定を指定できません。');
  if (item['kind'] === 'image') {
    if (Object.hasOwn(item, 'format') || Object.hasOwn(item, 'playback'))
      throw new Error('静止画像には再生設定を指定できません。');
    return { ...common, kind: 'image' };
  }
  const format = item['format'];
  if (format !== 'gif' && format !== 'animated-webp' && format !== 'lottie' && format !== 'apng' && format !== 'webm')
    throw new Error('未対応のアニメーション形式です。');
  const playback = record(item['playback'], ['playing', 'loop', 'speed', 'mode']);
  if (typeof playback['playing'] !== 'boolean' || typeof playback['loop'] !== 'boolean')
    throw new Error('再生設定が不正です。');
  const speed = number(playback['speed'], ANIMATION_LIMITS.speedMin, ANIMATION_LIMITS.speedMax);
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
  const data = record(migrateDesign(value), [
    'schemaVersion',
    'id',
    'siteId',
    'baseThemeId',
    'rules',
    'decorations',
    'groups',
    'signalRules',
    'space',
  ]);
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
  const rules = data['rules'].map(parseStyleRule);
  checkStyleRules(rules);
  if (!Array.isArray(data['decorations']) || data['decorations'].length > IMAGE_LIMITS.count)
    throw new Error(ASSET_MESSAGES.layerCount);
  const decorations = data['decorations'].map(parseDecoration);
  if (decorations.filter((item) => item.kind === 'model3d').length > MODEL_LIMITS.count)
    throw new Error(ASSET_MESSAGES.modelCount);
  if (new Set(decorations.map((item) => item.id)).size !== decorations.length)
    throw new Error('素材レイヤーのIDが重複しています。');
  if (decorations.filter((item) => item.kind === 'animation').length > ANIMATION_LIMITS.count)
    throw new Error(ASSET_MESSAGES.layerCount);
  let groups: GroupLayer[] = [];
  if (Object.hasOwn(data, 'groups')) {
    if (!Array.isArray(data['groups']) || data['groups'].length > GROUP_LIMITS.count)
      throw new Error('グループは16個までです。');
    groups = data['groups'].map(parseGroupLayer);
    const allIds = [...decorations, ...groups].map((layer) => layer.id),
      assigned = new Set<string>();
    if (new Set(allIds).size !== allIds.length) throw new Error('レイヤーのIDが重複しています。');
    for (const group of groups) {
      const children = group.children.map((id) => decorations.find((layer) => layer.id === id));
      if (children.some((child) => !child) || group.children.some((id) => assigned.has(id)))
        throw new Error('グループの参照が不正です。多重所属・ネストには対応していません。');
      if (children.some((child) => !sameAnchor(child!.placement.anchor, children[0]!.placement.anchor)))
        throw new Error('同じ配置基準のレイヤーだけをグループ化できます。');
      checkGroupRenderMode(group, children as Decoration[]);
      checkGroupDepth(group, children as Decoration[]);
      group.children.forEach((id) => assigned.add(id));
    }
  }
  const signalRules = Object.hasOwn(data, 'signalRules')
    ? parseSignalRules(data['signalRules'], new Set([...decorations, ...groups].map((layer) => layer.id)))
    : [];
  return {
    schemaVersion: 17,
    id: data['id'],
    siteId: data['siteId'],
    baseThemeId: data['baseThemeId'],
    rules,
    decorations,
    ...(groups.length ? { groups } : {}),
    ...(signalRules.length ? { signalRules } : {}),
    ...(Object.hasOwn(data, 'space') ? { space: parseSpace(data['space']) } : {}),
  };
}

export function emptyDesign(siteId: string, baseThemeId: string | null): DesignDocument {
  return parseDesign({ schemaVersion: 17, id: `${siteId}-custom`, siteId, baseThemeId, rules: [], decorations: [] });
}

export function sameDesign(a: DesignDocument | undefined, b: DesignDocument | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
