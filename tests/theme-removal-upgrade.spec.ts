import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchExtension } from './fixtures';

// Build 6ce22ce in .work/theme-verify-old before opting in. Every case uses its own profile and
// extension directory, then rebuilds the current sources into that very directory while Chrome runs.
const cases = [
  { name: 'strength-zero', enabled: true, strength: 0, artwork: true, expected: false },
  { name: 'theme-on', enabled: true, strength: 37, artwork: true, expected: true },
  { name: 'theme-off', enabled: false, strength: 37, artwork: true, expected: false },
  { name: 'untouched-empty', enabled: undefined, strength: undefined, artwork: false, expected: true },
  { name: 'untouched-artwork', enabled: undefined, strength: undefined, artwork: true, expected: true },
];
for (const scenario of cases) {
  test(`same-profile extension update: ${scenario.name}`, async ({}, info) => {
    test.skip(process.env.WW_VERIFY_UPGRADE !== '1', 'Needs the historical build at 6ce22ce.');
    test.setTimeout(90_000);
    await mkdir('.work', { recursive: true });
    const profile = await mkdtemp(path.resolve('.work/removal-update-profile-'));
    const extension = await mkdtemp(path.resolve('.work/removal-update-extension-'));
    await cp('.work/theme-verify-old/dist', extension, { recursive: true });
    const context = await launchExtension(profile, true, { extensionPath: extension });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      let popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      const toggle = popup.getByRole('switch', { name: 'テーマを使う' });
      await expect(toggle).not.toBeChecked();
      if (scenario.enabled !== undefined) {
        // Toggle twice for OFF: a user who explicitly chose OFF has an actual stored false.
        await toggle.check();
        if (!scenario.enabled) await toggle.uncheck();
      }
      if (scenario.strength !== undefined) {
        await popup.locator('#effect-strength').fill(String(scenario.strength));
        await popup.locator('#effect-strength').dispatchEvent('change');
        await expect
          .poll(() =>
            popup.evaluate(
              async () => (await chrome.storage.local.get('webWorldThemes.strength'))['webWorldThemes.strength'],
            ),
          )
          .toBe(scenario.strength);
      }
      if (scenario.artwork) {
        await popup.evaluate(() =>
          chrome.storage.local.set({
            'webWorldThemes.design.youtube': {
              schemaVersion: 13,
              id: 'upgrade-artwork',
              siteId: 'youtube',
              baseThemeId: 'retro',
              rules: [
                {
                  kind: 'surface-style',
                  target: 'video-card',
                  style: { borderRadiusPx: 18, backgroundColor: '#ddeeff' },
                },
              ],
              decorations: [],
            },
          }),
        );
      }
      const page = await context.newPage();
      await page.goto('https://www.youtube.com/');
      const before = await popup.evaluate(() => chrome.storage.local.get(null));
      expect(before['webWorldThemes.enabled']).toBe(scenario.enabled);
      if (scenario.artwork && scenario.enabled && scenario.strength) {
        await expect(page.locator('#web-world-themes-design-style')).toHaveCount(1);
      }
      // This is a fresh export from the real old build, not the checked-in fixture.
      const backup = await context.newPage();
      await backup.goto(`chrome-extension://${id}/backup/index.html`);
      await expect(backup.locator('#backup-export')).toBeEnabled();
      const download = backup.waitForEvent('download');
      await backup.locator('#backup-export').click();
      const archive = path.resolve(`.work/old-${scenario.name}.wwbackup`);
      await (await download).saveAs(archive);
      await backup.close();

      execFileSync(process.execPath, ['scripts/build.mjs'], {
        env: { ...process.env, WW_BUILD_OUT: '.work/' + path.basename(extension) },
        stdio: 'pipe',
        windowsHide: true,
      });
      // Reload the installed extension; its profile and absolute installation path never change.
      const manager = await context.newPage();
      await manager.goto('chrome://extensions/');
      // Chromium allows command-line loading with developer mode OFF, but a manual reload then
      // disables the unpacked extension. Match the developer's normal update procedure first.
      const developer = manager.locator('extensions-toolbar #devMode');
      if (!(await developer.evaluate((node: HTMLElement & { checked: boolean }) => node.checked)))
        await developer.click();
      const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
      await item.locator('#dev-reload-button').click();
      await expect
        .poll(() => item.evaluate((node: HTMLElement & { data?: { description: string } }) => node.data?.description))
        .toContain('自分で作った世界');
      await expect
        .poll(() => item.evaluate((node: HTMLElement & { data?: { id: string } }) => node.data?.id ?? node.id))
        .toBe(id);
      popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeChecked({ checked: scenario.expected });
      await page.reload();
      if (scenario.expected) await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
      else await expect(page.locator('html')).not.toHaveAttribute('data-ww-site');
      await expect(page.locator('#web-world-themes-design-style')).toHaveCount(
        scenario.expected && scenario.artwork ? 1 : 0,
      );
      const after = await popup.evaluate(() => chrome.storage.local.get(null));
      expect(after['webWorldThemes.enabled']).toBe(before['webWorldThemes.enabled']);
      expect(after['webWorldThemes.strength']).toBe(before['webWorldThemes.strength']);
      expect(after['webWorldThemes.showArtwork']).toBe(scenario.strength === 0 ? false : undefined);
      await popup.reload();
      await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeChecked({ checked: scenario.expected });
      await info.attach('update.json', {
        body: JSON.stringify({ id, profile, extension, before, after, archive }),
        contentType: 'application/json',
      });
      await mkdir('.work/verification', { recursive: true });
      await writeFile(
        `.work/verification/removal-update-${scenario.name}.json`,
        JSON.stringify({ scenario, id, before, after }, null, 2),
      );
      expect(await readFile(path.join(extension, 'manifest.json'), 'utf8')).not.toContain('assets/fonts');
      // Restore the archive exported above into empty current storage, using the real backup UI.
      await popup.evaluate(() => chrome.storage.local.clear());
      const restored = await context.newPage();
      await restored.goto(`chrome-extension://${id}/backup/index.html`);
      await restored.locator('#backup-file').setInputFiles(archive);
      await restored.locator('#backup-inspect').click();
      await expect(restored.locator('#backup-restore')).toBeEnabled();
      await restored.locator('#backup-restore').click();
      await expect(restored.locator('.backup-status')).toContainText('読み込みが完了');
      await popup.reload();
      const restoredEnabled = scenario.enabled === true && scenario.strength !== 0;
      await expect(popup.getByRole('switch', { name: '作品を表示する' })).toBeChecked({ checked: restoredEnabled });
      await page.reload();
      await expect(page.locator('#web-world-themes-design-style')).toHaveCount(
        restoredEnabled && scenario.artwork ? 1 : 0,
      );
    } finally {
      await context.close();
    }
  });
}
