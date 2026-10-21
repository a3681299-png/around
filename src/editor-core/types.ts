import type {
  DesignDocument,
  DesignTarget,
  Decoration,
  GroupLayer,
  EditorLayer,
  ImagePatch,
  LayerPlacement,
  SurfaceStyle,
} from '../design/types';
import type { PlacementChange, PlacementFrame, PlacementSample, Point } from '../world/geometry';
import type { Alignment, Distribution } from '../design/layout';
import type { HistoryCheckpoint } from '../editor/history';
import type { AnimationFormat } from '../assets/motion-types';
import type { SignalRule } from '../signals/keyframes';
export type EditorTool = 'select' | 'browse' | 'card';

export interface EditorCapability {
  allowed: boolean;
  reason: string;
}
export interface EditorCapabilities {
  canDuplicate: EditorCapability;
  canDelete: EditorCapability;
  canGroup: EditorCapability;
  canUngroup: EditorCapability;
  canAddImage: EditorCapability;
  canAddModel: EditorCapability;
  canAddAnimation: EditorCapability;
  canAlign: EditorCapability;
  canDistribute: EditorCapability;
  canChangeMotion: EditorCapability;
  canChangeAnchor: EditorCapability;
}
export interface EditorView extends EditorCapabilities {
  selected: boolean;
  style: SurfaceStyle;
  dirty: boolean;
  saving: boolean;
  status: string;
  error: boolean;
  images: readonly Decoration[];
  groups: readonly GroupLayer[];
  image: EditorLayer | undefined;
  inheritedLocked: boolean;
  groupPositionAvailable: boolean;
  groupingReason: string;
  selectedIds: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  snapping: boolean;
  tool?: EditorTool;
  signalRules?: readonly SignalRule[];
}
export type EditCommand =
  | { type: 'select'; id: string; additive?: boolean; preserve?: boolean }
  | { type: 'select-target'; target?: string }
  | {
      type:
        | 'select-all'
        | 'clear-selection'
        | 'group'
        | 'ungroup'
        | 'undo'
        | 'redo'
        | 'discard'
        | 'save'
        | 'close'
        | 'begin';
    }
  | { type: 'end'; cancel?: boolean }
  | { type: 'change'; id?: string; patch: ImagePatch }
  | { type: 'style'; style: SurfaceStyle }
  | { type: 'delete' | 'duplicate'; id?: string }
  | { type: 'placements'; changes: readonly PlacementChange[] }
  | { type: 'reorder'; id: string; targetId: string; after: boolean }
  | { type: 'snap'; value: boolean }
  | { type: 'layout'; mode: Alignment | Distribution }
  | { type: 'nudge'; delta: Point }
  | { type: 'tool'; tool: EditorTool }
  | { type: 'signal-rule'; rule: SignalRule }
  | { type: 'remove-signal-rule'; id: string };

export interface EditorAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  model?: import('../models/types').ModelInfo;
  animation?: { format: AnimationFormat };
}
export interface EditorStorage<Source> {
  read(): Promise<DesignDocument | undefined>;
  watch(accept: (doc: DesignDocument | undefined) => void, error: (error: unknown) => void): () => void;
  retain(session: string, ids: readonly string[]): Promise<void>;
  release(session: string): Promise<void>;
  save(doc: DesignDocument, session: string): Promise<void>;
  validate(doc: DesignDocument, session: string): Promise<void>;
  import(source: Source, session: string): Promise<readonly EditorAsset[]>;
  cancelImport(): void;
}
export interface EditorGeometry {
  frameFor(placement: LayerPlacement): PlacementFrame | undefined;
  samples(doc: DesignDocument, ids: readonly string[]): PlacementSample[];
  importFrame(point?: Point): { width: number; height: number; origin: Point };
}
export interface EditorPorts<Source> {
  siteId: string;
  baseThemeId: string;
  targets: readonly DesignTarget[];
  makeId(kind: 'image' | 'group' | 'session'): string;
  geometry: EditorGeometry;
  storage: EditorStorage<Source>;
  validate(doc: DesignDocument | undefined): void;
}
export interface EditorCheckpoint {
  version: 1;
  siteId: string;
  draft: DesignDocument;
  saved?: DesignDocument;
  selectedIds: string[];
  selectedTarget?: string;
  tool?: EditorTool;
  snapping: boolean;
  history: HistoryCheckpoint<DesignDocument>;
}
export interface EditorSnapshot {
  sessionId: string;
  revision: number;
  active: boolean;
  enabled: boolean;
  view: EditorView;
  document: DesignDocument;
  saved?: DesignDocument;
  selectedTarget?: string;
}
