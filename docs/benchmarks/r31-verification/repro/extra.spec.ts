import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { vrmFixture } from '../../tests/helpers/vrm-fixture';
import { vrmaFixture } from '../../tests/helpers/vrma-fixture';
import { BACKUP_HEADER_BYTES } from '../../src/backup/archive';
import { mkdtemp, mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const evidence = path.resolve('.work/evidence'),
  normal = path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? '.work/r31-normal');
const modelFile = { name: 'Original.vrm', mimeType: 'model/gltf-binary', buffer: vrmFixture() };
async function setup(extensionPath = normal, profile?: string, live = false, reload = false) {
  const context = await launchExtension(profile ?? (await mkdtemp(path.join(tmpdir(), 'ww-r31-extra-'))), !live, {
    extensionPath,
  });
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
  await item.waitFor();
  const id = await item.evaluate((e: any) => e.data?.id ?? e.id);
  await manager.close();
  let popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  if (reload) {
    await popup.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
    await expect.poll(() => popup.isClosed()).toBe(true);
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
  }
  const youtube = await context.newPage();
  await youtube.goto(live ? 'https://www.youtube.com/watch?v=LC1a-DwUhls' : 'https://www.youtube.com/watch?v=fixture', {
    waitUntil: 'domcontentloaded',
  });
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  return { context, popup, youtube, id };
}
const storage = (page: Page) =>
  page.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
async function report(name: string, value: unknown) {
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, name + '.json'), JSON.stringify(value, null, 2));
}
async function backupPage(popup: Page) {
  const p = await popup.context().newPage();
  await p.goto(await popup.evaluate(() => chrome.runtime.getURL('backup/index.html')));
  return p;
}
async function downloadBackup(page: Page, file: string) {
  const d = page.waitForEvent('download');
  await page.locator('#backup-export').click();
  await (await d).saveAs(file);
}
async function metadata(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const r = indexedDB.open('web-world-themes-assets', 1);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction('assets').objectStore('assets').getAll();
          q.onsuccess = () => {
            resolve(q.result.map(({ blob, leases, ...row }) => row));
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

test('actual Studio popup window imports 36 motions, preserves history, saves and backs up all motion originals', async () => {
  const { context, popup, youtube } = await setup();
  const result: any = {};
  try {
    await youtube.bringToFront();
    const targetTab = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0],
    );
    const target = targetTab.id!;
    const opened = context.waitForEvent('page');
    result.openReply = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'web-world-themes:open-studio-window', tabId }),
      target,
    );
    const studio = await opened;
    await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    result.window = await studio.evaluate(async () => ({
      editor: await chrome.windows.getCurrent(),
      tab: await chrome.tabs.getCurrent(),
    }));
    const sourceWindow = targetTab.windowId;
    expect(result.window.editor.type).toBe('popup');
    expect(result.window.editor.id).not.toBe(sourceWindow);
    const panel = studio.getByRole('dialog', { name: 'デザインエディター' });
    await panel.locator('.model-file').setInputFiles(modelFile);
    await expect(panel.locator('.layer')).toHaveCount(1);
    const files = Array.from({ length: 36 }, (_, n) => ({
      name: `motion-${n}.vrma`,
      mimeType: 'model/gltf-binary',
      buffer: vrmaFixture({}, (j) => (j.animations[0].name = `motion-${n}`)),
    }));
    await panel.locator('.character-file').setInputFiles(files);
    await expect(panel.locator('.character-motions li')).toHaveCount(36, { timeout: 60000 });
    await panel.locator('.undo').click();
    await expect(panel.locator('.character-motions li')).toHaveCount(32);
    await panel.locator('.redo').click();
    await expect(panel.locator('.character-motions li')).toHaveCount(36);
    await panel.locator('.character-motions button').first().click();
    await expect(panel.locator('.character-motions li')).toHaveCount(35);
    await panel.locator('.undo').click();
    await expect(panel.locator('.character-motions li')).toHaveCount(36);
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    result.saved = await storage(popup);
    expect(result.saved.schemaVersion).toBe(14);
    expect(result.saved.decorations[0].character.motions).toHaveLength(36);
    await panel.locator('.character-motions button').first().click();
    await panel.locator('.discard').click();
    await expect(panel.locator('.character-motions li')).toHaveCount(36);
    await studio.reload();
    await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    await expect(panel.locator('.character-motions li')).toHaveCount(36);
    const backup = await context.newPage();
    await backup.goto(await popup.evaluate(() => chrome.runtime.getURL('backup/index.html')));
    const downloaded = backup.waitForEvent('download');
    await backup.locator('#backup-export').click();
    const file = path.join(evidence, 'public-character.wwbackup');
    await (await downloaded).saveAs(file);
    const bytes = await readFile(file),
      length = bytes.readUInt32LE(16),
      manifest = JSON.parse(bytes.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + length).toString('utf8'));
    result.backup = { assets: manifest.assets.length, designs: manifest.designs };
    expect(manifest.assets).toHaveLength(37);
    expect(manifest.designs).toEqual([result.saved]);
    result.metadata = await metadata(popup);
    expect(result.metadata).toHaveLength(37);
    await studio.setViewportSize({ width: 1440, height: 900 });
    await panel.locator('.character-options').scrollIntoViewIfNeeded();
    await studio.screenshot({ path: path.join(evidence, 'studio-window-public.png') });
    await context.close();
    const fresh = await setup();
    try {
      const restored = await backupPage(fresh.popup);
      await restored.locator('#backup-file').setInputFiles(file);
      await restored.locator('#backup-inspect').click();
      await expect(restored.locator('#backup-restore')).toBeEnabled();
      await restored.locator('#backup-restore').click();
      await expect(restored.locator('.backup-status')).toContainText('読み込みが完了');
      result.restored = await storage(fresh.popup);
      expect(result.restored).toEqual(result.saved);
      expect(await metadata(fresh.popup)).toHaveLength(37);
    } finally {
      await fresh.context.close();
    }
  } finally {
    await report('studio-window', result);
    await context.close();
  }
});

test('v13 VRM records from before build still render and can reimport the same original then save', async () => {
  const build = path.resolve('.work/r31-upgrade'),
    profile = await mkdtemp(path.join(tmpdir(), 'ww-r31-upgrade-'));
  const result: any = {};
  await cp(path.resolve('../r31-before/.work/r31-normal'), build, { recursive: true });
  let browser = await setup(build, profile);
  try {
    const { panel } = await openEditor(browser.popup, browser.youtube);
    await panel.locator('.model-file').setInputFiles(modelFile);
    await expect(browser.youtube.locator('.model-media')).toHaveAttribute('data-renderer', 'three');
    await panel.locator('.save').click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    result.before = await storage(browser.popup);
    result.beforeMetadata = await metadata(browser.popup);
    expect(result.before.schemaVersion).toBe(13);
    expect(result.before.decorations[0].source.vrm.body).toBeUndefined();
    const oldBackup = await backupPage(browser.popup);
    await downloadBackup(oldBackup, path.join(evidence, 'legacy-v13-vrm.wwbackup'));
    await oldBackup.close();
    await browser.context.close();
    // Preserve the old parser's actual metadata, not a v14 record with body deleted. A fresh
    // extension avoids Chromium's unchanged-version unpacked-script cache on profile restarts.
    browser = await setup(normal);
    await browser.popup.evaluate(
      async ({ design, rows, bytes }) => {
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.open('web-world-themes-assets', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('assets', { keyPath: 'id' });
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction('assets', 'readwrite');
            for (const row of rows)
              tx.objectStore('assets').put({
                ...row,
                blob: new Blob([new Uint8Array(bytes)], { type: row.mime }),
                leases: [],
              });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          r.onerror = () => reject(r.error);
        });
        await chrome.storage.local.set({ 'webWorldThemes.design.youtube': design });
      },
      { design: result.before, rows: result.beforeMetadata, bytes: [...modelFile.buffer] },
    );
    await browser.youtube.reload();
    await expect(browser.youtube.locator('.model-media')).toHaveAttribute('data-renderer', 'three');
    const next = await openEditor(browser.popup, browser.youtube);
    await next.panel.locator('.layer').first().click();
    result.afterOpen = await storage(browser.popup);
    result.bodyMessage = await next.panel.locator('.character-body').textContent();
    expect(result.bodyMessage).toContain('体型を測れていません');
    await next.panel.locator('.model-file').setInputFiles(modelFile);
    await expect(next.panel.locator('.layer')).toHaveCount(2);
    result.afterReimportMessage = await next.panel.locator('.character-body').textContent();
    await next.panel.locator('.save').click();
    await expect(next.panel.locator('.dirty')).toHaveText('保存済み');
    result.afterSave = await storage(browser.popup);
    result.afterMetadata = await metadata(browser.popup);
    expect(result.afterSave.decorations[1].source.vrm.body).toBeTruthy();
  } finally {
    result.finalStorage = await storage(browser.popup).catch(() => undefined);
    result.finalMetadata = await metadata(browser.popup).catch(() => undefined);
    result.status = await browser.context
      .pages()
      .find((p) => p.url().includes('/studio/'))
      ?.locator('.status')
      .textContent()
      .catch(() => undefined);
    await report('legacy-upgrade', result);
    await browser.context.close();
  }
});

for (const label of ['before', 'after'])
  test(`v13 VRM backup remains restorable and exportable: ${label}`, async () => {
    const extensionPath = path.resolve(label === 'before' ? '../r31-before/.work/r31-normal' : '.work/r31-normal');
    const { context, popup } = await setup(extensionPath);
    const result: any = { label };
    try {
      const p = await backupPage(popup);
      await p.locator('#backup-file').setInputFiles(path.join(evidence, 'legacy-v13-vrm.wwbackup'));
      await p.locator('#backup-inspect').click();
      try {
        await expect(p.locator('#backup-restore')).toBeEnabled();
        await p.locator('#backup-restore').click();
        await expect(p.locator('.backup-status')).toContainText('読み込みが完了');
        result.restored = await storage(popup);
        await downloadBackup(p, path.join(evidence, 'reexport-' + label + '.wwbackup'));
        result.exported = true;
      } finally {
        result.status = await p.locator('.backup-status').textContent();
        result.restoreEnabled = await p.locator('#backup-restore').isEnabled();
      }
    } finally {
      await report('legacy-backup-' + label, result);
      await context.close();
    }
  });

for (const variant of ['mesh', 'bad-scene-index', 'bad-scene-root', 'derived-hips-infinity'])
  test(`import rejects malformed motion: ${variant}`, async () => {
    const { context, popup, youtube } = await setup();
    const result: any = { variant };
    try {
      const { panel } = await openEditor(popup, youtube);
      await panel.locator('.model-file').setInputFiles(modelFile);
      await expect(panel.locator('.layer')).toHaveCount(1);
      const bytes = vrmaFixture({}, (j) => {
        if (variant === 'mesh') j.meshes = [];
        if (variant === 'bad-scene-index') j.scene = 999;
        if (variant === 'bad-scene-root') j.scenes[0].nodes = [999];
        if (variant === 'derived-hips-infinity') {
          j.nodes[0].children = [7];
          for (let n = 0; n < 51; n++) j.nodes.push({ scale: [1, 1e6, 1], children: [n === 50 ? 1 : 8 + n] });
          j.nodes[1].translation = [0, 1e6, 0];
        }
      });
      const previous = await panel.locator('.status').textContent();
      await panel
        .locator('.character-file')
        .setInputFiles({ name: variant + '.vrma', mimeType: 'model/gltf-binary', buffer: bytes });
      await expect
        .poll(async () => {
          const text = await panel.locator('.status').textContent();
          return text !== previous && Boolean(text) && !text!.includes('読み込んでいます');
        })
        .toBe(true);
      result.count = await panel.locator('.character-motions li').count();
      result.status = await panel.locator('.status').textContent();
      result.characterStatus = await panel.locator('.character-status').textContent();
      await panel.locator('.save').click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      result.saved = await storage(popup);
      result.metadata = await metadata(popup);
      expect(result.count, 'malformed motion must not be attached').toBe(0);
    } finally {
      await report('import-' + variant + '-' + path.basename(normal), result);
      await context.close();
    }
  });
