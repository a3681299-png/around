import { isAssetId, parseDesign } from '../design/schema';
import type { DesignDocument } from '../design/types';
import { parseSignalTake, type SignalTake } from '../world/takes';
import { ASSET_LIMITS, TAKE_LIMITS } from '../assets/limits';
import { DEFAULT_SETTINGS, SETTINGS_KEYS, type UserSettings } from '../storage/settings';
import { backupObject, backupNumber } from './data';
import { oneOf } from '../validation';

export const BACKUP_LIMITS = Object.freeze({
  metadataBytes: 80 * 1024 * 1024,
  localBytes: 10 * 1024 * 1024,
  designs: 16,
  preferenceBytes: 64 * 1024,
  get fileBytes() {
    return ASSET_LIMITS.totalBytes + this.metadataBytes;
  },
});
const mib = (bytes: number) => bytes / (1024 * 1024) + 'MiB';
export const BACKUP_MESSAGES = Object.freeze({
  fileSize: 'バックアップは合計' + mib(BACKUP_LIMITS.fileBytes) + 'までです。',
  metadataSize: 'バックアップのJSONは' + mib(BACKUP_LIMITS.metadataBytes) + 'までです。',
  localSize: '復元後のChrome設定と作品が保存上限' + mib(BACKUP_LIMITS.localBytes) + 'を超えます。',
});
export const BACKUP_PREFERENCE_KEYS = [
  'webWorldThemes.creator.guideDismissed',
  'webWorldThemes.studio.workspace.v1',
  'webWorldThemes.studio.workbench.v2',
  'webWorldThemes.studio.sidepanel.v1',
  'webWorldThemes.studio.timeline.v1',
  'webWorldThemes.settings.position.v1',
] as const;
export interface BackupAsset {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
}
export interface BackupManifest {
  format: 'web-world-themes-backup';
  version: 1;
  createdAt: string;
  settings: UserSettings;
  preferences: Record<string, unknown>;
  designs: DesignDocument[];
  takes: SignalTake[];
  assets: BackupAsset[];
}
const failure = () => new Error('バックアップの値または上限が不正です。');
const flag = (value: unknown): value is boolean => typeof value === 'boolean';
const sizedArray = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;

/** The retro theme's settings in backups made before its removal (docs/theme-removal.md). They
 * are checked exactly as before, so a damaged old backup is still refused, and then dropped. */
const LEGACY_NUMBERS = ['strength', 'noiseStrength'] as const;
const LEGACY_FEATURES = [
  'window-chrome',
  'palette',
  'glossy-titlebars',
  'focus-titlebars',
  'daily-details',
  'surface-noise',
  'bbs-comments',
  'transparent-background',
  'lcd-durations',
  'readable-votes',
];
const LEGACY_PALETTE = { hue: 360, saturation: 100, brightness: 100 } as const;

export function parseBackupSettings(raw: unknown): UserSettings {
  const supplied = backupObject(raw, [...Object.keys(SETTINGS_KEYS), ...LEGACY_NUMBERS, 'features', 'palette']);
  const value = { ...DEFAULT_SETTINGS, ...supplied };
  for (const key of Object.keys(SETTINGS_KEYS)) if (!flag(value[key as keyof UserSettings])) throw failure();
  for (const key of LEGACY_NUMBERS)
    if (Object.hasOwn(supplied, key) && (!backupNumber(supplied[key], 0, 100) || !Number.isInteger(supplied[key])))
      throw failure();
  const features = backupObject(Object.hasOwn(supplied, 'features') ? supplied['features'] : {}, LEGACY_FEATURES);
  if (Object.values(features).some((entry) => !flag(entry))) throw failure();
  const palette = backupObject(
    Object.hasOwn(supplied, 'palette') ? supplied['palette'] : {},
    Object.keys(LEGACY_PALETTE),
  );
  for (const [key, max] of Object.entries(LEGACY_PALETTE))
    if (Object.hasOwn(palette, key) && (!backupNumber(palette[key], 0, max) || !Number.isInteger(palette[key])))
      throw failure();
  return {
    creatorMode: value.creatorMode as boolean,
    // The strength slider at 0% was OFF: restoring such settings keeps the artwork hidden.
    enabled: (value.enabled as boolean) && supplied['strength'] !== 0,
  };
}

export function backupDesigns(local: Record<string, unknown>): DesignDocument[] {
  return Object.entries(local)
    .filter(([key]) => key.startsWith('webWorldThemes.design.'))
    .map(([key, raw]) => {
      const site = key.slice('webWorldThemes.design.'.length);
      try {
        const design = parseDesign(raw);
        if (site !== design.siteId) throw new Error('作品の保存先が不正です。');
        return design;
      } catch (error) {
        throw new Error(
          `サイトID「${site}」の作品を書き出せません: ${error instanceof Error ? error.message : '作品が不正です。'}`,
        );
      }
    });
}

/** Restore only declared preferences. Arbitrary storage keys never cross the boundary. */
export function parseBackupPreferences(raw: unknown): Record<string, unknown> {
  const preferences = backupObject(raw, BACKUP_PREFERENCE_KEYS);
  if (new TextEncoder().encode(JSON.stringify(preferences)).length > BACKUP_LIMITS.preferenceBytes) throw failure();
  for (const [key, rawValue] of Object.entries(preferences)) {
    if (key === BACKUP_PREFERENCE_KEYS[0]) {
      if (!flag(rawValue)) throw failure();
      continue;
    }
    const allowed = key.endsWith('timeline.v1')
      ? ['open', 'height', 'zoom']
      : key.endsWith('position.v1')
        ? ['x', 'y']
        : key.endsWith('workspace.v1')
          ? ['width', 'dock', 'split', 'area', 'minimized', 'folds']
          : ['leftWidth', 'rightWidth', 'ratio', 'wideRatio', 'leftClosed', 'rightClosed', 'dock', 'folds'];
    const value = backupObject(rawValue, allowed);
    for (const [field, entry] of Object.entries(value)) {
      if (field === 'dock') {
        if (!oneOf(entry, ['left', 'right'])) throw failure();
      } else if (field === 'area') {
        if (!oneOf(entry, ['layers', 'properties', 'help'])) throw failure();
      } else if (['open', 'split', 'minimized', 'leftClosed', 'rightClosed'].includes(field)) {
        if (!flag(entry)) throw failure();
      } else if (field === 'folds') {
        if (
          !sizedArray(entry, 128) ||
          entry.some(
            (item) =>
              !Array.isArray(item) ||
              item.length !== 2 ||
              typeof item[0] !== 'string' ||
              item[0].length > 120 ||
              /[\u0000-\u001f]/.test(item[0]) ||
              !flag(item[1]),
          )
        )
          throw failure();
      } else if (!backupNumber(entry, 0, ['ratio', 'wideRatio'].includes(field) ? 1 : field === 'zoom' ? 16 : 100_000))
        throw failure();
    }
    if (key.endsWith('position.v1') && (!backupNumber(value['x'], 0, 100_000) || !backupNumber(value['y'], 0, 100_000)))
      throw failure();
  }
  return structuredClone(preferences);
}

export function settingsStorageValues(settings: UserSettings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(SETTINGS_KEYS).map(([field, key]) => [key, settings[field as keyof UserSettings]]),
  );
}

export function parseBackupManifest(raw: unknown): BackupManifest {
  const value = backupObject(raw, [
    'format',
    'version',
    'createdAt',
    'settings',
    'preferences',
    'designs',
    'takes',
    'assets',
  ]);
  if (
    value['format'] !== 'web-world-themes-backup' ||
    value['version'] !== 1 ||
    typeof value['createdAt'] !== 'string' ||
    value['createdAt'].length > 40 ||
    !Number.isFinite(Date.parse(value['createdAt'])) ||
    !sizedArray(value['designs'], BACKUP_LIMITS.designs) ||
    !sizedArray(value['takes'], TAKE_LIMITS.storedCount) ||
    !sizedArray(value['assets'], ASSET_LIMITS.count)
  )
    throw failure();
  // Count limits precede per-document / per-take validation.
  const designs = value['designs'].map((item) => parseDesign(item));
  const takes = value['takes'].map((item) => parseSignalTake(item));
  const assets = value['assets'].map((raw): BackupAsset => {
    const asset = backupObject(raw, ['id', 'name', 'mime', 'byteLength']);
    if (
      !isAssetId(asset['id']) ||
      typeof asset['name'] !== 'string' ||
      !asset['name'].length ||
      asset['name'].length > 120 ||
      /[\u0000-\u001f]/.test(asset['name']) ||
      !oneOf(asset['mime'], [
        'image/png',
        'image/webp',
        'image/gif',
        'application/json',
        'video/webm',
        'model/gltf-binary',
      ]) ||
      !backupNumber(
        asset['byteLength'],
        1,
        asset['mime'] === 'model/gltf-binary' ? ASSET_LIMITS.modelBytes : ASSET_LIMITS.fileBytes,
      ) ||
      !Number.isInteger(asset['byteLength'])
    )
      throw failure();
    return asset as unknown as BackupAsset;
  });
  const unique = (items: readonly string[]) => new Set(items).size === items.length;
  if (
    !unique(designs.map((doc) => doc.siteId)) ||
    !unique(designs.map((doc) => doc.id)) ||
    !unique(takes.map((take) => take.id)) ||
    !unique(assets.map((asset) => asset.id)) ||
    assets.reduce((sum, asset) => sum + asset.byteLength, 0) > ASSET_LIMITS.totalBytes ||
    takes.reduce((sum, take) => sum + JSON.stringify(take).length, 0) > TAKE_LIMITS.storedChars
  )
    throw failure();
  return {
    format: 'web-world-themes-backup',
    version: 1,
    createdAt: value['createdAt'],
    settings: parseBackupSettings(value['settings']),
    preferences: parseBackupPreferences(value['preferences']),
    designs,
    takes,
    assets,
  };
}
