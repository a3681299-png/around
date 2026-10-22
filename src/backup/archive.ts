import { parseBackupManifest, BACKUP_LIMITS, BACKUP_MESSAGES, type BackupManifest } from './schema';
import { validateAssetBytes } from '../assets/validate-bytes';
import { validateDesignAssets } from '../assets/design-assets';
import type { StoredAsset } from '../assets/repository';

const magic = new TextEncoder().encode('WWT-BACKUP-0001\n');
export const BACKUP_HEADER_BYTES = magic.length + 4 + 32;
export interface ValidatedBackup {
  manifest: BackupManifest;
  assets: StoredAsset[];
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
async function validateOriginals(manifest: BackupManifest, blobs: readonly Blob[]): Promise<StoredAsset[]> {
  if (blobs.length !== manifest.assets.length) throw new Error('バックアップの素材数が一致しません。');
  const rows: StoredAsset[] = [];
  for (const [index, metadata] of manifest.assets.entries()) {
    const original = blobs[index]!;
    if (original.size !== metadata.byteLength) throw new Error('素材のサイズが一致しません。');
    const bytes = new Uint8Array(await original.arrayBuffer());
    if ('asset-' + (await sha256(bytes)) !== metadata.id) throw new Error('素材のSHA-256が一致しません。');
    const { info, blob } = await validateAssetBytes(bytes, metadata.mime);
    rows.push({ ...metadata, ...info, blob, leases: [] });
  }
  const assets = new Map(rows.map((row) => [row.id, row]));
  for (const design of manifest.designs) validateDesignAssets(design.decorations, assets);
  return rows;
}

/** Fixed header + hashed UTF-8 manifest + bounded original blobs. No paths or executable content. */
export async function encodeBackup(input: BackupManifest, originals: readonly Blob[]): Promise<Blob> {
  const manifest = parseBackupManifest(input);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (bytes.length > BACKUP_LIMITS.metadataBytes) throw new Error(BACKUP_MESSAGES.metadataSize);
  await validateOriginals(manifest, originals);
  const header = new Uint8Array(BACKUP_HEADER_BYTES);
  header.set(magic);
  new DataView(header.buffer).setUint32(magic.length, bytes.length, true);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), magic.length + 4);
  const file = new Blob([header, bytes, ...originals], { type: 'application/octet-stream' });
  if (file.size > BACKUP_LIMITS.fileBytes) throw new Error(BACKUP_MESSAGES.fileSize);
  return file;
}

/** Validate the whole archive before any persistent mutation. Hashes detect corruption, not authorship. */
export async function decodeBackup(file: Blob): Promise<ValidatedBackup> {
  if (file.size > BACKUP_LIMITS.fileBytes) throw new Error(BACKUP_MESSAGES.fileSize);
  if (file.size < BACKUP_HEADER_BYTES) throw new Error('バックアップのヘッダーが不正です。');
  const header = new Uint8Array(await file.slice(0, BACKUP_HEADER_BYTES).arrayBuffer());
  if (!magic.every((byte, index) => header[index] === byte)) throw new Error('未対応のバックアップ形式です。');
  const length = new DataView(header.buffer).getUint32(magic.length, true);
  if (!length || length > BACKUP_LIMITS.metadataBytes) throw new Error(BACKUP_MESSAGES.metadataSize);
  if (BACKUP_HEADER_BYTES + length > file.size) throw new Error('バックアップが途中で切れています。');
  const bytes = new Uint8Array(await file.slice(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + length).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (!digest.every((byte, index) => header[magic.length + 4 + index] === byte))
    throw new Error('バックアップのJSONのSHA-256が一致しません。');
  const manifest = parseBackupManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const expected = BACKUP_HEADER_BYTES + length + manifest.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (expected !== file.size) throw new Error('バックアップの素材サイズまたは末尾が不正です。');
  let offset = BACKUP_HEADER_BYTES + length;
  const originals = manifest.assets.map((asset) => {
    const blob = file.slice(offset, offset + asset.byteLength);
    offset += asset.byteLength;
    return blob;
  });
  return { manifest, assets: await validateOriginals(manifest, originals) };
}
