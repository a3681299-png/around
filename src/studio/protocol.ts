import type { StudioStatePayload } from './state-sync';
import type { PackedCheckpoint } from './checkpoint-codec';
import type { EditCommand, EditorCheckpoint } from '../editor-core/types';
import type { DesignTarget } from '../design/types';
import type { TimelineCommand, TimelineUpdate } from '../timeline/types';

export const STUDIO_PORT = 'web-world-themes:studio-v1';
export const STUDIO_PROBE = 'web-world-themes:studio-probe';
export interface StudioTarget {
  id: number;
  title: string;
  siteId: string;
  enabled: boolean;
  anchors: readonly DesignTarget[];
  targets: readonly DesignTarget[];
}
export type StudioRequest =
  | { id: number; type: 'attach'; owner: string; resume?: EditorCheckpoint | PackedCheckpoint; visible?: boolean }
  | { id: number; type: 'surface-visibility'; visible: boolean }
  | { id: number; type: 'command'; session: string; revision: number; command: EditCommand }
  | { id: number; type: 'import-assets'; session: string; revision: number; assets: string[] }
  | { id: number; type: 'thumbnail'; layer: string }
  | { id: number; type: 'safety'; overlay: boolean }
  | { id: number; type: 'timeline'; session: string; command: TimelineCommand }
  | { id: number; type: 'detach' };
// Safety has a separate Host channel; no artwork command can relax protection.
export interface StudioUpdate extends StudioStatePayload {
  type: 'state';
}
export interface StudioReply extends StudioStatePayload {
  type: 'reply';
  id: number;
  ok: boolean;
  error?: string;
  thumbnail?: string;
}
export type StudioMessage =
  | StudioUpdate
  | StudioReply
  | { type: 'handoff' }
  | { type: 'timeline'; update: TimelineUpdate }
  | { type: 'safety'; status: import('../host/operation-guard').SafetyStatus };

export { parseEditCommand } from '../editor-core/commands';
