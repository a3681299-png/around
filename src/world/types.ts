import type { Decoration, GroupLayer, GroupView, LayerPlacement } from '../design/types';
import type { SignalSnapshot } from '../signals/types';
import type { Bounds, PlacementFrame, Point } from './geometry';
import type { EffectState, EffectEvaluation } from './effects';

export const WORLD_RUNTIME_VERSION = '1.3.0' as const;
export interface WorldScene {
  decorations: readonly Decoration[];
  groups?: readonly GroupLayer[];
  signalRules?: readonly import('../signals/keyframes').SignalRule[];
}
export interface WorldGeometry {
  viewport: { width: number; height: number };
  /** Semantic IDs only; absence means the host cannot currently resolve an anchor. */
  anchors: Readonly<Record<string, PlacementFrame>>;
}
export type WorldEvent =
  { type: 'video.play' | 'video.pause' | 'video.ended' | 'host.lifecycle' } | { type: 'pointer.click'; point: Point };
export interface WorldInput extends WorldGeometry {
  timeMs: number;
  deltaMs: number;
  signals: SignalSnapshot;
  events: readonly WorldEvent[];
  environment: { hidden: boolean; reducedMotion: boolean; holdTransforms?: boolean };
  /** Reserved input, not a request to access a global random generator. */
  seed?: number;
}
export interface LayerEvaluation {
  layer: Decoration;
  frame?: PlacementFrame;
  bounds?: Bounds;
  position?: Point;
  localPosition?: Point;
  localRotationDeg?: number;
  parentId?: string;
  visible: boolean;
  renderable: boolean;
  locked: boolean;
  effectiveOpacity: number;
}
export interface GroupEvaluation {
  layer: GroupView;
  frame?: PlacementFrame;
  bounds?: Bounds;
  visible: boolean;
  renderable: boolean;
}
export interface WorldLayout {
  layers: LayerEvaluation[];
  groups: GroupEvaluation[];
  roots: string[];
}
export interface WorldMachineState {
  video: 'playing' | 'paused';
  /** Occurrences are consumed once per evaluation, never used as persistent booleans. */
  events: readonly WorldEvent[];
}
export interface WorldState {
  runtimeVersion: typeof WORLD_RUNTIME_VERSION;
  timeMs: number | null;
  effects: EffectState;
  machine: WorldMachineState;
  motion?: import('./motion').MotionState;
  models?: Record<string, import('./models').ModelState>;
}
export interface WorldFrame {
  timeMs: number;
  layout: WorldLayout;
  effects: EffectEvaluation[];
  machine: WorldMachineState;
  needsFrame: boolean;
  subscriptions: { pointer: boolean; video: boolean };
  models?: import('./models').ModelEvaluation[];
}
export const frameFor = (placement: LayerPlacement, geometry: WorldGeometry): PlacementFrame | undefined =>
  placement.anchor.kind === 'viewport'
    ? { left: 0, top: 0, ...geometry.viewport }
    : Object.hasOwn(geometry.anchors, placement.anchor.target)
      ? geometry.anchors[placement.anchor.target]
      : undefined;
