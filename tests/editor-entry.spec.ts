import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';
import { nativeShortcut } from './helpers/native-shortcut';
import { openEditor } from './helpers/editor';

async function setup() {
  const work = path.resolve('.work');
  await mkdir(work, { recursive: true });
  const extension = await mkdtemp(path.join(work, 'g-entry-extension-'));
  await cp(path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Chrome's _execute_action invokes the real toolbar action (Popup / onClicked).
  // Bind it only in this private test copy; no synthetic runtime message launches UI.
  manifest.commands._execute_action = { suggested_key: { default: 'Alt+Shift+Y' } };
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const profile = await mkdtemp(path.join(work, 'g-entry-profile-'));
  const context = await launchExtension(profile, true, {
    headed: true,
    width: 1920,
    height: 1080,
    extensionPath: extension,
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
    id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto('chrome-extension://' + id + '/popup/index.html');
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await expect(popup.locator('#creator-editor-direct')).toBeEnabled();
  await page.bringToFront();
  return { context, page, popup, id, profile, extension };
}

test('the emergency accelerator is assigned, latches drawing OFF, and unrelated tabs cannot open Studio', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, profile, extension } = await setup();
  try {
    expect(
      await popup.evaluate(
        async () => (await chrome.commands.getAll()).find((c) => c.name === 'emergency-off')?.shortcut,
      ),
    ).toBe('Alt+Shift+Q');
    await nativeShortcut(page, profile, extension, 'Q');
    await expect(popup.getByRole('button', { name: '描画を再開' })).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-theme', 'retro');
    // A previously approved YouTube tab must lose its approval on navigation.
    const unrelated = page;
    await unrelated.goto('https://example.com/');
    const windows = await popup.evaluate(() => chrome.windows.getAll());
    await nativeShortcut(unrelated, profile, extension, 'E');
    // Observe the actual accelerator delivery interval for a negative UI action.
    await unrelated.waitForTimeout(500);
    expect((await popup.evaluate(() => chrome.windows.getAll())).map((w) => w.id)).toEqual(windows.map((w) => w.id));
    expect(
      await popup.evaluate(async () =>
        (await chrome.runtime.getContexts({})).some((c) => c.contextType === 'SIDE_PANEL'),
      ),
    ).toBe(false);
  } finally {
    await context.close();
  }
});
test('OFF opens the real action settings; its top button opens the editor and settings returns without losing edits', async ({}, info) => {
  test.setTimeout(60_000);
  const { context, page, popup, id, profile, extension } = await setup();
  try {
    await expect(popup.getByRole('switch', { name: '制作モード', exact: true })).not.toBeChecked();
    await nativeShortcut(page, profile, extension, 'Y');
    const action = await sidePanelDriver(context, page, id, undefined, 'popup/index.html');
    await expect.poll(() => action.evaluate('document.querySelector("#creator-editor-direct")?.disabled')).toBe(false);
    expect(await action.evaluate('document.querySelector("#creator-mode").checked')).toBe(false);
    expect(
      await action.evaluate(
        'document.querySelector("#creator-editor-direct").getBoundingClientRect().top < document.querySelector("fieldset").getBoundingClientRect().top',
      ),
    ).toBe(true);
    await action.send('Page.captureScreenshot').then(async (result) => {
      await writeFile(info.outputPath('action-settings.png'), Buffer.from(result.data, 'base64'));
    });
    await action.evaluate('document.querySelector("#creator-editor-direct").click()');
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect.poll(() => panel.text('.dirty')).toBe('未保存');
    const opened = context.waitForEvent('page');
    await panel.click('.display-settings');
    const settings = await opened;
    await expect(settings.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
    await expect(settings.locator('#creator-editor-direct')).toBeEnabled();
    await settings.screenshot({ path: info.outputPath('display-settings.png') });
    // Return directly to the same target and its existing draft.
    await settings.locator('#creator-editor-direct').click();
    await expect.poll(() => panel.text('.dirty')).toBe('未保存');
    await panel.screenshot(info.outputPath('editor-settings-entry.png'));
    await panel.detach();
    await action.detach();
  } finally {
    await context.close();
  }
});
test('ON action and the registered editor shortcut bypass settings; shortcut works in both modes', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, id, profile, extension } = await setup();
  try {
    const commands = await popup.evaluate(() => chrome.commands.getAll());
    expect(commands.find((entry) => entry.name === 'open-editor')?.shortcut).toBe('Alt+Shift+E');
    for (const enabled of [false, true]) {
      await popup.getByRole('switch', { name: '制作モード', exact: true }).setChecked(enabled);
      await expect
        .poll(() => popup.evaluate(() => chrome.action.getPopup({})))
        .toBe(enabled ? '' : 'chrome-extension://' + id + '/popup/index.html');
      await page.bringToFront();
      await nativeShortcut(page, profile, extension, enabled ? 'Y' : 'E');
      const panel = await sidePanelDriver(context, page, id);
      await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
      expect(
        await popup.evaluate(
          async () => (await chrome.runtime.getContexts({})).filter((entry) => entry.contextType === 'POPUP').length,
        ),
      ).toBe(0);
      await panel.clickAndLeave('.close');
      await panel.detach();
    }
    await page.bringToFront();
    await nativeShortcut(page, profile, extension, 'E');
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.detach();
  } finally {
    await context.close();
  }
});
test('settings starts clear of the player, remembers a dragged position, and remains usable in fullscreen', async ({}, info) => {
  test.setTimeout(60_000);
  const { context, page, popup } = await setup();
  try {
    const icon = page.getByRole('button', { name: 'Web World Themes の設定', exact: true });
    const panel = page.getByRole('dialog', { name: 'Web World Themes の設定' });
    for (const enabled of [false, true]) {
      await popup.getByRole('switch', { name: 'Theme ON / OFF' }).setChecked(enabled);
      await expect.poll(() => page.locator('html').getAttribute('data-ww-theme')).toBe(enabled ? 'retro' : null);
      for (const [width, height] of [
        [1920, 1080],
        [1100, 760],
        [760, 760],
      ]) {
        await page.setViewportSize({ width: width!, height: height! });
        await page.evaluate(() => scrollTo(0, 0));
        await icon.click();
        await expect(panel).toBeVisible();
        const a = (await panel.boundingBox())!,
          b = (await page.locator('#movie_player').boundingBox())!;
        expect(
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y,
          width +
            'px settings/player overlap; ' +
            JSON.stringify(
              await panel.evaluate((node) => ({
                style: node.getAttribute('style'),
                player: document.querySelector('#movie_player')?.getBoundingClientRect().toJSON(),
                size: [innerWidth, innerHeight],
                fullscreen: Boolean(document.fullscreenElement),
                scrollY,
              })),
            ),
        ).toBe(false);
        if (width === 1920 && enabled) await page.screenshot({ path: info.outputPath('settings-outside-player.png') });
        await panel.getByRole('button', { name: '設定を閉じる' }).click();
      }
    }
    await page.setViewportSize({ width: 1100, height: 760 });
    await icon.click();
    const titlebar = (await panel.locator('.ww-titlebar').boundingBox())!;
    await page.mouse.move(titlebar.x + 80, titlebar.y + 10);
    await page.mouse.down();
    await page.mouse.move(650, 110, { steps: 5 });
    await page.mouse.up();
    const position = (await panel.boundingBox())!;
    await panel.getByRole('button', { name: '設定を閉じる' }).click();
    await page.reload();
    await icon.click();
    await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(Math.round(position.x));
    await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(Math.round(position.y));
    await panel.getByRole('button', { name: '設定を閉じる' }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await icon.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('slider', { name: 'Effect Strength' })).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('the editor opens display settings and hands its unsaved draft back to the official panel', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, id } = await setup();
  try {
    // UI0-d: the editor is the Studio page (here its own window, as a tab); its 表示設定 opens the
    // same settings as the popup.
    const { panel: editor } = await openEditor(popup, page);
    await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await expect(editor.locator('.dirty')).toHaveText('未保存');
    const opened = context.waitForEvent('page');
    await editor.locator('.display-settings').click();
    const settings = await opened;
    await expect(settings.getByRole('button', { name: 'エディターを開く', exact: true })).toBeEnabled();
    await expect(settings.getByRole('button', { name: '別ウィンドウで開く', exact: true })).toBeEnabled();
    await settings.getByRole('button', { name: 'エディターを開く', exact: true }).click();
    await expect(settings.locator('#creator-launch-status')).toHaveText('サイドパネルで編集中です。');
    // The side panel belongs to the YouTube tab; here the editor's window is a tab of the same window.
    await page.bringToFront();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('未保存');
    expect(
      await panel.evaluate(
        'document.querySelector("#web-world-themes-creator").shadowRoot.querySelectorAll(".layer").length',
      ),
    ).toBe(1);
    await panel.detach();
  } finally {
    await context.close();
  }
});

test('the in-video icon opens the side panel within its click in 制作モード, and 表示設定 otherwise', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, id } = await setup();
  try {
    const icon = page.getByRole('button', { name: 'Web World Themes の設定', exact: true });
    const settings = page.getByRole('dialog', { name: 'Web World Themes の設定' });
    // OFF: the icon opens 表示設定, with the same two ways into the editor as the popup.
    await expect(popup.getByRole('switch', { name: '制作モード', exact: true })).not.toBeChecked();
    await page.bringToFront();
    await icon.click();
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('button', { name: 'エディターを開く', exact: true })).toBeEnabled();
    await expect(settings.getByRole('button', { name: '別ウィンドウで開く', exact: true })).toBeEnabled();
    await expect(settings.getByRole('button', { name: /デザインを編集|インページ/ })).toHaveCount(0);
    await settings.getByRole('button', { name: '設定を閉じる' }).click();
    // ON: the same click opens Chrome's side panel itself (the click's user activation reaches
    // chrome.sidePanel.open through the extension message); no settings appear.
    await popup.getByRole('switch', { name: '制作モード', exact: true }).check();
    await page.bringToFront();
    await icon.click();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(settings).toBeHidden();
    await panel.detach();
  } finally {
    await context.close();
  }
});
