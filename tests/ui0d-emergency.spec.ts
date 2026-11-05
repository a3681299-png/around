import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';
import { nativeShortcut } from './helpers/native-shortcut';

test('UI0-d header and real emergency accelerator stop skins, page marks and the native panel together and resume the draft', async () => {
  test.setTimeout(120_000);
  await mkdir('.work', { recursive: true });
  const extension = await mkdtemp(path.resolve('.work/g-entry-extension-'));
  await cp(path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist'), extension, { recursive: true });
  const profile = await mkdtemp(path.resolve('.work/g-entry-profile-'));
  const context = await launchExtension(profile, true, {
    headed: true,
    width: 1920,
    height: 1080,
    extensionPath: extension,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await showArtwork(popup);
    await page.bringToFront();
    const tab = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
    );
    await popup.evaluate(async (tabId) => {
      const r = await chrome.runtime.sendMessage({ type: 'web-world-themes:open-side-panel', tabId });
      if (!r?.ok) throw Error(r?.error);
    }, tab);
    const panel = await sidePanelDriver(context, page, id, tab);
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    await panel.click('[data-tool="skin"]');
    await panel.click('.skin-part[data-target="video-card"]');
    await panel.files([path.resolve('tests/fixtures/skins/frame-light.png')], '.skin-file');
    const card = page.locator('[data-ww-surface~="video-card"]').first();
    const nativeCard = (await card.elementHandle())!;
    // Emergency OFF also removes adapter surface marks; retain the native node, not that locator.
    const painted = () => nativeCard.evaluate((node) => getComputedStyle(node).borderImageSource);
    await expect.poll(painted).toMatch(/^url\("blob:/);
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'native-emergency-input';
      button.textContent = 'Native input';
      button.style.cssText = 'position:fixed;left:800px;top:100px;z-index:2147483647';
      button.addEventListener('click', () => {
        button.dataset.clicked = String(Number(button.dataset.clicked ?? 0) + 1);
      });
      document.body.append(button);
    });
    let clicks = 0;
    for (const method of ['header', 'accelerator']) {
      if (method === 'header')
        await panel.evaluate('document.querySelector(".ww-editor-safety > .emergency-off").click()');
      else await nativeShortcut(page, profile, extension, 'Q');
      await expect.poll(() => panel.evaluate('document.querySelector(".emergency-resume").hidden')).toBe(false);
      await expect(page.locator('[data-image-id]')).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
      await expect(page.locator('html')).not.toHaveAttribute('data-ww-skin-picking', /.*/);
      await expect(page.locator('#web-world-themes-skin-selected')).toHaveCount(0);
      await expect.poll(painted).toBe('none');
      await page.locator('#native-emergency-input').click();
      await expect(page.locator('#native-emergency-input')).toHaveAttribute('data-clicked', String(++clicks));
      // Emergency OFF suspends drawing and page input; the editor deliberately keeps draft/Undo.
      await expect.poll(() => panel.text('.dirty')).toBe('未保存');
      await panel.evaluate('document.querySelector(".emergency-resume").click()');
      await expect.poll(() => panel.evaluate('document.querySelector(".emergency-off").hidden')).toBe(false);
      await expect(page.locator('[data-image-id]')).toHaveCount(1);
      await expect.poll(painted).toMatch(/^url\("blob:/);
      await expect(page.locator('html')).toHaveAttribute('data-ww-editing', '');
    }
    await panel.click('[data-tool="card"]');
    await card.click();
    await expect(card).toHaveAttribute('data-ww-editor-selected', '');
    await expect(page.locator('#web-world-themes-selection-mark')).toBeVisible();
    await panel.evaluate('document.querySelector(".ww-editor-safety > .emergency-off").click()');
    await expect(page.locator('#web-world-themes-page-marks')).toHaveCount(0);
    await expect.poll(() => nativeCard.getAttribute('data-ww-editor-selected')).toBe(null);
    await panel.evaluate('document.querySelector(".emergency-resume").click()');
    await expect(card).toHaveAttribute('data-ww-editor-selected', '');
    await expect(page.locator('#web-world-themes-selection-mark')).toBeVisible();
  } finally {
    await context.close();
  }
});
