import type { EditCommand, EditorView } from './types';

export interface ShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}
/** Same meanings in every Host; text/composition and DOM focus guards belong to the UI adapter. */
export function shortcutCommand(
  input: ShortcutInput,
  state: Pick<EditorView, 'selectedIds' | 'saving'>,
  tools = false,
): EditCommand | undefined {
  if (input.isComposing) return;
  const command = (input.ctrlKey || input.metaKey) && !input.altKey,
    key = input.key.toLowerCase();
  if (tools && !command && !input.altKey && ['v', 'h', 'c', 'u'].includes(key))
    return { type: 'tool', tool: key === 'h' ? 'browse' : key === 'c' ? 'card' : key === 'u' ? 'skin' : 'select' };
  if (command && (key === 'z' || key === 'y')) return { type: key === 'y' || input.shiftKey ? 'redo' : 'undo' };
  if (command && key === 'd' && state.selectedIds.length) return { type: 'duplicate' };
  if (input.key === 'Delete' && state.selectedIds.length) return { type: 'delete' };
  if (input.key === 'Escape' && !state.saving) return { type: 'clear-selection' };
  if (input.key.startsWith('Arrow') && !command && !input.altKey && state.selectedIds.length) {
    const amount = input.shiftKey ? 10 : 1;
    return {
      type: 'nudge',
      delta: {
        x: input.key === 'ArrowRight' ? amount : input.key === 'ArrowLeft' ? -amount : 0,
        y: input.key === 'ArrowDown' ? amount : input.key === 'ArrowUp' ? -amount : 0,
      },
    };
  }
}
