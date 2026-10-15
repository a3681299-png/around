import { IMAGE_LIMITS, STYLE_LIMITS, type DesignDocument, type SurfaceStyle, type ImageDecoration, type PlacementAnchor } from './types';

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^asset-[a-f0-9]{64}$/.test(value);
}

export function isDesignId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))) {
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
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('画像の配置値が範囲外です。');
  return value;
}

function image(value: unknown): ImageDecoration {
  const item = record(value, ['kind', 'id', 'assetId', 'name', 'placement', 'opacity', 'zIndex', 'visible']);
  if (item['kind'] !== 'image' || !isDesignId(item['id']) || !isAssetId(item['assetId'])
    || typeof item['name'] !== 'string' || item['name'].length < 1 || item['name'].length > 120 || /[\u0000-\u001f]/.test(item['name'])
    || typeof item['visible'] !== 'boolean') throw new Error('画像レイヤーの形式が不正です。');
  const placement = record(item['placement'], ['anchor', 'x', 'y', 'widthPx', 'heightPx', 'rotationDeg']);
  const inputAnchor = record(placement['anchor'], ['kind', 'target']);
  let anchor: PlacementAnchor;
  if (inputAnchor['kind'] === 'viewport' && !Object.hasOwn(inputAnchor, 'target')) anchor = { kind: 'viewport' };
  else if (inputAnchor['kind'] === 'surface' && isDesignId(inputAnchor['target'])) anchor = { kind: 'surface', target: inputAnchor['target'] };
  else throw new Error('画像の配置基準が不正です。');
  const zIndex = number(item['zIndex'], -IMAGE_LIMITS.maxZ, IMAGE_LIMITS.maxZ);
  if (!Number.isInteger(zIndex)) throw new Error('重なり順は整数で指定してください。');
  return {
    kind: 'image', id: item['id'], assetId: item['assetId'], name: item['name'],
    placement: {
      anchor, x: number(placement['x'], 0, 1), y: number(placement['y'], 0, 1),
      widthPx: number(placement['widthPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
      heightPx: number(placement['heightPx'], IMAGE_LIMITS.minSize, IMAGE_LIMITS.maxSize),
      rotationDeg: number(placement['rotationDeg'], -180, 180),
    },
    opacity: number(item['opacity'], 0, 1), zIndex, visible: item['visible'],
  };
}

/** Rebuilds trusted data; never spreads user-provided objects into CSS or markup. */
export function parseDesign(value: unknown): DesignDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('デザインの形式が不正です。');
  const version = (value as Record<string, unknown>)['schemaVersion'];
  if (version !== 1 && version !== 2) throw new Error('このデザインのバージョンには対応していません。');
  const data = record(value, version === 1 ? ['schemaVersion', 'id', 'siteId', 'baseThemeId', 'rules'] : ['schemaVersion', 'id', 'siteId', 'baseThemeId', 'rules', 'decorations']);
  if (!isDesignId(data['id']) || !isDesignId(data['siteId'])
    || (data['baseThemeId'] !== null && !isDesignId(data['baseThemeId']))) {
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
    if (Object.hasOwn(input, 'borderRadiusPx')) style.borderRadiusPx = pixels(input['borderRadiusPx'], STYLE_LIMITS.borderRadius);
    return { kind: 'surface-style' as const, target: rule['target'], style };
  });
  let decorations: ImageDecoration[] = [];
  if (version === 2) {
    if (!Array.isArray(data['decorations']) || data['decorations'].length > IMAGE_LIMITS.count) throw new Error('画像は32枚まで配置できます。');
    decorations = data['decorations'].map(image);
    if (new Set(decorations.map((item) => item.id)).size !== decorations.length) throw new Error('画像レイヤーのIDが重複しています。');
  }
  return { schemaVersion: 2, id: data['id'], siteId: data['siteId'], baseThemeId: data['baseThemeId'], rules, decorations };
}

export function emptyDesign(siteId: string, baseThemeId: string | null): DesignDocument {
  return parseDesign({ schemaVersion: 2, id: `${siteId}-custom`, siteId, baseThemeId, rules: [], decorations: [] });
}

export function sameDesign(a: DesignDocument | undefined, b: DesignDocument | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
