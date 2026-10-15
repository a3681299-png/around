import { STYLE_LIMITS, type DesignDocument, type SurfaceStyle } from './types';

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

/** Rebuilds trusted data; never spreads user-provided objects into CSS or markup. */
export function parseDesign(value: unknown): DesignDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('デザインの形式が不正です。');
  if ((value as Record<string, unknown>)['schemaVersion'] !== 1) throw new Error('このデザインのバージョンには対応していません。');
  const data = record(value, ['schemaVersion', 'id', 'siteId', 'baseThemeId', 'rules']);
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
  return { schemaVersion: 1, id: data['id'], siteId: data['siteId'], baseThemeId: data['baseThemeId'], rules };
}

export function emptyDesign(siteId: string, baseThemeId: string | null): DesignDocument {
  return parseDesign({ schemaVersion: 1, id: `${siteId}-custom`, siteId, baseThemeId, rules: [] });
}

export function sameDesign(a: DesignDocument | undefined, b: DesignDocument | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
