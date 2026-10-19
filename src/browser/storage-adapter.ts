import type { EditorStorage } from '../editor-core/types';
import { checkDesignAssets, commitDesign, importAssets, releaseAssets, retainAssets } from '../assets/client';
import { readDesign, watchDesign } from '../storage/designs';
import type { AssetMetadata } from '../assets/validation';

export type BrowserImportSource = readonly File[] | { kind: 'stored-assets'; items: readonly AssetMetadata[]; length: number };

/** Browser implementation. File/decode/Chrome/IndexedDB details do not enter Editor Core. */
export function createBrowserEditorStorage(siteId: string): EditorStorage<BrowserImportSource> {
  let pending: AbortController | undefined;
  return {
    read: () => readDesign(siteId), watch: (accept, error) => watchDesign(siteId, accept, error),
    retain: retainAssets, release: releaseAssets, save: commitDesign, validate: checkDesignAssets,
    async import(files, session) {
      if ('kind' in files) {
        if (files.length !== files.items.length || !files.length || files.length > 8) throw new Error('素材参照が不正です。');
        // Pre-inspected Studio imports are leased before Core validates the full
        // document against authoritative IndexedDB metadata. Never transfer the
        // binary through the YouTube tab and back a second time.
        await retainAssets(session, files.items.map((asset) => asset.id)); return [...files.items];
      }
      const controller = new AbortController(); pending = controller;
      try { return await importAssets(files, session, controller.signal); }
      finally { if (pending === controller) pending = undefined; }
    },
    cancelImport() { pending?.abort(); pending = undefined; },
  };
}
