import type { StudioStatePayload } from './state-sync';
import type { PackedCheckpoint } from './checkpoint-codec';
import type { EditCommand, EditorCheckpoint } from '../editor-core/types';
import type { DesignTarget } from '../design/types';
import type { TimelineCommand, TimelineUpdate } from '../timeline/types';
import type { SkinSlot } from '../editor-core/skins';
import type { SkinPageInfo } from '../editor/skin-status';

export const STUDIO_PORT = 'around:studio-v1';
export const STUDIO_PROBE = 'around:studio-probe';
export interface StudioTarget {
  id: number;
  title: string;
  siteId: string;
  enabled: boolean;
  anchors: readonly DesignTarget[];
  targets: readonly DesignTarget[];
}
export type StudioRequest =
  | { id: number; type: 'attach'; owner: string; resume?: EditorCheckpoint | PackedCheckpoint }
  | { id: number; type: 'command'; session: string; revision: number; command: EditCommand }
  | { id: number; type: 'import-assets'; session: string; revision: number; assets: string[] }
  // UI skin art into one slot of the selected part (Core accepts exactly one picture).
  | { id: number; type: 'import-skin'; session: string; revision: number; assets: string[]; slot: SkinSlot }
  // .vrma motions for one VRM layer's character; labels come from the folder's manifest.json.
  | {
      id: number;
      type: 'import-motions';
      session: string;
      revision: number;
      assets: string[];
      layer: string;
      labels: [string, { name: string; role: string; loop: boolean }][];
      origin: 'standard' | 'character';
    }
  | { id: number; type: 'thumbnail'; layer: string }
  | { id: number; type: 'safety'; overlay: boolean }
  // 描画を再開 in 操作チェック: ends a stop the guard no longer recovers from by itself.
  | { id: number; type: 'safety-resume' }
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
  | { type: 'skin-page'; info: readonly SkinPageInfo[] }
  | { type: 'safety'; status: import('../host/operation-guard').SafetyStatus };

export { parseEditCommand } from '../editor-core/commands';
