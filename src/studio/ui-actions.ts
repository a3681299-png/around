import type { EditCommand } from '../editor-core/types';
import type { PanelActions } from '../editor/panel';

/** Both UI presentations use this exact command mapping. */
export function studioActions(dispatch: (command: EditCommand) => void, files: (files: readonly File[]) => void,
  thumbnail: (id: string) => Promise<string | undefined>): PanelActions {
  return {
    change: (style) => dispatch({ type: 'style', style }), save: () => dispatch({ type: 'save' }), discard: () => dispatch({ type: 'discard' }),
    reset: () => dispatch({ type: 'style', style: {} }), close: () => dispatch({ type: 'close' }), imageImport: files,
    imageSelect: (id, additive = false) => dispatch({ type: 'select', id, additive }), imageChange: (patch) => dispatch({ type: 'change', patch }),
    layerChange: (id, patch) => dispatch({ type: 'change', id, patch }), imageDelete: (id) => dispatch({ type: 'delete', ...(id ? { id } : {}) }),
    duplicate: (id) => dispatch({ type: 'duplicate', ...(id ? { id } : {}) }), reorder: (id, targetId, after) => dispatch({ type: 'reorder', id, targetId, after }),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }), snap: (value) => dispatch({ type: 'snap', value }), layout: (mode) => dispatch({ type: 'layout', mode }),
    group: () => dispatch({ type: 'group' }), ungroup: () => dispatch({ type: 'ungroup' }), clearSelection: () => dispatch({ type: 'clear-selection' }), selectAll: () => dispatch({ type: 'select-all' }), thumbnail,
  };
}
