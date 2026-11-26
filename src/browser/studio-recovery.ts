import { packCheckpoint, unpackCheckpoint } from '../studio/checkpoint-codec';
import type { StudioRecovery } from '../studio/connection';
import { retainStudioAssets, releaseAssets } from './asset-client';
import { designAssetIds } from '../design/references';
import type { EditorRevision } from '../editor-core/types';

const prefix = 'around.studio.session.';
const maxBytes = 6 * 1024 * 1024;
function identity(stored: unknown, origin: EditorRevision | undefined) {
  return origin ? `${origin.sessionId}:${origin.revision}` : JSON.stringify(stored);
}
/** Session-only, extension-trusted recovery. Artwork and original bytes stay in their existing stores. */
export function createStudioRecovery(studioTab: number): StudioRecovery {
  const seen = new Map<number, string | undefined>();
  function leaseId(target: number) {
    return `session-studio-${studioTab}-${target}`;
  }
  return {
    async read(target) {
      const key = `${prefix}${target}`,
        checkpoint = await navigator.locks.request(key, async () => {
          const stored: unknown = (await chrome.storage.session.get(key))[key];
          const value = unpackCheckpoint(stored);
          seen.set(target, identity(stored, value?.origin));
          return value;
        });
      return checkpoint; // Full document/history validation happens in Core before use.
    },
    write(target, checkpoint, origin) {
      const key = `${prefix}${target}`;
      const copy = checkpoint === undefined ? undefined : packCheckpoint(checkpoint);
      // The side panel and the separate window share this slot. A late write
      // can follow a handoff, even though each surface processes its own states in order.
      return navigator.locks.request(key, async () => {
        const current: unknown = (await chrome.storage.session.get(key))[key];
        const storedOrigin = unpackCheckpoint(current)?.origin;
        if (storedOrigin?.sessionId === origin.sessionId) {
          if (storedOrigin.revision > origin.revision) return;
        } else if (identity(current, storedOrigin) !== seen.get(target)) {
          if (!copy) return;
          throw new Error('別のエディターの作業中のコピーを保持しています。');
        }
        const session = leaseId(target);
        if (!copy || !checkpoint) {
          await chrome.storage.session.remove(key);
          seen.delete(target);
          await releaseAssets(session);
        } else {
          const text = JSON.stringify(copy);
          if (new TextEncoder().encode(text).length > maxBytes)
            throw new Error('復旧用の履歴が大きすぎます。作品を保存してください。');
          const documents = [
            checkpoint.draft,
            ...checkpoint.history.past,
            ...checkpoint.history.future,
            ...(checkpoint.history.transaction ? [checkpoint.history.transaction] : []),
          ];
          const ids = [...new Set(documents.flatMap(designAssetIds))];
          // Pin first: a reloaded target can release its old document lease at any time.
          await retainStudioAssets(session, ids, studioTab);
          await chrome.storage.session.set({ [key]: copy });
          seen.set(target, identity(copy, checkpoint.origin));
        }
      });
    },
  };
}
