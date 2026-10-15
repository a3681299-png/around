/** Data only. Assets, placement and motion can later add their own rule kinds. */
export interface SurfaceStyle {
  backgroundColor?: string;
  border?: { color: string; widthPx: number };
  borderRadiusPx?: number;
}

export interface SurfaceStyleRule {
  kind: 'surface-style';
  target: string;
  style: SurfaceStyle;
}

export interface DesignDocument {
  schemaVersion: 1;
  id: string;
  siteId: string;
  /** null uses native site styling; a built-in theme is an optional starting point. */
  baseThemeId: string | null;
  rules: SurfaceStyleRule[];
}

export interface DesignTarget {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
}

export const STYLE_LIMITS = Object.freeze({ borderWidth: 12, borderRadius: 48 });
