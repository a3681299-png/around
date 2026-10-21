import type { AssetReadSource } from './read-protocol';

export type AssetReadAdapter = (id: string, signal: AbortSignal) => Promise<AssetReadSource | undefined>;
let reader: AssetReadAdapter | undefined;
/** Installed only by the browser host; extension pages retain their existing path. */
export function installAssetReadAdapter(next: AssetReadAdapter) {
  reader = next;
  return () => {
    if (reader === next) reader = undefined;
  };
}
export const readAssetBuffer: AssetReadAdapter = (id, signal) => reader?.(id, signal) ?? Promise.resolve(undefined);
