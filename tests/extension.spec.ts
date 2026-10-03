import { test, expect, launchExtension } from './fixtures';

const themeStyle = '#web-world-themes-style';

test('popup changes reach existing YouTube tabs and OFF restores native styles', async ({ context, popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  const slider = popup.getByRole('slider', { name: 'Effect Strength' });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(slider).toHaveValue('60');
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
  const thumbnail = youtube.locator('ytd-thumbnail #thumbnail');
  await expect(thumbnail).toHaveCSS('border-radius', '16px');

  const second = await context.newPage();
  await second.goto('https://www.youtube.com/results?search_query=fixture');
  await toggle.check();
  for (const page of [youtube, second]) {
    await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
    await expect(page.locator(themeStyle)).toHaveCount(1);
  }
  const weak = await youtube.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  await slider.press('End');
  await expect(thumbnail).toHaveCSS('border-radius', '2px');
  await expect(youtube.locator('yt-thumbnail-view-model')).toHaveCSS('border-radius', '2px');
  await expect(youtube.locator('yt-searchbox .ytSearchboxComponentInputBox')).toHaveCSS('border-radius', '2px');
  await expect(second.locator('html')).toHaveAttribute('style', /--ww-strength: 1;/);
  const strong = await youtube.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(strong).not.toBe(weak);

  await toggle.uncheck();
  for (const page of [youtube, second]) {
    await expect(page.locator(themeStyle)).toHaveCount(0);
    await expect(page.locator('[data-ww-surface]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-theme', 'retro');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  await expect(thumbnail).toHaveCSS('border-radius', '16px');
  await expect(youtube.locator('yt-thumbnail-view-model')).toHaveCSS('border-radius', '12px');
});

test('settings survive popup closure, page reload, and a browser restart', async ({ context, popup, youtube, extensionId, profile }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  const slider = popup.getByRole('slider', { name: 'Effect Strength' });
  await slider.press('Home');
  for (let step = 0; step < 37; step++) await slider.press('ArrowRight');
  await expect(popup.locator('#save-status')).toHaveText('保存しました。');
  await expect(youtube.locator('html')).toHaveAttribute('style', /--ww-strength: 0.37;/);
  await popup.close();
  await youtube.reload();
  await expect(youtube.locator('html')).toHaveAttribute('style', /--ww-strength: 0.37;/);
  await context.close();

  const restarted = await launchExtension(profile);
  try {
    const nextPopup = await restarted.newPage();
    await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(nextPopup.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
    await expect(nextPopup.getByRole('slider', { name: 'Effect Strength' })).toHaveValue('37');
    const nextPage = await restarted.newPage();
    await nextPage.goto('https://www.youtube.com/watch?v=fixture');
    await expect(nextPage.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
    await expect(nextPage.locator('html')).toHaveAttribute('style', /--ww-strength: 0.37;/);
  } finally {
    await restarted.close();
  }
});

test('SPA replacement, lazy DOM insertion, changing IDs, and removed stylesheet recover', async ({ popup, youtube }) => {
  const errors: string[] = [];
  youtube.on('pageerror', (error) => errors.push(error.message));
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCSS('border-radius', '2px');
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(youtube).toHaveURL(/\/watch\?v=fixture$/);
  await expect(youtube.getByRole('heading', { name: 'Watch' })).toBeVisible();
  await expect(youtube.locator('ytd-watch-metadata #description')).toHaveAttribute('data-ww-surface', 'panel frame rounded');
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCSS('border-radius', '2px');

  await youtube.getByRole('button', { name: 'Load another thumbnail' }).click();
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCount(2);
  await expect(youtube.locator('ytd-thumbnail #thumbnail').last()).toHaveCSS('border-radius', '2px');
  await youtube.locator('ytd-searchbox #container').evaluate((element) => { element.id = 'changed-container'; });
  await expect(youtube.locator('#changed-container')).not.toHaveAttribute('data-ww-surface', /.+/);
  await youtube.locator('#changed-container').evaluate((element) => { element.id = 'container'; });
  await expect(youtube.locator('ytd-searchbox #container')).toHaveAttribute('data-ww-surface', 'panel frame rounded');

  await youtube.locator(themeStyle).evaluate((element) => element.remove());
  await expect(youtube.locator(themeStyle)).toHaveCount(1);
  await expect(youtube.locator('ytd-thumbnail #thumbnail').last()).toHaveCSS('border-radius', '2px');
  expect(errors).toEqual([]);
});

test('zero is native appearance and switching YouTube dark mode updates the palette', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  const slider = popup.getByRole('slider', { name: 'Effect Strength' });
  await toggle.check();
  await slider.press('Home');
  await expect(toggle).toBeChecked();
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCSS('border-radius', '16px');
  await slider.press('End');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', 'light');
  const light = await youtube.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  await youtube.locator('html').evaluate((element) => element.setAttribute('dark', ''));
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', 'dark');
  const dark = await youtube.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(dark).not.toBe(light);
  await toggle.uncheck();
  await expect(youtube.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
});

test('invalid settings are normalized and other hosts / excluded YouTube pages stay untouched', async ({ context, popup, youtube }) => {
  await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).toBeEnabled();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ 'webWorldThemes.enabled': true, 'webWorldThemes.strength': 999 });
  });
  await expect(popup.getByRole('slider', { name: 'Effect Strength' })).toHaveValue('100');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  for (const url of ['https://example.com/', 'https://www.youtube.com/embed/fixture', 'https://www.youtube.com/live_chat?v=fixture']) {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator(themeStyle)).toHaveCount(0);
    await expect(page.locator('[data-ww-surface]')).toHaveCount(0);
    await page.close();
  }
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ 'webWorldThemes.enabled': 'yes', 'webWorldThemes.strength': 'invalid' });
  });
  await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).not.toBeChecked();
  await expect(popup.getByRole('slider', { name: 'Effect Strength' })).toHaveValue('60');
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
});

test('a storage write failure shows an error and restores the saved popup state', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  await expect(toggle).toBeEnabled();
  // Fault injection only; all other tests use the actual extension storage APIs.
  await popup.evaluate(() => {
    chrome.storage.local.set = async () => { throw new Error('Injected write failure'); };
  });
  await toggle.click();
  await expect(popup.locator('#save-status')).toHaveText('保存できませんでした。もう一度操作してください。');
  await expect(toggle).not.toBeChecked();
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
});

test('the first right-hand player icon opens shared settings even when the theme is OFF', async ({ context, popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const icon = youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true });
  const panel = youtube.getByRole('dialog', { name: 'Web World Themes の設定' });
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute('data-ww-settings-button', '');
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
  await icon.click();
  const toggle = panel.getByRole('switch', { name: 'Theme ON / OFF' });
  const slider = panel.getByRole('slider', { name: 'Effect Strength' });
  await expect(panel).toHaveCSS('background-color', 'rgb(239, 238, 232)');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(slider).toHaveValue('60');

  // Metadata and native control updates are not a navigation; keep editing open.
  await youtube.evaluate(() => {
    document.dispatchEvent(new Event('yt-page-data-updated'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    const nativeButton = document.createElement('button');
    nativeButton.className = 'ytp-button';
    nativeButton.setAttribute('aria-label', 'Another native control');
    document.querySelector('.ytp-right-controls')!.prepend(nativeButton);
  });
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute('data-ww-settings-button', '');
  await expect(panel).toBeVisible();

  const second = await context.newPage();
  await second.goto('https://www.youtube.com/results?search_query=fixture');
  await toggle.check();
  await slider.press('Home');
  for (let step = 0; step < 23; step++) await slider.press('ArrowRight');
  await expect(panel.locator('#save-status')).toHaveText('保存しました。');
  await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
  await expect(popup.getByRole('slider', { name: 'Effect Strength' })).toHaveValue('23');
  await expect(second.locator('html')).toHaveAttribute('style', /--ww-strength: 0.23;/);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', /.+/);

  await slider.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(icon).toBeFocused();
  await icon.press('Enter');
  await expect(slider).toHaveValue('23');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', /.+/);
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  await expect(slider).toHaveValue('100');
  await toggle.uncheck();
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
  await expect(icon).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '設定を閉じる' }).click();
  await expect(panel).not.toBeVisible();
  await icon.click();
  await youtube.getByRole('heading', { name: 'Home' }).click();
  await expect(panel).not.toBeVisible();
});

test('player replacement and control-bar rebuild keep one icon at the left edge; fullscreen keeps the editor', async ({ popup, youtube }) => {
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  const icon = youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true });
  const panel = youtube.getByRole('dialog', { name: 'Web World Themes の設定' });
  await expect(icon).toHaveCount(1);
  await icon.click();
  await expect(panel.getByRole('slider', { name: 'Effect Strength' })).toBeEnabled();
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(panel).not.toBeVisible();
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute('data-ww-settings-button', '');

  await youtube.locator('.ytp-right-controls').evaluate((element) => {
    element.replaceChildren(...Array.from(element.children).filter((child) => !child.hasAttribute('data-ww-settings-button')));
  });
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute('data-ww-settings-button', '');
  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await icon.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await panel.getByRole('slider', { name: 'Effect Strength' }).press('End');
  await expect(popup.getByRole('slider', { name: 'Effect Strength' })).toHaveValue('100');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await panel.getByRole('slider', { name: 'Effect Strength' }).press('Escape');
  await expect(panel).not.toBeVisible();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await youtube.evaluate(() => document.exitFullscreen());
  await youtube.goto('https://www.youtube.com/');
  await expect(youtube.locator('[data-ww-settings-button]')).toHaveCount(0);
});
