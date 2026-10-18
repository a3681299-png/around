import type { EditorCheckpoint } from '../editor-core/types';
import type { StudioRecovery } from '../studio/connection';
import { retainStudioAssets, releaseAssets } from '../assets/client';

const prefix = 'webWorldThemes.studio.session.';
const maxBytes = 6 * 1024 * 1024;
/** Session-only, extension-trusted recovery. Artwork and original bytes stay in their existing stores. */
export function createStudioRecovery(studioTab: number): StudioRecovery {
  let queue: Promise<unknown> = Promise.resolve();
  function leaseId(target: number) { return `session-studio-${studioTab}-${target}`; }
  return {
    async read(target) {
      const key = `${prefix}${target}`, value: unknown = (await chrome.storage.session.get(key))[key];
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return;
      return value as EditorCheckpoint; // Full document/history validation happens in Core before use.
    },
    write(target, checkpoint) {
      const copy = checkpoint === undefined ? undefined : JSON.parse(JSON.stringify(checkpoint)) as EditorCheckpoint;
      const operation = queue.catch(() => undefined).then(async () => {
        const key = `${prefix}${target}`, session = leaseId(target);
        if (!copy) { await chrome.storage.session.remove(key); await releaseAssets(session); return; }
        const text = JSON.stringify(copy);
        if (new TextEncoder().encode(text).length > maxBytes) throw new Error('復旧用の履歴が大きすぎます。作品を保存してください。');
        const documents = [copy.draft, ...copy.history.past, ...copy.history.future, ...(copy.history.transaction ? [copy.history.transaction] : [])];
        const ids = [...new Set(documents.flatMap((doc) => doc.decorations.map((layer) => layer.assetId)))];
        // Pin first: a reloaded target can release its old document lease at any time.
        await retainStudioAssets(session, ids, studioTab);
        await chrome.storage.session.set({ [key]: copy });
      });
      queue = operation; return operation;
    },
  };
}
