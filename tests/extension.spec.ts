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
  await expect(thumbnail).toHaveCSS('border-radius', '3px');
  await expect(youtube.locator('yt-thumbnail-view-model')).toHaveCSS('border-radius', '3px');
  await expect(youtube.locator('yt-searchbox .ytSearchboxComponentInputBox')).toHaveCSS('border-radius', '3px');
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
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCSS('border-radius', '3px');
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(youtube).toHaveURL(/\/watch\?v=fixture$/);
  await expect(youtube.getByRole('heading', { name: 'Watch' })).toBeVisible();
  await expect(youtube.locator('ytd-watch-metadata #description')).toHaveAttribute('data-ww-surface', 'panel frame rounded text');
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCSS('border-radius', '3px');

  await youtube.getByRole('button', { name: 'Load another thumbnail' }).click();
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCount(2);
  await expect(youtube.locator('ytd-thumbnail #thumbnail').last()).toHaveCSS('border-radius', '3px');
  await youtube.locator('ytd-searchbox #container').evaluate((element) => { element.id = 'changed-container'; });
  await expect(youtube.locator('#changed-container')).not.toHaveAttribute('data-ww-surface', /.+/);
  await youtube.locator('#changed-container').evaluate((element) => { element.id = 'container'; });
  await expect(youtube.locator('ytd-searchbox #container')).toHaveAttribute('data-ww-surface', 'input frame rounded');

  await youtube.locator(themeStyle).evaluate((element) => element.remove());
  await expect(youtube.locator(themeStyle)).toHaveCount(1);
  await expect(youtube.locator('ytd-thumbnail #thumbnail').last()).toHaveCSS('border-radius', '3px');
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
  // Source-authored rich text must inherit the theme's dark-mode foreground.
  await expect.poll(() => youtube.locator('#description span').evaluate(element =>
    getComputedStyle(element).color === getComputedStyle(element.parentElement!).color,
  )).toBe(true);
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
  await expect(panel).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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
  await youtube.getByRole('heading', { name: 'Watch', exact: true }).click();
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

test('window chrome recovers once after DOM replacement and OFF restores the native header placement', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  const nativeHeader = await youtube.locator('ytd-masthead').boundingBox();
  const nativePage = await youtube.locator('ytd-page-manager').boundingBox();
  await toggle.check();
  const chrome = youtube.locator('#web-world-themes-window-chrome');
  await expect(chrome).toHaveCount(1);
  await expect(chrome.getByText('YouTube.exe', { exact: true })).toBeVisible();
  const themedHeader = await youtube.locator('ytd-masthead').boundingBox();
  const page = await youtube.locator('ytd-page-manager').boundingBox();
  expect(themedHeader!.height).toBeGreaterThan(nativeHeader!.height);
  expect(page!.y).toBeGreaterThanOrEqual(themedHeader!.y + themedHeader!.height);

  await chrome.evaluate((element) => element.remove());
  await expect(chrome).toHaveCount(1);
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(chrome).toHaveCount(1);
  await popup.getByRole('button', { name: '効果(E)', exact: true }).click();
  await expect(popup.getByRole('slider', { name: 'Effect Strength' })).toBeFocused();
  await toggle.uncheck();
  await expect(chrome).toHaveCount(0);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-window-chrome', '');
  await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
  const restoredHeader = await youtube.locator('ytd-masthead').boundingBox();
  const restoredPage = await youtube.locator('ytd-page-manager').boundingBox();
  expect(restoredHeader!.height).toBe(nativeHeader!.height);
  // The SPA changed content, but its top offset returns to the native position.
  expect(restoredPage!.y).toBe(nativePage!.y);
});


test('repeated theme ON, OFF, and zero strength leave no stale surfaces or layout offsets', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  const slider = popup.getByRole('slider', { name: 'Effect Strength' });
  const root = youtube.locator('html');
  const nativeHeader = await youtube.locator('ytd-masthead').boundingBox();
  const nativePage = await youtube.locator('ytd-page-manager').boundingBox();
  const assertNative = async () => {
    await expect(youtube.locator(themeStyle)).toHaveCount(0);
    await expect(youtube.locator('[data-ww-surface]')).toHaveCount(0);
    await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(0);
    for (const name of ['data-ww-theme', 'data-ww-site', 'data-ww-mode', 'data-ww-window-chrome', 'data-ww-fullscreen']) {
      expect(await root.getAttribute(name)).toBeNull();
    }
    expect(await root.evaluate(element => Array.from((element as HTMLElement).style).filter(name => name.startsWith('--ww-')))).toEqual([]);
    expect((await youtube.locator('ytd-masthead').boundingBox())!.height).toBe(nativeHeader!.height);
    expect((await youtube.locator('ytd-page-manager').boundingBox())!.y).toBe(nativePage!.y);
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle.check();
    await slider.press('End');
    await expect(youtube.locator(themeStyle)).toHaveCount(1);
    await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(1);
    await slider.press('Home');
    await expect(toggle).toBeChecked();
    await assertNative();
    await slider.press('End');
    await expect(youtube.locator(themeStyle)).toHaveCount(1);
    await toggle.uncheck();
    await assertNative();
  }
  // Mutations and native mode changes while disabled must not remount a feature or theme.
  await youtube.getByRole('button', { name: 'Load another thumbnail' }).click();
  await root.evaluate(element => element.setAttribute('dark', ''));
  await assertNative();
  await toggle.check();
  await expect(root).toHaveAttribute('data-ww-mode', 'dark');
  await expect(youtube.locator('ytd-thumbnail #thumbnail').last()).toHaveCSS('border-radius', '3px');
});

test('feature preference independently mounts and cleans up window chrome in both settings surfaces', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', { name: 'Theme ON / OFF' });
  const feature = popup.getByRole('switch', { name: 'Window chrome', exact: true });
  const chrome = youtube.locator('#web-world-themes-window-chrome');
  await expect(feature).toBeChecked();
  await feature.uncheck();
  await toggle.check();
  await expect(youtube.locator(themeStyle)).toHaveCount(1);
  await expect(chrome).toHaveCount(0);
  await expect(youtube.locator('ytd-masthead')).toHaveCSS('height', '56px');

  for (let cycle = 0; cycle < 3; cycle++) {
    await feature.check();
    await expect(chrome).toHaveCount(1);
    await feature.uncheck();
    await expect(chrome).toHaveCount(0);
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-window-chrome', '');
    await expect(youtube.locator(themeStyle)).toHaveCount(1);
    await expect(youtube.locator('ytd-masthead')).toHaveCSS('height', '56px');
  }
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
  const panel = youtube.getByRole('dialog', { name: 'Web World Themes の設定' });
  const panelFeature = panel.getByRole('switch', { name: 'Window chrome', exact: true });
  await expect(panelFeature).not.toBeChecked();
  await panelFeature.check();
  await expect(feature).toBeChecked();
  await expect(chrome).toHaveCount(1);
  await toggle.uncheck();
  await expect(chrome).toHaveCount(0);
  await expect(feature).toBeChecked();
  await expect(panelFeature).toBeChecked();
  await popup.reload();
  await expect(popup.getByRole('switch', { name: 'Window chrome', exact: true })).toBeChecked();
  await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).not.toBeChecked();
});

test('native search, history navigation, comment typing, and local video playback survive theming', async ({ popup, youtube }) => {
  const errors: string[] = [];
  youtube.on('pageerror', error => errors.push(error.message));
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  const search = youtube.getByRole('textbox', { name: 'Search', exact: true });
  await search.fill('海辺 ambient 2003');
  await search.press('Enter');
  await expect(youtube).toHaveURL(/\/results\?search_query=/);
  expect(new URL(youtube.url()).searchParams.get('search_query')).toBe('海辺 ambient 2003');
  await expect(youtube.getByRole('heading', { name: 'Search results' })).toBeVisible();
  await expect(search).toHaveValue('海辺 ambient 2003');
  await youtube.locator('#video-title').first().click();
  await expect(youtube).toHaveURL(/\/watch\?v=fixture$/);
  const comment = youtube.getByRole('textbox', { name: 'Add a comment', exact: true });
  await comment.fill('Nice colors! こんにちは');
  await expect(comment).toHaveText('Nice colors! こんにちは');
  const video = youtube.locator('video');
  await youtube.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  const initialTime = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(youtube.locator(themeStyle)).toHaveCount(0);
  await expect(comment).toHaveText('Nice colors! こんにちは');
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(initialTime);
  await youtube.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await youtube.goBack();
  await expect(youtube.getByRole('heading', { name: 'Search results' })).toBeVisible();
  await youtube.goForward();
  await expect(youtube.getByRole('heading', { name: 'Watch', exact: true })).toBeVisible();
  await expect(youtube.locator('[data-ww-settings-button]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('theme transitions never filter, replace, or rewrite native images and media', async ({ popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const native = await youtube.evaluateHandle(() => ({
    images: Array.from(document.images).map(image => ({ element: image, parent: image.parentElement, src: image.getAttribute('src'), alt: image.alt })),
    video: document.querySelector('video')!,
    stream: document.querySelector('video')!.srcObject,
    player: document.querySelector('#movie_player'),
  }));
  const assertMedia = async () => {
    expect(await youtube.evaluate(({ images, video, stream, player }) => ({
      imagesUnchanged: images.every(({ element, parent, src, alt }) => element.isConnected && element.parentElement === parent && element.getAttribute('src') === src && element.alt === alt),
      mediaUnchanged: document.querySelector('video') === video && video.srcObject === stream && video.parentElement === player,
      stylesUntouched: [...images.map(item => item.element), video].every(element => {
        const style = getComputedStyle(element);
        return style.filter === 'none' && style.transform === 'none' && style.opacity === '1' && style.mixBlendMode === 'normal';
      }),
    }), native)).toEqual({ imagesUnchanged: true, mediaUnchanged: true, stylesUntouched: true });
  };
  await assertMedia();
  for (let cycle = 0; cycle < 2; cycle++) {
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
    await expect(youtube.locator(themeStyle)).toHaveCount(1);
    await assertMedia();
    await youtube.locator('html').evaluate(element => element.toggleAttribute('dark'));
    await assertMedia();
    await popup.getByRole('slider', { name: 'Effect Strength' }).press('Home');
    await expect(youtube.locator(themeStyle)).toHaveCount(0);
    await assertMedia();
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  }
  await native.dispose();
});

test('native and in-page fullscreen hide window chrome and restore offsets on exit', async ({ popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  const chrome = youtube.locator('#web-world-themes-window-chrome');
  const root = youtube.locator('html');
  const page = youtube.locator('ytd-page-manager');
  await expect(chrome).toBeVisible();
  const margin = await page.evaluate(element => getComputedStyle(element).marginTop);
  for (let cycle = 0; cycle < 2; cycle++) {
    await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(root).toHaveAttribute('data-ww-fullscreen', '');
    await expect(chrome).not.toBeVisible();
    await expect(page).toHaveCSS('margin-top', '0px');
    const player = await youtube.locator('#movie_player').boundingBox();
    expect(player!.width).toBe(youtube.viewportSize()!.width);
    expect(player!.height).toBe(youtube.viewportSize()!.height);
    await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(root).not.toHaveAttribute('data-ww-fullscreen', '');
    await expect(chrome).toBeVisible();
    await expect(page).toHaveCSS('margin-top', margin);
  }
  await youtube.locator('ytd-watch-flexy').evaluate(element => element.setAttribute('fullscreen', ''));
  await expect(root).toHaveAttribute('data-ww-fullscreen', '');
  await expect(chrome).not.toBeVisible();
  await expect(page).toHaveCSS('margin-top', '0px');
  await youtube.locator('ytd-watch-flexy').evaluate(element => element.removeAttribute('fullscreen'));
  await expect(root).not.toHaveAttribute('data-ww-fullscreen', '');
  await expect(chrome).toBeVisible();
  await expect(page).toHaveCSS('margin-top', margin);
});

test('a failed feature save restores the saved preference without changing the active theme', async ({ popup, youtube }) => {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  const feature = popup.getByRole('switch', { name: 'Window chrome', exact: true });
  await expect(feature).toBeChecked();
  await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(1);
  await popup.evaluate(() => {
    chrome.storage.local.set = async () => { throw new Error('Injected feature write failure'); };
  });
  await feature.uncheck();
  await expect(popup.locator('#save-status')).toHaveText('保存できませんでした。もう一度操作してください。');
  await expect(feature).toBeChecked();
  await expect(popup.getByRole('switch', { name: 'Theme ON / OFF' })).toBeChecked();
  await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(1);
  await expect(youtube.locator(themeStyle)).toHaveCount(1);
});
