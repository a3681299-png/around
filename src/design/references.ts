import { skinAssetIds } from './schema';
import type { DesignDocument } from './types';

/** Every asset a document keeps alive: layers and UI skins. Storage, leases and backups share this. */
export function designAssetIds(design: Pick<DesignDocument, 'decorations' | 'rules'>): string[] {
  return [
    ...new Set([
      ...design.decorations.map((layer) => layer.assetId),
      ...design.rules.flatMap((rule) => (rule.skin ? skinAssetIds(rule.skin) : [])),
    ]),
  ];
}
