import type { AssetInfo } from './validation';

// Only the byte inspector registers a Blob it just created from those bytes.
// Blob is immutable; a MIME/name/metadata supplied by a caller is not a receipt.
const models = new WeakMap<Blob, number>();
const inspected = new WeakMap<AssetInfo, number>();
export const rememberModelInspection = (info: AssetInfo, gpuBytes: number) => { inspected.set(info, gpuBytes); };
export function rememberVerifiedSource(blob: Blob, info: AssetInfo) {
  const bytes = inspected.get(info); if (bytes !== undefined) models.set(blob, bytes);
}
export const verifiedModelBytes = (blob: Blob) => models.get(blob);
