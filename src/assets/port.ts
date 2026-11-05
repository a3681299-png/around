import type { AssetMetadata } from './validation';
import type { VerifiedModelSource } from './verified-source';

/**
 * How the page runtime reads stored assets. The extension's implementation (IndexedDB through
 * the worker) lives in `src/browser/asset-client.ts`; the Playground passes a fetch-based one.
 * Either way the bytes are inspected again before the renderers see them.
 */
export type LoadedAsset = { metadata: AssetMetadata } & (
  { blob: Blob; modelBuffer?: never } | { modelBuffer: VerifiedModelSource; blob?: never }
);
export const assetSourceBytes = (asset: LoadedAsset) => asset.modelBuffer?.byteLength ?? asset.blob!.size;

export interface AssetPort {
  load(id: string, signal?: AbortSignal): Promise<LoadedAsset>;
  /** Drops cached sources when the renderer that used them closes. */
  clear(): void;
}
