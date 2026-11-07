/** Data only. Assets, placement and motion can later add their own rule kinds. */
export interface SurfaceStyle {
  backgroundColor?: string;
  border?: { color: string; widthPx: number };
  borderRadiusPx?: number;
}

/** States are names only; each site adapter owns the CSS condition for every state. */
export const SKIN_STATES = ['normal', 'hover', 'focus', 'selected', 'pressed', 'disabled'] as const;
export type SkinState = (typeof SKIN_STATES)[number];
/** Inner widths in source-image pixels, as in border-image-slice. */
export interface SkinSlices {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface SkinFrame {
  assetId: string;
  slices: SkinSlices;
  center: 'stretch' | 'repeat';
  /** Drawn edge width = slice × scalePct / 100 CSS px. Never changes the element's box. */
  scalePct: number;
}
/** Used while the element is smaller than the normal frame's drawn edges. */
export type SkinCompact = { kind: 'color'; color: string } | { kind: 'frame'; frame: SkinFrame };
export interface SurfaceSkin {
  states: { normal: SkinFrame } & { [state in Exclude<SkinState, 'normal'>]?: SkinFrame };
  compact?: SkinCompact;
}

export interface SurfaceStyleRule {
  kind: 'surface-style';
  target: string;
  style: SurfaceStyle;
  /** v13. Validated numbers and asset IDs only; the engine builds the CSS. */
  skin?: SurfaceSkin;
}

export interface DesignDocument {
  schemaVersion: 15;
  id: string;
  siteId: string;
  /** null uses native site styling; a built-in theme is an optional starting point. */
  baseThemeId: string | null;
  rules: SurfaceStyleRule[];
  decorations: Decoration[];
  /** Composition nodes reference existing media; assets are never duplicated here. */
  groups?: GroupLayer[];
  signalRules?: import('../signals/keyframes').SignalRule[];
}

export type RenderMode = 'normal' | 'atmosphere';
export const renderModeOf = (layer: { renderMode?: RenderMode }): RenderMode => layer.renderMode ?? 'normal';

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
  /** Omitted means normal. Atmosphere paints over protected areas under an engine-held
   * alpha cap, without filters, shadows or input; the cap is never stored in artwork. */
  renderMode?: RenderMode;
  motion?: import('../signals/motion').FollowMotion;
}

export interface LayerState extends LayerAppearance {
  placement: LayerPlacement;
}
export interface GroupLayer extends LayerAppearance {
  kind: 'group';
  children: string[];
}
/** Group geometry is derived from its children, never a second saved coordinate system. */
export interface GroupView extends GroupLayer {
  placement: LayerPlacement;
}
export type LayerNode = Decoration | GroupLayer;
export type EditorLayer = Decoration | GroupView;

export type ImagePlacement = LayerPlacement;
export interface ImageDecoration extends LayerState {
  kind: 'image';
  assetId: string;
}

export interface PlaybackSettings {
  playing: boolean;
  loop: boolean;
  speed: number;
  mode?: 'auto' | 'controlled';
}
export interface AnimationDecoration extends LayerState {
  kind: 'animation';
  assetId: string;
  format: import('../assets/motion-types').AnimationFormat;
  playback: PlaybackSettings;
}
export interface ModelDecoration extends LayerState {
  kind: 'model3d';
  assetId: string;
  source: import('../models/types').ModelInfo;
  model: import('../models/types').ModelSettings;
  /** v14. With it, model clip indices address character.motions (src/characters/settings.ts). */
  character?: CharacterSettings;
}
export type CharacterSettings = import('../characters/settings').CharacterSettings;
export type Decoration = ImageDecoration | AnimationDecoration | ModelDecoration;

export type ImagePatch = Partial<
  Pick<LayerState, 'name' | 'opacity' | 'zIndex' | 'visible' | 'locked' | 'effects' | 'motion' | 'renderMode'>
> & {
  placement?: Partial<LayerPlacement>;
  playback?: Partial<PlaybackSettings>;
  model?: import('../models/types').ModelPatch;
  character?: import('../characters/settings').CharacterPatch;
};

/** Bundled site knowledge. A condition is a selector with one `&` for the target element. */
export interface SkinTargetSpec {
  readonly states: { readonly [state in Exclude<SkinState, 'normal'>]?: string };
  /** Part-specific names for a state, e.g. selected = 登録済み. */
  readonly labels?: { readonly [state in SkinState]?: string };
  /** Where the part normally appears, shown when no element is found. */
  readonly where?: string;
  /** Typical size, used by the editor's size preview. */
  readonly sample?: { readonly width: number; readonly height: number };
  /** Most CSS px the frame may be drawn outside the part: the measured clear gap around it.
   * Used where children cover the edges or text starts at the edge. Omitted: drawn inside. */
  readonly outset?: number;
  /** Descendants that keep their own text colour, as a selector of `&` (the part). The engine's
   * legibility colour reaches them as well as the part itself. */
  readonly ink?: string;
}

export interface DesignTarget {
  readonly id: string;
  readonly surface: string;
  readonly label: string;
  readonly skin?: SkinTargetSpec;
  /** The part's edges a character living on it can sit on (the adapter decides; never artwork). */
  readonly seats?: readonly ('top' | 'bottom')[];
}

export const STYLE_LIMITS = Object.freeze({ borderWidth: 12, borderRadius: 48 });
export const IMAGE_LIMITS = Object.freeze({ count: 32, minSize: 1, maxSize: 4096, maxZ: 100 });
export const SKIN_LIMITS = Object.freeze({ slice: 512, scaleMin: 10, scaleMax: 400, assets: 32, edge: 1024 });
export const GROUP_LIMITS = Object.freeze({ count: 16 });
