import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';
import { nativeShortcut } from './helpers/native-shortcut';

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
    await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
    const opened = context.waitForEvent('page');
    await panel.click('.display-settings');
    const settings = await opened;
    await expect(settings.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
    await expect(settings.locator('#creator-editor-direct')).toBeEnabled();
    await settings.screenshot({ path: info.outputPath('display-settings.png') });
    // Return directly to the same target and its existing draft.
    await settings.locator('#creator-editor-direct').click();
    await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
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
      await panel.click('.close', false);
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

test('the page editor opens display settings and hands its unsaved draft back to the official panel', async () => {
  test.setTimeout(60_000);
  const { context, page, popup, id } = await setup();
  try {
    await page.bringToFront();
    await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
    const editor = page.locator('#web-world-themes-creator');
    await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await expect(editor.locator('.dirty')).toHaveText('未保存の変更');
    await editor.locator('.display-settings').click();
    const settings = page.getByRole('dialog', { name: 'Web World Themes の設定' });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'エディターを開く', exact: true }).click();
    await expect(settings).not.toBeVisible();
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('未保存の変更');
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
