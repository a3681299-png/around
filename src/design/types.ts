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
  schemaVersion: 2;
  id: string;
  siteId: string;
  /** null uses native site styling; a built-in theme is an optional starting point. */
  baseThemeId: string | null;
  rules: SurfaceStyleRule[];
  decorations: ImageDecoration[];
}

export type PlacementAnchor = { kind: 'viewport' } | { kind: 'surface'; target: string };

export interface ImagePlacement {
  anchor: PlacementAnchor;
  /** Centre relative to the anchor; dimensions remain in CSS pixels. */
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
}

export interface ImageDecoration {
  kind: 'image';
  id: string;
  assetId: string;
  name: string;
  placement: ImagePlacement;
  opacity: number;
  zIndex: number;
  visible: boolean;
}

export type ImagePatch = Partial<Pick<ImageDecoration, 'opacity' | 'zIndex' | 'visible'>> & { placement?: Partial<ImagePlacement> };

export interface DesignTarget {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
}

export const STYLE_LIMITS = Object.freeze({ borderWidth: 12, borderRadius: 48 });
export const IMAGE_LIMITS = Object.freeze({ count: 32, minSize: 1, maxSize: 4096, maxZ: 100 });
