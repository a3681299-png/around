import type { EditorStorage } from '../editor-core/types';
import { checkDesignAssets, commitDesign, importAssets, releaseAssets, retainAssets } from '../assets/client';
import { readDesign, watchDesign } from '../storage/designs';

/** Browser implementation. File/decode/Chrome/IndexedDB details do not enter Editor Core. */
export function createBrowserEditorStorage(siteId: string): EditorStorage<readonly File[]> {
  let pending: AbortController | undefined;
  return {
    read: () => readDesign(siteId), watch: (accept, error) => watchDesign(siteId, accept, error),
    retain: retainAssets, release: releaseAssets, save: commitDesign, validate: checkDesignAssets,
    async import(files, session) {
      const controller = new AbortController(); pending = controller;
      try { return await importAssets(files, session, controller.signal); }
      finally { if (pending === controller) pending = undefined; }
    },
    cancelImport() { pending?.abort(); pending = undefined; },
  };
}
