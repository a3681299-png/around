import { test, expect, launchExtension } from './fixtures';
import type { Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { initialWorldState } from '../src/world/evaluate';
import { WORLD_RUNTIME_VERSION } from '../src/world/types';
import { worldScenario } from './helpers/world-scenario';
import { modelFixture } from './helpers/model-fixture';
import { BACKUP_HEADER_BYTES, encodeBackup, sha256 } from '../src/backup/archive';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/storage/settings';
import { sidePanelDriver } from './helpers/side-panel';
import { openEditor } from './helpers/editor';
import { parseDesign } from '../src/design/schema';
import { inspectAsset } from '../src/assets/inspect';
import { BACKUP_LIBRARY_LEASE, type StoredAsset } from '../src/assets/repository';
import { ASSET_MESSAGE } from '../src/assets/protocol';

async function openBackup(popup: Page) {
  const page = await popup.context().newPage();
  await page.goto(await popup.evaluate(() => chrome.runtime.getURL('backup/index.html')));
  await expect(page.locator('#backup-export')).toBeEnabled();
  return page;
}
async function downloadBackup(page: Page, file: string) {
  const download = page.waitForEvent('download');
  await page.locator('#backup-export').click();
  await expect(page.locator('#backup-download')).toBeVisible();
  await (await download).saveAs(file);
  await expect(page.locator('.backup-status')).not.toHaveAttribute('data-error', 'true');
}
async function readCounts(page: Page) {
  return page.evaluate(async () => {
    const count = (name: string, store: string) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => {
          const db = request.result,
            requestCount = db.transaction(store).objectStore(store).count();
          requestCount.onsuccess = () => {
            resolve(requestCount.result);
            db.close();
          };
          requestCount.onerror = () => {
            reject(requestCount.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      });
    return {
      local: await chrome.storage.local.get(null),
      assets: await count('web-world-themes-assets', 'assets'),
      takes: await count('web-world-themes-signal-takes', 'takes'),
    };
  });
}

test('a historical v13 VRM backup restores and re-exports, while forged body facts are refused', async ({
  popup,
}, info) => {
  const file = path.resolve('tests/fixtures/backups/legacy-v13-vrm.wwbackup'),
    bytes = await readFile(file),
    length = bytes.readUInt32LE(BACKUP_HEADER_BYTES - 36),
    original = JSON.parse(bytes.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + length).toString('utf8')),
    payload = bytes.subarray(BACKUP_HEADER_BYTES + length);
  expect(original.designs[0].schemaVersion).toBe(13);
  expect(original.designs[0].decorations[0].source.vrm.body).toBeUndefined();
  const expected = parseDesign(original.designs[0]),
    body = inspectAsset(payload).model!.vrm!.body!;
  expect(body).toBeDefined();
  const page = await openBackup(popup);
  await page.locator('#backup-file').setInputFiles(file);
  await page.locator('#backup-inspect').click();
  await expect(page.locator('#backup-restore')).toBeEnabled();
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('読み込みが完了');
  const restored = await readCounts(page);
  expect(restored.assets).toBe(1);
  expect(restored.local['webWorldThemes.design.youtube']).toEqual(expected);
  const exported = info.outputPath('legacy-vrm-reexport.wwbackup');
  await downloadBackup(page, exported);
  const output = await readFile(exported),
    outLength = output.readUInt32LE(BACKUP_HEADER_BYTES - 36),
    manifest = JSON.parse(output.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + outLength).toString('utf8'));
  expect(manifest.designs).toEqual([expected]);
  expect(output.subarray(BACKUP_HEADER_BYTES + outLength)).toEqual(payload);
  await page.locator('#backup-file').setInputFiles(exported);
  await page.locator('#backup-inspect').click();
  await expect(page.locator('#backup-restore')).toBeEnabled();
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('読み込みが完了');
  expect(await readCounts(page)).toEqual(restored);

  // Re-hash an otherwise intact archive so rejection proves fact checking, not checksum checking.
  manifest.designs[0].decorations[0].source.vrm.body = { ...body, height: body.height + 0.01 };
  const text = Buffer.from(JSON.stringify(manifest)),
    header = Buffer.from(output.subarray(0, BACKUP_HEADER_BYTES));
  header.writeUInt32LE(text.length, BACKUP_HEADER_BYTES - 36);
  Buffer.from(await sha256(new Uint8Array(text)), 'hex').copy(header, BACKUP_HEADER_BYTES - 32);
  await page.locator('#backup-file').setInputFiles({
    name: 'forged-body.wwbackup',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([header, text, payload]),
  });
  await page.locator('#backup-inspect').click();
  await expect(page.locator('.backup-status')).toContainText('レイヤーと素材の形式が一致しません');
  await expect(page.locator('#backup-restore')).toBeDisabled();
  expect(await readCounts(page)).toEqual(restored);
});

test('backup refreshes an existing legacy VRM record and cached metadata before saving a measured source', async ({
  popup,
}, info) => {
  const bytes = await readFile('tests/fixtures/backups/legacy-v13-vrm.wwbackup'),
    length = bytes.readUInt32LE(BACKUP_HEADER_BYTES - 36),
    original = JSON.parse(bytes.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + length).toString('utf8')),
    payload = bytes.subarray(BACKUP_HEADER_BYTES + length),
    measured = inspectAsset(payload),
    legacy = structuredClone(measured),
    expected = parseDesign(original.designs[0]),
    layer = expected.decorations[0];
  if (layer?.kind !== 'model3d' || !layer.source.vrm) throw new Error('Expected a historical VRM');
  delete legacy.model!.vrm!.body;
  layer.source.vrm.body = measured.model!.vrm!.body!;
  const asset = original.assets[0];
  await popup.evaluate(
    async ({ asset, legacy, payload, lease }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('web-world-themes-assets', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('assets', 'readwrite');
          tx.objectStore('assets').put({
            ...legacy,
            ...asset,
            blob: new Blob([new Uint8Array(payload)]),
            leases: [lease],
          });
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
    },
    { asset, legacy, payload: [...payload], lease: BACKUP_LIBRARY_LEASE },
  );
  const metadata = () =>
    popup.evaluate(
      async ({ type, id }) => (await chrome.runtime.sendMessage({ type, action: 'get-metadata', id })).value,
      { type: ASSET_MESSAGE, id: asset.id },
    );
  expect((await metadata()).model.vrm.body).toBeUndefined(); // Prime the worker's legacy row cache.
  const text = Buffer.from(JSON.stringify({ ...original, designs: [expected] })),
    header = Buffer.from(bytes.subarray(0, BACKUP_HEADER_BYTES));
  header.writeUInt32LE(text.length, BACKUP_HEADER_BYTES - 36);
  Buffer.from(await sha256(new Uint8Array(text)), 'hex').copy(header, BACKUP_HEADER_BYTES - 32);
  const page = await openBackup(popup);
  await page.locator('#backup-file').setInputFiles({
    name: 'measured-source.wwbackup',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([header, text, payload]),
  });
  await page.locator('#backup-inspect').click();
  await expect(page.locator('#backup-restore')).toBeEnabled();
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('読み込みが完了');
  expect((await metadata()).model.vrm.body).toEqual(measured.model!.vrm!.body);
  const restored = await readCounts(page);
  expect(restored.assets).toBe(1);
  expect(restored.local['webWorldThemes.design.youtube']).toEqual(expected);
  const saved = await popup.evaluate(
    async ({ type, design }) =>
      chrome.runtime.sendMessage({
        type,
        action: 'save',
        session: 'backup-refreshed-check',
        design,
      }),
    { type: ASSET_MESSAGE, design: expected },
  );
  expect(saved).toMatchObject({ ok: true });
  const leases = await popup.evaluate(
    (id) =>
      new Promise<StoredAsset['leases']>((resolve, reject) => {
        const request = indexedDB.open('web-world-themes-assets', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            get = db.transaction('assets').objectStore('assets').get(id);
          get.onsuccess = () => {
            resolve(get.result.leases);
            db.close();
          };
          get.onerror = () => {
            reject(get.error);
            db.close();
          };
        };
      }),
    asset.id,
  );
  expect(leases).toContainEqual(BACKUP_LIBRARY_LEASE);
  await downloadBackup(page, info.outputPath('refreshed-vrm.wwbackup'));
});

test('one file restores saved artwork, originals, takes and settings into a different profile and extension ID', async ({
  context,
  popup,
  youtube,
}, info) => {
  test.setTimeout(90_000);
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  const { panel: editor } = await openEditor(popup, youtube);
  await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(editor.locator('.layer')).toHaveCount(1);
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  const take = {
    format: 'ww-signal-take',
    formatVersion: 1,
    runtimeVersion: WORLD_RUNTIME_VERSION,
    id: 'migration-take',
    name: 'Migration take',
    siteId: 'youtube',
    initialState: initialWorldState(),
    inputs: worldScenario(1).inputs.slice(0, 3),
  };
  expect(
    await popup.evaluate(
      async (take) =>
        (
          await chrome.runtime.sendMessage({
            type: 'web-world-themes:signal-takes',
            action: 'put',
            siteId: 'youtube',
            take,
          })
        ).ok,
      take,
    ),
  ).toBe(true);
  const backup = await openBackup(popup),
    archive = info.outputPath('source.wwbackup');
  await downloadBackup(backup, archive);
  const saved = await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
  const before = await youtube.screenshot({
    path: info.outputPath('source-artwork.png'),
    animations: 'disabled',
  });
  const root = path.resolve('.work');
  await mkdir(root, { recursive: true });
  const copied = await mkdtemp(path.join(root, 'g-build-copy-'));
  await cp(path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist'), copied, { recursive: true });
  const profile = await mkdtemp(path.join(root, 'g-migration-profile-'));
  const second = await launchExtension(profile, true, { extensionPath: copied });
  try {
    const worker = second.serviceWorkers()[0] ?? (await second.waitForEvent('serviceworker'));
    const otherId = new URL(worker.url()).host;
    expect(otherId).not.toBe(await popup.evaluate(() => chrome.runtime.id));
    const restored = await second.newPage();
    await restored.goto('chrome-extension://' + otherId + '/backup/index.html');
    await restored.locator('#backup-file').setInputFiles(archive);
    await restored.locator('#backup-inspect').click();
    await expect(restored.locator('#backup-restore')).toBeEnabled();
    await expect(restored.locator('.backup-summary')).toContainText('テイク 1個');
    await restored.locator('#backup-restore').click();
    await expect(restored.locator('.backup-status')).toContainText('読み込みが完了');
    const counts = await readCounts(restored);
    expect(counts.assets).toBe(1);
    expect(counts.takes).toBe(1);
    expect(counts.local['webWorldThemes.design.youtube']).toEqual(saved);
    expect(
      await restored.evaluate(
        async () =>
          (
            await chrome.runtime.sendMessage({
              type: 'web-world-themes:signal-takes',
              action: 'get',
              siteId: 'youtube',
              id: 'migration-take',
            })
          ).value,
      ),
    ).toEqual(take);
    const canvas = await second.newPage();
    await canvas.goto('https://www.youtube.com/watch?v=fixture');
    await expect(canvas.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(1);
    await expect(canvas.locator('#web-world-themes-decorations img')).toBeVisible();
    await expect
      .poll(async () =>
        canvas
          .locator('#web-world-themes-decorations img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    const after = await canvas.screenshot({
      path: info.outputPath('restored-artwork.png'),
      animations: 'disabled',
    });
    await info.attach('source-artwork.png', { body: before, contentType: 'image/png' });
    await info.attach('restored-artwork.png', { body: after, contentType: 'image/png' });
    expect(after.equals(before), 'restored artwork pixels match the source screenshot').toBe(true);
    // Same file can safely be imported again: no duplicate materials or takes.
    await restored.locator('#backup-inspect').click();
    await expect(restored.locator('#backup-restore')).toBeEnabled();
    await restored.locator('#backup-restore').click();
    await expect(restored.locator('.backup-status')).toContainText('読み込みが完了');
    expect(await readCounts(restored)).toEqual(counts);
  } finally {
    await second.close();
  }
  await context.pages()[0]?.bringToFront();
});

test('backup validates actual raster and model textures, and refuses corrupt files before persistent writes', async ({
  popup,
  youtube,
}, info) => {
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  const { panel: editor } = await openEditor(popup, youtube);
  await editor.locator('input.model-file').setInputFiles({
    name: 'migration-model.glb',
    mimeType: 'model/gltf-binary',
    buffer: modelFixture(),
  });
  await expect(editor.locator('.layer')).toHaveCount(1);
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  const page = await openBackup(popup),
    archive = info.outputPath('models.wwbackup');
  await downloadBackup(page, archive);
  const before = await readCounts(page),
    bytes = await readFile(archive);
  for (const offset of [BACKUP_HEADER_BYTES + 5, bytes.length - 1]) {
    const damaged = Buffer.from(bytes);
    damaged[offset] = damaged[offset]! ^ 1;
    await page
      .locator('#backup-file')
      .setInputFiles({ name: 'damaged.wwbackup', mimeType: 'application/octet-stream', buffer: damaged });
    await page.locator('#backup-inspect').click();
    await expect(page.locator('.backup-status')).toHaveAttribute('data-error', 'true');
    await expect(page.locator('.backup-status')).toContainText('SHA-256');
    await expect(page.locator('#backup-restore')).toBeDisabled();
    expect(await readCounts(page)).toEqual(before);
  }
  await page.locator('#backup-file').setInputFiles(archive);
  await page.locator('#backup-inspect').click();
  await expect(page.locator('#backup-restore')).toBeEnabled();
  // The saved artwork changes after the check (new artwork names no base; the legacy base differs).
  await popup.evaluate(async () => {
    const key = 'webWorldThemes.design.youtube',
      value = (await chrome.storage.local.get(key))[key] as Record<string, unknown>;
    if (value['baseThemeId'] !== null) throw new Error('New artwork must name no base theme.');
    await chrome.storage.local.set({ [key]: { ...value, baseThemeId: 'retro' } });
  });
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('衝突');
  expect((await readCounts(page)).local['webWorldThemes.design.youtube']).toMatchObject({ baseThemeId: 'retro' });
});

test('backup transport refuses a different extension page', async ({ popup }) => {
  const response = await popup.evaluate(async () => {
    const worker = (await navigator.serviceWorker.getRegistration())!.active!,
      channel = new MessageChannel();
    const result = new Promise<{ ok: boolean; error: string }>((resolve) => {
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        resolve(event.data);
      };
    });
    worker.postMessage({ type: 'web-world-themes:backup-v1', action: 'export' }, [channel.port2]);
    return result;
  });
  expect(response).toMatchObject({ ok: false, error: expect.stringContaining('専用ページ') });
});

test('restored spare originals survive unrelated cleanup from the native panel without a tab', async ({}, info) => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(path.join(path.resolve('.work'), 'g-backup-profile-'));
  const context = await launchExtension(profile, true, { headed: true });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup/index.html');
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await popup.getByRole('switch', { name: '作品を表示する' }).check();
    await page.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Web World Themes の設定' })
      .getByRole('button', { name: 'エディターを開く', exact: true })
      .click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    const bytes = new Uint8Array(
      modelFixture((json) => {
        json.images = [];
        json.textures = [];
        json.materials[0].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1] };
      }),
    );
    const assetId = 'asset-' + (await sha256(bytes));
    const file = await encodeBackup(
      {
        format: 'web-world-themes-backup',
        version: 1,
        createdAt: '2026-10-22T00:00:00Z',
        settings: mergeSettings(DEFAULT_SETTINGS, {}),
        preferences: {},
        designs: [],
        takes: [],
        assets: [{ id: assetId, name: 'spare.glb', mime: 'model/gltf-binary', byteLength: bytes.length }],
      },
      [new Blob([bytes])],
    );
    const backup = await openBackup(popup);
    await backup.locator('#backup-settings').uncheck();
    await backup.locator('#backup-file').setInputFiles({
      name: 'spare.wwbackup',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    await backup.locator('#backup-inspect').click();
    await expect(backup.locator('#backup-restore')).toBeEnabled();
    await backup.locator('#backup-restore').click();
    await expect(backup.locator('.backup-status')).toContainText('読み込みが完了');
    const released = await panel.evaluate<{ ok: boolean }>(
      'chrome.runtime.sendMessage({type:"web-world-themes:assets",action:"release",session:"g-unrelated-panel"})',
    );
    expect(released.ok).toBe(true);
    const stored = await backup.evaluate(
      async (id) =>
        new Promise<boolean>((resolve, reject) => {
          const open = indexedDB.open('web-world-themes-assets', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result,
              get = db.transaction('assets').objectStore('assets').get(id);
            get.onsuccess = () => {
              resolve(Boolean(get.result));
              db.close();
            };
            get.onerror = () => {
              reject(get.error);
              db.close();
            };
          };
        }),
      assetId,
    );
    expect(stored).toBe(true);
    await panel.detach();
    await info.attach('spare-original-retained', { body: assetId, contentType: 'text/plain' });
  } finally {
    await context.close();
  }
});
