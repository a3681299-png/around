import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';

/*
 * Data made before the retro theme was removed (tests/fixtures/backups/, captured at
 * retro-theme-final) keeps working: the backup restores, the stored settings load, and someone who
 * had turned the theme off with the strength slider still sees nothing drawn.
 */
const backupFile = path.resolve('tests/fixtures/backups/pre-removal.wwbackup');
const storage = async (name: string) =>
  JSON.parse(await readFile(path.resolve('tests/fixtures/backups', name), 'utf8')) as Record<string, unknown>;
const layer = '#web-world-themes-decorations [data-image-id]';

async function restore(popup: Page, settings: boolean) {
  const page = await popup.context().newPage();
  await page.goto(await popup.evaluate(() => chrome.runtime.getURL('backup/index.html')));
  await page.locator('#backup-file').setInputFiles(backupFile);
  await page.locator('#backup-settings').setChecked(settings);
  await page.locator('#backup-inspect').click();
  await expect(page.locator('#backup-restore')).toBeEnabled();
  await page.locator('#backup-restore').click();
  await expect(page.locator('.backup-status')).toContainText('読み込みが完了');
  await page.close();
}
async function drawn(youtube: Page) {
  await expect(youtube.locator(layer)).toHaveCount(1);
  await expect
    .poll(() =>
      youtube
        .locator(`${layer} img`)
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
        .catch(() => false),
    )
    .toBe(true);
}

test('a backup made with the retro theme restores its artwork, its original and its switches', async ({
  popup,
  youtube,
}) => {
  await restore(popup, true);
  await popup.reload();
  await expect(popup.getByRole('switch', { name: '制作モード' })).toBeChecked();
  await youtube.reload();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await drawn(youtube);
});

test('storage written with the retro theme loads: the artwork is drawn and 制作モード stays on', async ({
  popup,
  youtube,
}) => {
  // The original comes from the backup; every stored key then becomes the pre-removal storage.
  await restore(popup, false);
  await popup.evaluate(
    async (values) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(values);
    },
    await storage('pre-removal-storage.json'),
  );
  await popup.reload();
  await expect(popup.getByRole('switch', { name: '制作モード' })).toBeChecked();
  await youtube.reload();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await drawn(youtube);
});

test('storage with the strength at 0% still draws nothing and offers no editing on the page', async ({
  popup,
  youtube,
}) => {
  await restore(popup, false);
  await popup.evaluate(
    async (values) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(values);
    },
    await storage('strength-zero-storage.json'),
  );
  await youtube.reload();
  // Nothing may appear while the page reads its settings and settles: the site mark (present
  // whenever artwork is shown) is watched from the first moment until two seconds have passed.
  const appeared = await youtube.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const root = document.documentElement,
          seen = () =>
            root.hasAttribute('data-ww-site') || Boolean(document.getElementById('web-world-themes-decorations'));
        if (seen()) return resolve(true);
        const observer = new MutationObserver(() => seen() && (observer.disconnect(), resolve(true)));
        observer.observe(root, { attributes: true, childList: true, subtree: true });
        setTimeout(() => (observer.disconnect(), resolve(seen())), 2000);
      }),
  );
  expect(appeared).toBe(false);
  await expect(youtube.locator('#web-world-themes-decorations')).toHaveCount(0);
  // The same page draws as soon as the strength is above zero: the storage itself was readable.
  await popup.evaluate(() => chrome.storage.local.set({ 'webWorldThemes.strength': 37 }));
  await drawn(youtube);
});
