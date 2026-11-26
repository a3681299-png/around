import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openEditor } from './helpers/editor';

/*
 * Captures, once, a real backup and real chrome.storage contents from the build that still has the
 * retro theme (tag retro-theme-final). The files under tests/fixtures/backups/ are history: they are
 * never recaptured after the removal. AROUND_CAPTURE_BACKUP_FIXTURES=1.
 */
const output = path.resolve('tests/fixtures/backups');
// Every setting the retro theme owned, away from its default, so a reader that drops them is tested.
const settings = {
  'around.enabled': true,
  'around.creatorMode': true,
  'around.strength': 37,
  'around.noiseStrength': 55,
  'around.palette.hue': 210,
  'around.palette.saturation': 40,
  'around.palette.brightness': 70,
  'around.features.window-chrome': false,
  'around.features.surface-noise': true,
  'around.features.bbs-comments': false,
  'around.features.focus-titlebars': true,
};

test('capture the pre-removal backup and storage fixtures', async ({ popup, youtube }) => {
  test.skip(
    process.env.AROUND_CAPTURE_BACKUP_FIXTURES !== '1',
    'History fixtures are captured once, before the removal.',
  );
  test.setTimeout(90_000);
  await mkdir(output, { recursive: true });
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  const { panel: editor } = await openEditor(popup, youtube);
  await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(editor.locator('.layer')).toHaveCount(1);
  await editor.locator('.save').click();
  await expect(editor.locator('.dirty')).toHaveText('保存済み');
  await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
  await popup.evaluate((values) => chrome.storage.local.set(values), settings);
  await youtube.reload();
  await expect(youtube.locator('#around-decorations [data-image-id]')).toHaveCount(1);

  const page = await popup.context().newPage();
  await page.goto(await popup.evaluate(() => chrome.runtime.getURL('backup/index.html')));
  await expect(page.locator('#backup-export')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.locator('#backup-export').click();
  await expect(page.locator('#backup-download')).toBeVisible();
  await (await download).saveAs(path.join(output, 'pre-removal.aroundbackup'));

  const local = await popup.evaluate(() => chrome.storage.local.get(null));
  await writeFile(path.join(output, 'pre-removal-storage.json'), JSON.stringify(local, null, 2) + '\n');
  // Someone who turned the theme off with the strength slider instead of the switch.
  await writeFile(
    path.join(output, 'strength-zero-storage.json'),
    JSON.stringify({ ...local, 'around.strength': 0 }, null, 2) + '\n',
  );
  await writeFile(
    path.join(output, 'provenance.json'),
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        tag: 'retro-theme-final',
        browser: popup.context().browser()?.version() ?? (await popup.evaluate(() => navigator.userAgent)),
        capturedBy: 'tests/backup-fixture-capture.spec.ts',
        files: {
          'pre-removal.aroundbackup':
            'Backup page export: one saved image artwork (baseThemeId retro), its original, every retro setting away from its default',
          'pre-removal-storage.json': 'chrome.storage.local at the same moment',
          'strength-zero-storage.json': 'The same storage with the effect strength at 0% (the switch still ON)',
        },
      },
      null,
      2,
    ) + '\n',
  );
});
