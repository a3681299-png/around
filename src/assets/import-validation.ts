import type { AssetInfo } from './validation';

/** Receipts come only from this worker's fully validated, content-hashed bytes. */
export function canReuseImportInspection(cached: AssetInfo | undefined, mime: string): cached is AssetInfo {
  return cached !== undefined && (!mime || cached.mime === mime || Boolean(cached.model && ['application/octet-stream', 'model/vrm', 'application/vrm'].includes(mime)));
}
