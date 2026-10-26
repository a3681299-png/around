import { test, expect } from '@playwright/test';
import { emptyDesign } from '../src/design/schema';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/storage/settings';
import {
  BACKUP_LIMITS,
  backupDesigns,
  parseBackupSettings,
  parseBackupManifest,
  type BackupManifest,
} from '../src/backup/schema';
import { BACKUP_HEADER_BYTES, encodeBackup, decodeBackup, sha256, type ValidatedBackup } from '../src/backup/archive';
import { planRestore } from '../src/backup/restore';
import { createBackupService } from '../src/background/backup';
import { BACKUP_MESSAGE } from '../src/backup/protocol';
import { modelFixture } from './helpers/model-fixture';
import type { StoredAsset } from '../src/assets/repository';

function manifest(): BackupManifest {
  return {
    format: 'web-world-themes-backup',
    version: 1,
    createdAt: '2026-10-22T00:00:00Z',
    settings: mergeSettings(DEFAULT_SETTINGS, {}),
    preferences: {},
    designs: [],
    takes: [],
    assets: [],
  };
}

test('older backups fill missing settings with defaults while rejecting unknown or invalid supplied values', () => {
  expect(parseBackupSettings({})).toEqual(DEFAULT_SETTINGS);
  expect(parseBackupSettings({ enabled: true, features: {}, palette: { hue: 25 } })).toEqual({
    ...DEFAULT_SETTINGS,
    enabled: true,
    palette: { ...DEFAULT_SETTINGS.palette, hue: 25 },
  });
  for (const settings of [
    { enabled: undefined },
    { palette: { unknown: 1 } },
    { features: { unknown: true } },
    { unknown: false },
    { strength: '60' },
  ])
    expect(() => parseBackupSettings(settings)).toThrow();
});

test('export identifies the site of a corrupt saved design', () => {
  expect(() => backupDesigns({ 'webWorldThemes.design.youtube': { broken: true } })).toThrow('サイトID「youtube」');
  expect(() => backupDesigns({ 'webWorldThemes.design.other': emptyDesign('youtube', 'retro') })).toThrow(
    'サイトID「other」',
  );
});
function untexturedModel() {
  return new Uint8Array(
    modelFixture((json) => {
      json.images = [];
      json.textures = [];
      json.materials[0].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1] };
    }),
  );
}
async function uncheckedArchive(value: unknown, payload: Uint8Array<ArrayBuffer> = new Uint8Array()) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)),
    header = new Uint8Array(BACKUP_HEADER_BYTES);
  header.set(new TextEncoder().encode('WWT-BACKUP-0001\n'));
  new DataView(header.buffer).setUint32(BACKUP_HEADER_BYTES - 36, bytes.length, true);
  header.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), BACKUP_HEADER_BYTES - 32);
  return new Blob([header, bytes, payload]);
}
test('backup round trips bounded original GLB bytes without Base64', async () => {
  const bytes = untexturedModel(),
    value = manifest(),
    id = 'asset-' + (await sha256(bytes));
  value.assets.push({ id, name: 'tiny.glb', mime: 'model/gltf-binary', byteLength: bytes.length });
  const file = await encodeBackup(value, [new Blob([bytes])]),
    result = await decodeBackup(file);
  expect(result.manifest).toEqual(value);
  expect(new Uint8Array(await result.assets[0]!.blob.arrayBuffer())).toEqual(bytes);
  expect(file.size).toBeLessThan(bytes.length + 6000);
});
test('backup refuses changed JSON, changed originals, truncation and trailing bytes', async () => {
  const bytes = untexturedModel(),
    value = manifest(),
    id = 'asset-' + (await sha256(bytes));
  value.assets.push({ id, name: 'tiny.glb', mime: 'model/gltf-binary', byteLength: bytes.length });
  const file = await encodeBackup(value, [new Blob([bytes])]),
    damaged = new Uint8Array(await file.arrayBuffer());
  damaged[BACKUP_HEADER_BYTES + 5] = damaged[BACKUP_HEADER_BYTES + 5]! ^ 1;
  await expect(decodeBackup(new Blob([damaged]))).rejects.toThrow('SHA-256');
  const original = new Uint8Array(await file.arrayBuffer());
  original[original.length - 1] = original[original.length - 1]! ^ 1;
  await expect(decodeBackup(new Blob([original]))).rejects.toThrow('SHA-256');
  await expect(decodeBackup(file.slice(0, file.size - 1))).rejects.toThrow('サイズ');
  await expect(decodeBackup(new Blob([file, 'x']))).rejects.toThrow('末尾');
});
test('backup rejects unknown versions, unknown keys, coerced types and excessive counts before parsing entries', () => {
  for (const patch of [
    { version: 2 },
    { future: true },
    { takes: Array(9).fill(null) },
    { assets: Array(129).fill(null) },
  ])
    expect(() => parseBackupManifest({ ...manifest(), ...patch })).toThrow();
  for (const strength of [NaN, Infinity, ['60'], '60', -1, 101])
    expect(() => parseBackupManifest({ ...manifest(), settings: { ...DEFAULT_SETTINGS, strength } })).toThrow();
  expect(() => parseBackupManifest({ ...manifest(), preferences: { 'webWorldThemes.design.youtube': {} } })).toThrow();
  expect(() =>
    parseBackupManifest({ ...manifest(), preferences: { 'webWorldThemes.studio.workspace.v1': { area: ['layers'] } } }),
  ).toThrow();
});
test('backup enforces archive and metadata byte bounds before allocating a payload', async () => {
  const file = await encodeBackup(manifest(), []);
  const header = new Uint8Array(await file.slice(0, BACKUP_HEADER_BYTES).arrayBuffer());
  new DataView(header.buffer).setUint32(BACKUP_HEADER_BYTES - 36, BACKUP_LIMITS.metadataBytes + 1, true);
  await expect(decodeBackup(new Blob([header]))).rejects.toThrow('80MiB');
  const huge = { size: BACKUP_LIMITS.fileBytes + 1 } as Blob;
  await expect(decodeBackup(huge)).rejects.toThrow('336MiB');
});
test('archive validation rejects malformed GLB and MIME mismatches even with a correct content hash', async () => {
  for (const [bytes, mime] of [
    [new Uint8Array([1, 2, 3, 4]), 'model/gltf-binary'],
    [new Uint8Array(modelFixture()), 'image/png'],
  ] as const) {
    const value = manifest();
    value.assets.push({ id: 'asset-' + (await sha256(bytes)), name: 'invalid', mime, byteLength: bytes.length });
    await expect(decodeBackup(await uncheckedArchive(value, bytes))).rejects.toThrow();
  }
});
test('backup requires all referenced originals and validates take contents', async () => {
  const value = manifest(),
    doc = emptyDesign('youtube', 'retro');
  doc.decorations.push({
    id: 'image-a',
    kind: 'image',
    assetId: 'asset-' + 'a'.repeat(64),
    name: 'Missing',
    placement: { anchor: { kind: 'viewport' }, x: 0, y: 0, widthPx: 20, heightPx: 20, rotationDeg: 0 },
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
  });
  value.designs.push(doc);
  await expect(decodeBackup(await uncheckedArchive(value))).rejects.toThrow('素材');
  expect(() =>
    parseBackupManifest({ ...manifest(), takes: [{ format: 'ww-signal-take', formatVersion: 99 }] }),
  ).toThrow();
});
test('restore is additive, idempotent, and never overwrites a different saved artwork', () => {
  const value = manifest(),
    doc = emptyDesign('youtube', 'retro');
  value.designs.push(doc);
  const backup: ValidatedBackup = { manifest: value, assets: [] };
  const first = planRestore(backup, {}, [], [], true);
  expect(planRestore(backup, first.values, [], [], true).values).toEqual(first.values);
  expect(planRestore(backup, {}, [], [], false).values).toEqual({ 'webWorldThemes.design.youtube': doc });
  const changed = { ...doc, baseThemeId: null };
  expect(() => planRestore(backup, { 'webWorldThemes.design.youtube': changed }, [], [], true)).toThrow('衝突');
  expect(() => planRestore(backup, { ignored: 'x'.repeat(BACKUP_LIMITS.localBytes) }, [], [], true)).toThrow('10MiB');
});
test('restore rejects combined material quotas and retains spare originals without transferring live leases', () => {
  const row = {
    id: 'asset-' + 'a'.repeat(64),
    mime: 'image/png',
    name: 'spare.png',
    width: 1,
    height: 1,
    byteLength: 1,
    blob: new Blob(['a']),
    leases: [],
  } satisfies StoredAsset;
  const backup: ValidatedBackup = { manifest: manifest(), assets: [row] };
  expect(planRestore(backup, {}, [], [], false).added[0]!.leases).toEqual([
    { session: 'backup-library', tabId: -1, documentId: 'backup-library' },
  ]);
  expect(planRestore(backup, {}, [row], [], false).added).toEqual([]);
  const existing = Array.from({ length: 128 }, (_, index) => ({
    ...row,
    id: 'asset-' + index.toString(16).padStart(64, '0'),
  }));
  expect(() => planRestore(backup, {}, existing, [], false)).toThrow('上限');
});
test('backup worker authenticates its live top-level page and refuses other extension pages or subframes', async () => {
  for (const client of [
    undefined,
    { id: 'client', url: 'chrome-extension://example/popup/index.html', frameType: 'top-level' },
    { id: 'client', url: 'chrome-extension://example/backup/index.html', frameType: 'nested' },
    { id: 'client', url: 'chrome-extension://other/backup/index.html', frameType: 'top-level' },
  ]) {
    let enqueued = false,
      pending: Promise<unknown> | undefined,
      reply: unknown;
    const service = createBackupService({
      pageURL: 'chrome-extension://example/backup/index.html',
      client: async () => client,
      enqueue: async (operation) => {
        enqueued = true;
        return operation();
      },
    });
    service.receive({
      data: { type: BACKUP_MESSAGE, action: 'export' },
      source: { id: 'client' },
      ports: [
        {
          postMessage: (value: unknown) => {
            reply = value;
          },
          close() {},
        } as MessagePort,
      ],
      waitUntil: (operation) => {
        pending = operation;
      },
    });
    await pending;
    expect(enqueued).toBe(false);
    expect(reply).toMatchObject({ ok: false, error: expect.stringContaining('専用ページ') });
  }
});
