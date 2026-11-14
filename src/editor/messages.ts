export const PROBE_EDITOR_TARGET = 'around:probe-editor-target';

export interface OpenEditorResponse {
  ok: boolean;
  error?: string;
}

export const PREPARE_SIDE_PANEL = 'around:prepare-side-panel';
export const OPEN_SIDE_PANEL = 'around:open-side-panel';
export const OPEN_STUDIO_WINDOW = 'around:open-studio-window';
export const CLOSE_SIDE_PANEL = 'around:close-side-panel';
