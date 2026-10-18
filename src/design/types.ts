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
  schemaVersion: 7;
  id: string;
  siteId: string;
  /** null uses native site styling; a built-in theme is an optional starting point. */
  baseThemeId: string | null;
  rules: SurfaceStyleRule[];
  decorations: Decoration[];
  /** Composition nodes reference existing media; assets are never duplicated here. */
  groups?: GroupLayer[];
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
export interface LayerAppearance {
  id: string;
  name: string;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  /** Render-time effects never change placement or the underlying asset. */
  effects?: import('../effects/types').LayerEffect[];
}

export interface LayerState extends LayerAppearance { placement: LayerPlacement }
export interface GroupLayer extends LayerAppearance { kind: 'group'; children: string[] }
/** Group geometry is derived from its children, never a second saved coordinate system. */
export interface GroupView extends GroupLayer { placement: LayerPlacement }
export type LayerNode = Decoration | GroupLayer;
export type EditorLayer = Decoration | GroupView;

export type ImagePlacement = LayerPlacement;
export interface ImageDecoration extends LayerState {
  kind: 'image';
  assetId: string;
}

export interface PlaybackSettings { playing: boolean; loop: boolean; speed: number; mode?: 'auto' | 'controlled' }
export interface AnimationDecoration extends LayerState {
  kind: 'animation';
  assetId: string;
  format: import('../assets/motion-types').AnimationFormat;
  playback: PlaybackSettings;
}
export type Decoration = ImageDecoration | AnimationDecoration;

export type ImagePatch = Partial<Pick<LayerState, 'name' | 'opacity' | 'zIndex' | 'visible' | 'locked' | 'effects'>> & { placement?: Partial<LayerPlacement>; playback?: Partial<PlaybackSettings> };

export interface DesignTarget {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
}

export const STYLE_LIMITS = Object.freeze({ borderWidth: 12, borderRadius: 48 });
export const IMAGE_LIMITS = Object.freeze({ count: 32, minSize: 1, maxSize: 4096, maxZ: 100 });
export const GROUP_LIMITS = Object.freeze({ count: 16 });
