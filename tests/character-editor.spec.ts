import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { openEditor } from './helpers/editor';
import { BACKUP_HEADER_BYTES } from '../src/backup/archive';
import { BACKUP_LIBRARY_LEASE, type StoredAsset } from '../src/assets/repository';
import { inspectAsset } from '../src/assets/inspect';
import { parseDesign } from '../src/design/schema';
import type { DesignDocument } from '../src/design/types';

test('reimporting the same historical VRM measures its existing record and layer, survives save and clears the advice', async ({
  popup,
  youtube,
}) => {
  const archive = await readFile('tests/fixtures/backups/legacy-v13-vrm.wwbackup'),
    length = archive.readUInt32LE(BACKUP_HEADER_BYTES - 36),
    manifest = JSON.parse(archive.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + length).toString('utf8')),
    original = archive.subarray(BACKUP_HEADER_BYTES + length),
    info = inspectAsset(original),
    expected = parseDesign(manifest.designs[0]);
  // Use the source actually saved by the pre-measurement extension, not a guessed old document.
  const layer = expected.decorations[0];
  if (layer?.kind !== 'model3d' || !layer.source.vrm) throw new Error('Expected the historical VRM fixture');
  expect(layer.source.vrm.body).toBeUndefined();
  const metadata = { ...info, ...manifest.assets[0], model: layer.source };
  await popup.evaluate(
    async ({ metadata, original, design, lease }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('web-world-themes-assets', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('assets', 'readwrite');
          tx.objectStore('assets').put({ ...metadata, blob: new Blob([new Uint8Array(original)]), leases: [lease] });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
      await chrome.storage.local.set({ 'webWorldThemes.design.youtube': design });
    },
    { metadata, original: [...original], design: manifest.designs[0], lease: BACKUP_LIBRARY_LEASE },
  );
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  await youtube.reload();
  const { panel, studio } = await openEditor(popup, youtube);
  await panel.locator('.layer').first().click();
  await expect(panel.locator('.character-body')).toContainText('体型を測れていません');
  const stored = () =>
    popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
  const rows = () =>
    popup.evaluate(
      () =>
        new Promise<Omit<StoredAsset, 'blob'>[]>((resolve, reject) => {
          const request = indexedDB.open('web-world-themes-assets', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              read = db.transaction('assets').objectStore('assets').getAll();
            read.onsuccess = () => {
              resolve(read.result.map(({ blob: _blob, ...row }: StoredAsset) => row));
              db.close();
            };
            read.onerror = () => {
              reject(read.error);
              db.close();
            };
          };
        }),
    );
  const input = { name: 'Original.vrm', mimeType: 'model/gltf-binary', buffer: original };
  await panel.locator('.model-file').setInputFiles(input);
  await expect(panel.locator('.layer')).toHaveCount(1);
  await expect(panel.locator('.character-body')).not.toContainText('体型を測れていません');
  await panel.locator('.undo').click();
  await expect(panel.locator('.character-body')).toContainText('体型を測れていません');
  await panel.locator('.redo').click();
  await expect(panel.locator('.character-body')).not.toContainText('体型を測れていません');
  await panel.locator('.save').click();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  layer.source.vrm.body = info.model!.vrm!.body!;
  expect(await stored()).toEqual(expected);
  const savedRows = await rows();
  expect(savedRows).toHaveLength(1);
  expect(savedRows[0]!.model!.vrm!.body).toEqual(info.model!.vrm!.body);
  expect(savedRows[0]!.leases).toContainEqual(BACKUP_LIBRARY_LEASE);
  await youtube.reload();
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  await panel.locator('.layer').first().click();
  await expect(panel.locator('.character-body')).not.toContainText('体型を測れていません');
  await panel.locator('.model-file').setInputFiles(input);
  await expect(panel.locator('.layer')).toHaveCount(1);
  // An identical second import has nothing to save; wait for its completed status.
  await expect(panel.locator('.status')).toHaveText('保存済みの見た目です。');
  await expect(panel.locator('.save')).toBeDisabled();
  await expect(panel.locator('.dirty')).toHaveText('保存済み');
  expect(await stored()).toEqual(expected);
  expect(await rows()).toHaveLength(1);
});
