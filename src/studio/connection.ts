import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import type { StudioTarget } from './protocol';
import type { TimelinePort } from '../timeline/types';

export interface StudioConnectionState {
  target: number | undefined;
  connected: boolean;
  message: string;
  state?: EditorSnapshot;
}
/** A Studio uses commands and snapshots, never a Chrome tab or site DOM. */
export interface StudioConnection {
  readonly safety?: {
    subscribe(listener: (status: import('../host/operation-guard').SafetyStatus) => void): () => void;
    overlay(value: boolean): Promise<void>;
  };
  readonly timeline?: TimelinePort;
  targets(): Promise<StudioTarget[]>;
  select(target: number, resume?: EditorCheckpoint): Promise<void>;
  reconnect(): void;
  dispatch(command: EditCommand): Promise<void>;
  import(files: readonly File[]): Promise<void>;
  thumbnail(id: string): Promise<string | undefined>;
  focusTarget(): Promise<void>;
  openWorkspace(surface?: 'inpage' | 'sidepanel' | 'window'): Promise<void>;
  readonly state: EditorSnapshot | undefined;
  readonly target: number | undefined;
  readonly isConnected: boolean;
  stop(): void;
  destroy(): void;
}
export interface StudioRecovery {
  read(target: number): Promise<EditorCheckpoint | undefined>;
  write(target: number, checkpoint: EditorCheckpoint | undefined): Promise<void>;
}
