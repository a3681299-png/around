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
  schemaVersion: 4;
  id: string;
  siteId: string;
  /** null uses native site styling; a built-in theme is an optional starting point. */
  baseThemeId: string | null;
  rules: SurfaceStyleRule[];
  decorations: Decoration[];
}

export type PlacementAnchor = { kind: 'viewport' } | { kind: 'surface'; target: string };

export interface LayerPlacement {
  anchor: PlacementAnchor;
  /** Centre relative to the anchor; dimensions remain in CSS pixels. */
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
}

/** Shared authoring state, independent of the layer's media and renderer. */
export interface LayerState {
  id: string;
  name: string;
  placement: LayerPlacement;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export type ImagePlacement = LayerPlacement;
export interface ImageDecoration extends LayerState {
  kind: 'image';
  assetId: string;
}

export interface PlaybackSettings { playing: boolean; loop: boolean; speed: number }
export interface AnimationDecoration extends LayerState {
  kind: 'animation';
  assetId: string;
  format: import('../assets/motion-types').AnimationFormat;
  playback: PlaybackSettings;
}
export type Decoration = ImageDecoration | AnimationDecoration;

export type ImagePatch = Partial<Pick<LayerState, 'name' | 'opacity' | 'zIndex' | 'visible' | 'locked'>> & { placement?: Partial<LayerPlacement>; playback?: Partial<PlaybackSettings> };

export interface DesignTarget {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
}

export const STYLE_LIMITS = Object.freeze({ borderWidth: 12, borderRadius: 48 });
export const IMAGE_LIMITS = Object.freeze({ count: 32, minSize: 1, maxSize: 4096, maxZ: 100 });
