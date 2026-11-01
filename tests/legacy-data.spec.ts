import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';

/*
 * Data made before the retro theme was removed (tests/fixtures/backups/, captured at
 * retro-theme-final) keeps working: the backup restores, the stored settings load, and someone who
 * had turned the theme off with the strength slider still sees nothing drawn: on the first read
 * 作品を表示する is saved OFF for them, once (src/storage/settings.ts).
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
  // The strength was 37%: 作品を表示する stays ON, carried over from the old switch, and nothing is
  // written for it.
  await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeChecked();
  expect(await stored(popup, 'webWorldThemes.showArtwork')).toBeUndefined();
});

async function seed(popup: Page, values: Record<string, unknown>) {
  await popup.evaluate(async (values) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(values);
  }, values);
}
const stored = (popup: Page, key: string) =>
  popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key);

test('storage with the strength at 0% is moved to OFF once: nothing is drawn, and later reads keep it', async ({
  popup,
  youtube,
}) => {
  await restore(popup, false);
  const legacy = await storage('strength-zero-storage.json');
  // Written straight into storage, as an update would find it: no install event is involved.
  await seed(popup, legacy);
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
  // Saved as OFF; the old keys stay exactly as they were.
  await expect.poll(() => stored(popup, 'webWorldThemes.showArtwork')).toBe(false);
  expect(await stored(popup, 'webWorldThemes.strength')).toBe(0);
  expect(await stored(popup, 'webWorldThemes.enabled')).toBe(true);
  await popup.reload();
  await expect(popup.getByRole('switch', { name: '作品を表示する' })).not.toBeChecked();
  // Once saved, the old strength no longer decides anything: raising it shows nothing.
  await popup.evaluate(() => chrome.storage.local.set({ 'webWorldThemes.strength': 37 }));
  await youtube.reload();
  await popup.reload();
  await expect(popup.getByRole('switch', { name: '作品を表示する' })).not.toBeChecked();
  expect(await stored(popup, 'webWorldThemes.showArtwork')).toBe(false);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-site', 'youtube');
  // The same page draws as soon as 作品を表示する is ON: the storage itself was readable.
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  await drawn(youtube);
});

test('a saved 作品を表示する is never changed by the old strength', async ({ popup, youtube }) => {
  await restore(popup, false);
  await seed(popup, { ...(await storage('strength-zero-storage.json')), 'webWorldThemes.showArtwork': true });
  await youtube.reload();
  await drawn(youtube);
  await popup.reload();
  await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeChecked();
  expect(await stored(popup, 'webWorldThemes.showArtwork')).toBe(true);
});
