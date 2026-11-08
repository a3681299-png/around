import { skinAssetIds } from './schema';
import type { DesignDocument } from './types';

/** Every asset a document keeps alive: layers and UI skins. Storage, leases and backups share this. */
export function designAssetIds(
  design: Pick<DesignDocument, 'decorations' | 'rules'> & Partial<Pick<DesignDocument, 'space'>>,
): string[] {
  return [
    ...new Set([
      ...design.decorations.flatMap((layer) => [
        layer.assetId,
        ...(layer.kind === 'model3d' && layer.character ? layer.character.motions.map((m) => m.assetId) : []),
      ]),
      ...design.rules.flatMap((rule) => (rule.skin ? skinAssetIds(rule.skin) : [])),
      ...(design.space ? [design.space.room.assetId] : []),
    ]),
  ];
}
