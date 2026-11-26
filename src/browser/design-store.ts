// The extension's storage of artworks (chrome.storage.local), one per site.
import { parseDesign } from '../design/schema';
import type { DesignDocument } from '../design/types';
import type { EditorRevision } from '../editor-core/types';
import { designKey } from '../storage/designs';

const savedThroughKey = (siteId: string) => `around.studio.savedThrough.${siteId}`;

export async function readDesign(siteId: string): Promise<DesignDocument | undefined> {
  const key = designKey(siteId);
  const stored = (await chrome.storage.local.get(key))[key] as unknown;
  if (stored === undefined) return undefined;
  const design = parseDesign(stored);
  if (design.siteId !== siteId) throw new Error('デザインの対象サイトが一致しません。');
  return design;
}

export async function readSavedThrough(siteId: string): Promise<EditorRevision | undefined> {
  const key = savedThroughKey(siteId);
  return (await chrome.storage.local.get(key))[key] as EditorRevision | undefined;
}

export async function saveDesign(input: DesignDocument, savedThrough?: EditorRevision): Promise<void> {
  const design = parseDesign(input);
  // Record the checkpoint boundary with the artwork, even if Studio disconnects
  // before the save acknowledgement reaches it.
  await chrome.storage.local.set({
    [designKey(design.siteId)]: design,
    ...(savedThrough ? { [savedThroughKey(design.siteId)]: savedThrough } : {}),
  });
}

/** Like settings, subscribe before reading so a slow read cannot undo an update. */
export function watchDesign(
  siteId: string,
  listener: (design: DesignDocument | undefined) => void,
  onError: (error: unknown) => void,
): () => void {
  const key = designKey(siteId);
  let active = true;
  let changed = false;
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (!active || area !== 'local' || !Object.hasOwn(changes, key)) return;
    changed = true;
    try {
      const value = changes[key]?.newValue as unknown;
      const design = value === undefined ? undefined : parseDesign(value);
      if (design && design.siteId !== siteId) throw new Error('デザインの対象サイトが一致しません。');
      listener(design);
    } catch (error) {
      onError(error);
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  void readDesign(siteId)
    .then((design) => {
      if (active && !changed) listener(design);
    })
    .catch((error: unknown) => {
      if (active && !changed) onError(error);
    });
  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
