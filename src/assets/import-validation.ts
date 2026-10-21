import type { AssetInfo } from './validation';
import { ASSET_LIMITS, ASSET_MESSAGES } from './limits';

export function validateImportBatchSizes(sizes: readonly number[]): void {
  if (!sizes.length || sizes.length > ASSET_LIMITS.batchCount) throw new Error(ASSET_MESSAGES.batchCount);
  const large = sizes.some((size) => size > ASSET_LIMITS.fileBytes);
  if (sizes.reduce((total, size) => total + size, 0) > (large ? ASSET_LIMITS.batchBytes : ASSET_LIMITS.fileBytes))
    throw new Error(ASSET_MESSAGES.batchSize);
}

/** Receipts come only from this worker's fully validated, content-hashed bytes. */
export function canReuseImportInspection(cached: AssetInfo | undefined, mime: string): cached is AssetInfo {
  // Validated model bytes determine their format independently of the OS MIME label.
  return cached !== undefined && (!mime || cached.mime === mime || Boolean(cached.model));
}
