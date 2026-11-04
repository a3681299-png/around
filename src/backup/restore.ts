import { isDesignId, parseDesign } from '../design/schema';
import { designKey } from '../storage/designs';
import { designAssetIds } from '../design/references';
import { ASSET_LIMITS, ASSET_MESSAGES } from '../assets/limits';
import { BACKUP_LIMITS, BACKUP_MESSAGES, settingsStorageValues } from './schema';
import { sameBackupData } from './data';
import { validateTakeMerge } from '../browser/take-repository';
import type { SignalTake } from '../world/takes';
import { BACKUP_LIBRARY_LEASE, type StoredAsset } from '../assets/repository';
import type { ValidatedBackup } from './archive';
import { sameModelInfo } from '../models/types';

/** Additive restore. An existing artwork/take is never silently replaced. */
export function planRestore(
  backup: ValidatedBackup,
  local: Record<string, unknown>,
  existingAssets: readonly StoredAsset[],
  existingTakes: readonly SignalTake[],
  applySettings: boolean,
) {
  const { manifest } = backup;
  const incoming = new Map(manifest.designs.map((design) => [design.siteId, design]));
  for (const [key, value] of Object.entries(local)) {
    if (!key.startsWith('webWorldThemes.design.')) continue;
    const siteId = key.slice('webWorldThemes.design.'.length);
    if (!isDesignId(siteId)) throw new Error('既存の作品キーが不正です。');
    const existing = parseDesign(value);
    if (existing.siteId !== siteId) throw new Error('既存の作品のサイトが一致しません。');
    const own = incoming.get(siteId),
      sameId = manifest.designs.find((design) => design.id === existing.id);
    if ((own && !sameBackupData(existing, own)) || (sameId && !sameBackupData(existing, sameId)))
      throw new Error('作品IDまたは保存先が衝突しています: ' + siteId + '。既存の作品は上書きしません。');
  }
  const assets = new Map(existingAssets.map((row) => [row.id, row]));
  const refreshed: StoredAsset[] = [];
  for (const row of backup.assets) {
    const existing = assets.get(row.id);
    const metadata = ({ blob: _blob, leases: _leases, name: _name, model: _model, ...info }: StoredAsset) => info;
    // Reinspection can add body to a pre-v14 destination too. Only that missing fact is optional;
    // the worker still hashes reused originals before accepting the restore.
    if (
      existing &&
      (!sameBackupData(metadata(existing), metadata(row)) ||
        (existing.model ? !sameModelInfo(existing.model, row.model) : Boolean(row.model)) ||
        existing.blob.size !== row.blob.size)
    )
      throw new Error('既存素材のIDと内容が一致しません。');
    if (existing?.model?.vrm && existing.model.vrm.body === undefined && row.model?.vrm?.body) {
      // The restored artwork may already include body. Persist the verified measurement too,
      // or its next save would compare it against the old, unmeasured destination record.
      const next = {
        ...existing,
        model: { ...existing.model, vrm: { ...existing.model.vrm, body: row.model.vrm.body } },
      };
      assets.set(row.id, next);
      refreshed.push(next);
    }
    if (!existing) assets.set(row.id, row);
  }
  if (
    assets.size > ASSET_LIMITS.count ||
    [...assets.values()].reduce((sum, row) => sum + row.byteLength, 0) > ASSET_LIMITS.totalBytes
  )
    throw new Error(ASSET_MESSAGES.storage);
  validateTakeMerge(existingTakes, manifest.takes);
  const values: Record<string, unknown> = Object.fromEntries(
    manifest.designs.map((design) => [designKey(design.siteId), design]),
  );
  if (applySettings) Object.assign(values, settingsStorageValues(manifest.settings), manifest.preferences);
  const size = Object.entries({ ...local, ...values }).reduce(
    (sum, [key, value]) => sum + new TextEncoder().encode(key + JSON.stringify(value)).length,
    0,
  );
  if (size > BACKUP_LIMITS.localBytes) throw new Error(BACKUP_MESSAGES.localSize);
  const references = new Set(manifest.designs.flatMap(designAssetIds));
  const added = backup.assets
    .filter((row) => !existingAssets.some((existing) => existing.id === row.id))
    .map((row) => ({
      ...row,
      // Saved artwork protects referenced originals. Spare originals have no live tab
      // after migration, so retain them as a backup library within the normal quotas.
      leases: references.has(row.id) ? [] : [BACKUP_LIBRARY_LEASE],
    }));
  return { values, added, refreshed };
}
