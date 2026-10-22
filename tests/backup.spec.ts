import { test, expect, launchExtension } from './fixtures';
import type { Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { initialWorldState } from '../src/world/evaluate';
import { WORLD_RUNTIME_VERSION } from '../src/world/types';
import { worldScenario } from './helpers/world-scenario';
import { modelFixture } from './helpers/model-fixture';
import { BACKUP_HEADER_BYTES } from '../src/backup/archive';

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

test('one file restores saved artwork, originals, takes and settings into a different profile and extension ID', async ({
  context,
  popup,
  youtube,
}, info) => {
  test.setTimeout(90_000);
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const editor = youtube.locator('#web-world-themes-creator');
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
    animations: 'disabled',
    mask: [youtube.locator('#web-world-themes-clock, #web-world-themes-daily-detail')],
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
      animations: 'disabled',
      mask: [canvas.locator('#web-world-themes-clock, #web-world-themes-daily-detail')],
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
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const editor = youtube.locator('#web-world-themes-creator');
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
  await popup.evaluate(async () => {
    const key = 'webWorldThemes.design.youtube',
      value = (await chrome.storage.local.get(key))[key] as Record<string, unknown>;
    await chrome.storage.local.set({ [key]: { ...value, baseThemeId: null } });
  });
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('衝突');
  expect((await readCounts(page)).local['webWorldThemes.design.youtube']).toMatchObject({ baseThemeId: null });
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
