import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';
import { openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver } from './helpers/side-panel';
import { attachOperationDiagnostics } from './helpers/operation-diagnostics';
import { nativeShortcut } from './helpers/native-shortcut';
import { enterNativeTheater } from './helpers/youtube-theater';

const shots = 'docs/screenshots/theme-removal-verification';
test('optional real YouTube settings and backup in light and dark', async () => {
  test.skip(process.env.WW_LIVE_THEME_REMOVAL !== '1', 'Explicit public YouTube verification.');
  test.setTimeout(150_000);
  await mkdir(shots, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/removal-visual-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await popup.setViewportSize({ width: 360, height: 760 });
    const backup = await context.newPage();
    await backup.goto(`chrome-extension://${id}/backup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    for (const mode of ['light', 'dark'] as const) {
      for (const tab of [popup, backup, page]) await tab.emulateMedia({ colorScheme: mode });
      // Explicitly choose the native page appearance, independently of YouTube's saved preference.
      await page.evaluate((dark) => document.documentElement.toggleAttribute('dark', dark), mode === 'dark');
      await popup.screenshot({ path: `${shots}/popup-${mode}.png`, fullPage: true, animations: 'disabled' });
      await backup.screenshot({ path: `${shots}/backup-${mode}.png`, fullPage: true, animations: 'disabled' });
      await page.locator('#movie_player').hover();
      await page.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
      const panel = page.locator('#web-world-themes-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('switch', { name: '作品を表示する' })).toBeChecked();
      await page.screenshot({ path: `${shots}/video-settings-${mode}.png`, animations: 'disabled' });
      await panel.getByRole('button', { name: '設定を閉じる' }).click();
    }
    const design = {
      schemaVersion: 13,
      id: 'removal-live',
      siteId: 'youtube',
      baseThemeId: 'retro' as string | null,
      rules: [{ kind: 'surface-style', target: 'search-box', style: { borderRadiusPx: 8 } }],
      decorations: [],
    };
    await popup.evaluate((design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': design }), design);
    await expect(page.locator('html')).toHaveAttribute('data-ww-design', 'removal-live');
    const original = await page.locator('#web-world-themes-design-style').textContent();
    await popup.evaluate(
      (design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': { ...design, baseThemeId: null } }),
      design,
    );
    await expect.poll(() => page.locator('#web-world-themes-design-style').textContent()).toBe(original);
    const restoreView = await enterNativeTheater(page);
    await expect(page.locator('html')).toHaveAttribute('data-ww-design', 'removal-live');
    await restoreView();
    await page.getByRole('button', { name: /^Full screen|^全画面/ }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    const search = page.getByRole('combobox', { name: /Search|検索/ });
    await search.fill('lofi hip hop');
    await search.press('Enter');
    await expect(page).toHaveURL(/results\?search_query=/);
    await expect(page.locator('html')).toHaveAttribute('data-ww-design', 'removal-live');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-ww-design', 'removal-live');
  } finally {
    await context.close();
  }
});

test('optional real YouTube side panel: covered input, resume, OFF and native emergency shortcut', async ({}, info) => {
  test.skip(process.env.WW_LIVE_THEME_REMOVAL_G1 !== '1', 'Explicit signed-out native side panel verification.');
  test.setTimeout(180_000);
  await mkdir(shots, { recursive: true });
  const profile = await mkdtemp(path.resolve('.work/g-entry-profile-'));
  const extension = await mkdtemp(path.resolve('.work/g-entry-extension-'));
  await cp(path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist'), extension, { recursive: true });
  const context = await launchExtension(profile, false, {
    headed: true,
    width: 1600,
    height: 1100,
    extensionPath: extension,
  });
  const records: Record<string, unknown> = {};
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto(process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    await openSidePanelFromIcon(popup, page);
    const panel = await sidePanelDriver(context, page, id);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    const host = page.locator('#web-world-themes-decorations');
    await expect(host.locator('[data-image-id]')).toHaveCount(1);
    const state = () => host.evaluate((node: HTMLElement) => JSON.parse(node.dataset.wwSafety ?? '{}').stopped);
    await expect.poll(state).toBe('');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    expect(
      await popup.evaluate(
        async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
      ),
    ).toMatchObject({ baseThemeId: null });
    const search = page.getByRole('combobox', { name: /Search|検索/ });
    await expect(search).toBeVisible();
    const box = (await search.boundingBox())!;
    await host.evaluate((node: HTMLElement) => {
      const seen: string[] = ((window as unknown as { removalStops: string[] }).removalStops = []);
      new MutationObserver(() => {
        const stopped = JSON.parse(node.dataset.wwSafety ?? '{}').stopped;
        if (stopped) seen.push(stopped);
      }).observe(node, { attributes: true, attributeFilter: ['data-ww-safety'] });
    });
    await page.evaluate((box) => {
      const cover = document.createElement('div');
      cover.id = 'removal-cover';
      cover.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:2147483000`;
      document.body.append(cover);
    }, box);
    const covered = 'クリックがページの操作部品に届くよう、絵の表示を止めました。';
    const click = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const seen = () => page.evaluate(() => (window as unknown as { removalStops: string[] }).removalStops);
    await click();
    await expect.poll(seen).toContain(covered);
    await expect.poll(state).toBe('');
    await click();
    await expect.poll(async () => (await seen()).filter((s) => s === covered).length).toBeGreaterThanOrEqual(2);
    await expect.poll(state).toBe('');
    await click();
    await expect.poll(state).toBe(covered);
    const resumeVisible = () =>
      panel.evaluate<boolean>(
        '!!document.querySelector(".ww-editor-safety .safety-resume") && !document.querySelector(".ww-editor-safety .safety-resume").hidden',
      );
    await expect.poll(resumeVisible).toBe(true);
    await page.screenshot({ path: `${shots}/g1-stopped.png` });
    const resume = () => panel.evaluate('document.querySelector(".ww-editor-safety .safety-resume").click()');
    await resume();
    await expect.poll(state).toBe('');
    await click();
    await expect.poll(state).toBe(covered);
    await page.evaluate(() => document.getElementById('removal-cover')!.remove());
    await resume();
    await expect.poll(state).toBe('');
    await search.fill('G1 removal verification');
    await expect(search).toHaveValue('G1 removal verification');
    await search.fill('');
    records.stops = await seen();
    await page.screenshot({ path: `${shots}/g1-resumed.png` });
    await panel.screenshot(`${shots}/g1-sidepanel.png`);
    // The sidebar remains open through both boundaries. Settings entry UI is independently owned.
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    const clean = async () =>
      page.evaluate(() => ({
        marks: [...document.querySelectorAll('*')].flatMap((node) =>
          node
            .getAttributeNames()
            .filter(
              (name) =>
                name.startsWith('data-ww-') && name !== 'data-ww-settings-button' && name !== 'data-ww-asset-reader',
            )
            .map((name) => `${node.tagName}:${name}`),
        ),
        drawn: [...document.querySelectorAll('[id^="web-world-themes-"]')]
          .map((node) => node.id)
          .filter((id) => id !== 'web-world-themes-panel'),
      }));
    await expect.poll(clean).toEqual({ marks: [], drawn: [] });
    records.off = await clean();
    await showArtwork(popup);
    await expect(host.locator('[data-image-id]')).toHaveCount(1);
    await page.bringToFront();
    await nativeShortcut(page, profile, extension, 'Q');
    await expect
      .poll(() =>
        popup.evaluate(
          async () =>
            (await chrome.storage.local.get('webWorldThemes.safety.emergencyOff'))[
              'webWorldThemes.safety.emergencyOff'
            ],
        ),
      )
      .toBe(true);
    await expect.poll(clean).toEqual({ marks: [], drawn: [] });
    records.emergency = await clean();
    await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
    await expect(host.locator('[data-image-id]')).toHaveCount(1);
    await panel.detach();
  } catch (error) {
    const page = context.pages().find((tab) => tab.url().startsWith('https://www.youtube.com/'));
    if (page) await attachOperationDiagnostics(page);
    throw error;
  } finally {
    await info.attach('sidepanel-g1.json', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
    await context.close();
  }
});
