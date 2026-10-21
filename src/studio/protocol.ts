import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
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
  | { id: number; type: 'attach'; owner: string; resume?: EditorCheckpoint; visible?: boolean }
  | { id: number; type: 'surface-visibility'; visible: boolean }
  | { id: number; type: 'command'; session: string; revision: number; command: EditCommand }
  | { id: number; type: 'import-assets'; session: string; revision: number; assets: string[] }
  | { id: number; type: 'thumbnail'; layer: string }
  | { id: number; type: 'timeline'; session: string; command: TimelineCommand }
  | { id: number; type: 'detach' };
export interface StudioUpdate {
  type: 'state';
  state: EditorSnapshot;
  checkpoint?: EditorCheckpoint;
}
export interface StudioReply {
  type: 'reply';
  id: number;
  ok: boolean;
  error?: string;
  state?: EditorSnapshot;
  checkpoint?: EditorCheckpoint;
  thumbnail?: string;
}
export type StudioMessage =
  StudioUpdate | StudioReply | { type: 'handoff' } | { type: 'timeline'; update: TimelineUpdate };

export { parseEditCommand } from '../editor-core/commands';
