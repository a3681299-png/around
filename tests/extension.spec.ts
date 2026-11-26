import type { Page } from '@playwright/test';
import { test, expect, launchExtension } from './fixtures';

/*
 * The extension's own lifetime on the page: 作品を表示する (ON for a new creator), settings that
 * survive, other hosts left alone, the in-video settings icon and native YouTube left working. The
 * page shows only the artwork (the retro theme is gone, docs/theme-removal.md), so each check saves
 * an artwork that dresses the video cards. Tests that need the switch OFF first say so.
 */
const artworkStyle = '#around-design-style';
const cards = '[data-around-surface~="video-card"]';
const show = { name: '作品を表示する' } as const;
const artwork = {
  schemaVersion: 13,
  id: 'extension-artwork',
  siteId: 'youtube',
  baseThemeId: null,
  rules: [{ kind: 'surface-style', target: 'video-card', style: { backgroundColor: '#ddeeff', borderRadiusPx: 18 } }],
  decorations: [],
};
const dressed = 'rgb(221, 238, 255)';
async function storeArtwork(popup: Page) {
  await popup.evaluate((design) => chrome.storage.local.set({ 'around.design.youtube': design }), artwork);
}
const nativeCard = (page: Page) =>
  page
    .locator('ytd-rich-grid-media')
    .first()
    .evaluate((node) => ({
      background: getComputedStyle(node).background,
      radius: getComputedStyle(node).borderRadius,
    }));

test('a new creator sees saved artwork at once: 作品を表示する starts ON and nothing has to be pressed', async ({
  popup,
  youtube,
}) => {
  await expect(popup.getByRole('switch', show)).toBeChecked();
  await expect(popup.locator('#show-artwork-state')).toHaveText('ON');
  await expect(popup.getByRole('switch', { name: '制作モード' })).not.toBeChecked();
  // Shown with no artwork: the page is followed, and nothing is drawn.
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await expect(youtube.locator(artworkStyle)).toHaveCount(0);
  await storeArtwork(popup);
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);
  // Reading the defaults wrote no setting (the artwork's own caches are not settings).
  expect(
    await popup.evaluate(async () =>
      Object.keys(
        await chrome.storage.local.get([
          'around.showArtwork',
          'around.creatorMode',
          'around.enabled',
          'around.strength',
        ]),
      ),
    ),
  ).toEqual([]);
});

test('popup changes reach existing YouTube tabs and OFF restores native styles', async ({
  context,
  popup,
  youtube,
}) => {
  const toggle = popup.getByRole('switch', show);
  await expect(toggle).toBeEnabled();
  await toggle.uncheck();
  await storeArtwork(popup);
  const native = await nativeCard(youtube);
  await expect(youtube.locator(artworkStyle)).toHaveCount(0);
  const second = await context.newPage();
  await second.goto('https://www.youtube.com/results?search_query=fixture');
  await toggle.check();
  for (const page of [youtube, second]) {
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    await expect(page.locator(artworkStyle)).toHaveCount(1);
    await expect(page.locator(cards).first()).toHaveCSS('background-color', dressed);
  }
  await toggle.uncheck();
  for (const page of [youtube, second]) {
    await expect(page.locator(artworkStyle)).toHaveCount(0);
    await expect(page.locator('[data-around-surface]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  expect(await nativeCard(youtube)).toEqual(native);
});

test('settings survive popup closure, page reload, and a browser restart', async ({
  context,
  popup,
  youtube,
  extensionId,
  profile,
}) => {
  await storeArtwork(popup);
  await popup.getByRole('switch', show).uncheck();
  await expect(popup.locator('#save-status')).toHaveText('保存しました。');
  await expect(youtube.locator(artworkStyle)).toHaveCount(0);
  await popup.close();
  await youtube.reload();
  await expect(youtube.locator('ytd-rich-grid-media').first()).toBeVisible();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await context.close();

  const restarted = await launchExtension(profile);
  try {
    const nextPopup = await restarted.newPage();
    await nextPopup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(nextPopup.getByRole('switch', show)).not.toBeChecked();
    await nextPopup.getByRole('switch', show).check();
    const nextPage = await restarted.newPage();
    await nextPage.goto('https://www.youtube.com/');
    await expect(nextPage.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    await expect(nextPage.locator(cards).first()).toHaveCSS('background-color', dressed);
  } finally {
    await restarted.close();
  }
});

test('SPA replacement, lazy DOM insertion, changing IDs, and a removed artwork sheet recover', async ({
  popup,
  youtube,
}) => {
  const errors: string[] = [];
  youtube.on('pageerror', (error) => errors.push(error.message));
  await storeArtwork(popup);
  await popup.getByRole('switch', show).check();
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(youtube).toHaveURL(/\/watch\?v=fixture$/);
  await expect(youtube.getByRole('heading', { name: 'Watch' })).toBeVisible();
  await expect(youtube.locator('ytd-watch-metadata #description')).toHaveAttribute(
    'data-around-surface',
    'panel frame rounded text',
  );
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);

  await youtube.getByRole('button', { name: 'Load another thumbnail' }).click();
  await expect(youtube.locator('ytd-thumbnail #thumbnail')).toHaveCount(2);
  await youtube.locator('ytd-searchbox #container').evaluate((element) => {
    element.id = 'changed-container';
  });
  await expect(youtube.locator('#changed-container')).not.toHaveAttribute('data-around-surface', /.+/);
  await youtube.locator('#changed-container').evaluate((element) => {
    element.id = 'container';
  });
  await expect(youtube.locator('ytd-searchbox #container')).toHaveAttribute(
    'data-around-surface',
    'input frame rounded',
  );

  await youtube.locator(artworkStyle).evaluate((element) => element.remove());
  await expect(youtube.locator(artworkStyle)).toHaveCount(1);
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);
  expect(errors).toEqual([]);
});

test('the native dark mode is followed, never repainted', async ({ popup, youtube }) => {
  await storeArtwork(popup);
  await popup.getByRole('switch', show).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-mode', 'light');
  await expect(youtube.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await youtube.locator('html').evaluate((element) => element.setAttribute('dark', ''));
  await expect(youtube.locator('html')).toHaveAttribute('data-around-mode', 'dark');
  // YouTube's own dark page, not a palette of ours.
  await expect(youtube.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 15)');
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);
});

test('an invalid stored switch reads as the default without a write, and other hosts stay untouched', async ({
  context,
  popup,
  youtube,
}) => {
  await storeArtwork(popup);
  await popup.evaluate(() => chrome.storage.local.set({ 'around.showArtwork': false }));
  await expect(popup.getByRole('switch', show)).not.toBeChecked();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await popup.evaluate(() => chrome.storage.local.set({ 'around.showArtwork': 'yes' }));
  await expect(popup.getByRole('switch', show)).toBeChecked();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  expect(
    await popup.evaluate(async () => (await chrome.storage.local.get('around.showArtwork'))['around.showArtwork']),
  ).toBe('yes');
  for (const url of [
    'https://example.com/',
    'https://www.youtube.com/embed/fixture',
    'https://www.youtube.com/live_chat?v=fixture',
  ]) {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator(artworkStyle)).toHaveCount(0);
    await expect(page.locator('[data-around-surface]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-around-site', /.*/);
    await page.close();
  }
});

test('a storage write failure shows an error and restores the saved popup state', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', show);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  // Fault injection only; all other tests use the actual extension storage APIs.
  await popup.evaluate(() => {
    chrome.storage.local.set = async () => {
      throw new Error('Injected write failure');
    };
  });
  await toggle.click();
  await expect(popup.locator('#save-status')).toHaveText('保存できませんでした。もう一度操作してください。');
  await expect(toggle).toBeChecked();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
});

test('the first right-hand player icon opens shared settings even when the switch is OFF', async ({
  context,
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', show).uncheck();
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const icon = youtube.getByRole('button', { name: 'Around の設定', exact: true });
  const panel = youtube.getByRole('dialog', { name: 'Around の設定' });
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute(
    'data-around-settings-button',
    '',
  );
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await icon.click();
  const toggle = panel.getByRole('switch', show);
  await expect(panel).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();

  // Metadata and native control updates are not a navigation; keep editing open.
  await youtube.evaluate(() => {
    document.dispatchEvent(new Event('yt-page-data-updated'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    const nativeButton = document.createElement('button');
    nativeButton.className = 'ytp-button';
    nativeButton.setAttribute('aria-label', 'Another native control');
    document.querySelector('.ytp-right-controls')!.prepend(nativeButton);
  });
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute(
    'data-around-settings-button',
    '',
  );
  await expect(panel).toBeVisible();

  const second = await context.newPage();
  await second.goto('https://www.youtube.com/results?search_query=fixture');
  await toggle.check();
  await expect(panel.locator('#save-status')).toHaveText('保存しました。');
  await expect(popup.getByRole('switch', show)).toBeChecked();
  await expect(second.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', /.+/);

  await toggle.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(icon).toBeFocused();
  await icon.press('Enter');
  await expect(toggle).toBeChecked();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-player-key-count', /.+/);
  await popup.getByRole('switch', show).uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-around-site', 'youtube');
  await expect(icon).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '設定を閉じる' }).click();
  await expect(panel).not.toBeVisible();
  await icon.click();
  await youtube.getByRole('heading', { name: 'Watch', exact: true }).click();
  await expect(panel).not.toBeVisible();
});

test('player replacement and control-bar rebuild keep one icon at the left edge; fullscreen keeps the editor', async ({
  popup,
  youtube,
}) => {
  await popup.getByRole('switch', show).uncheck();
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  const icon = youtube.getByRole('button', { name: 'Around の設定', exact: true });
  const panel = youtube.getByRole('dialog', { name: 'Around の設定' });
  await expect(icon).toHaveCount(1);
  await icon.click();
  await expect(panel.getByRole('switch', show)).toBeEnabled();
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(panel).not.toBeVisible();
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute(
    'data-around-settings-button',
    '',
  );

  await youtube.locator('.ytp-right-controls').evaluate((element) => {
    element.replaceChildren(
      ...Array.from(element.children).filter((child) => !child.hasAttribute('data-around-settings-button')),
    );
  });
  await expect(icon).toHaveCount(1);
  await expect(youtube.locator('.ytp-right-controls > :first-child')).toHaveAttribute(
    'data-around-settings-button',
    '',
  );
  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await icon.click();
  await expect(panel).toBeVisible();
  await panel.getByRole('switch', show).check();
  await expect(popup.getByRole('switch', show)).toBeChecked();
  await expect(youtube.locator('html')).toHaveAttribute('data-around-site', 'youtube');
  await panel.getByRole('switch', show).press('Escape');
  await expect(panel).not.toBeVisible();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await youtube.evaluate(() => document.exitFullscreen());
  await youtube.goto('https://www.youtube.com/');
  await expect(youtube.locator('[data-around-settings-button]')).toHaveCount(0);
});

test('repeated ON and OFF leave no stale surfaces, attributes or layout offsets', async ({ popup, youtube }) => {
  const toggle = popup.getByRole('switch', show);
  const root = youtube.locator('html');
  await toggle.uncheck();
  await storeArtwork(popup);
  const nativeHeader = await youtube.locator('ytd-masthead').boundingBox();
  const nativePage = await youtube.locator('ytd-page-manager').boundingBox();
  const assertNative = async () => {
    await expect(youtube.locator(artworkStyle)).toHaveCount(0);
    await expect(youtube.locator('[data-around-surface]')).toHaveCount(0);
    for (const name of ['data-around-site', 'data-around-mode', 'data-around-design', 'data-around-fullscreen']) {
      expect(await root.getAttribute(name), name).toBeNull();
    }
    expect(
      await root.evaluate((element) =>
        Array.from((element as HTMLElement).style).filter((name) => name.startsWith('--around-')),
      ),
    ).toEqual([]);
    expect((await youtube.locator('ytd-masthead').boundingBox())!.height).toBe(nativeHeader!.height);
    expect((await youtube.locator('ytd-page-manager').boundingBox())!.y).toBe(nativePage!.y);
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle.check();
    await expect(youtube.locator(artworkStyle)).toHaveCount(1);
    // The artwork dresses parts in place; nothing of YouTube's moves.
    expect((await youtube.locator('ytd-masthead').boundingBox())!.height).toBe(nativeHeader!.height);
    await toggle.uncheck();
    await assertNative();
  }
  // Mutations and native mode changes while disabled must not draw anything.
  await youtube.getByRole('button', { name: 'Load another thumbnail' }).click();
  await root.evaluate((element) => element.setAttribute('dark', ''));
  await assertNative();
  await toggle.check();
  await expect(root).toHaveAttribute('data-around-mode', 'dark');
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', dressed);
});

test('native search, history navigation, comment typing, and local video playback survive the artwork', async ({
  popup,
  youtube,
}) => {
  const errors: string[] = [];
  youtube.on('pageerror', (error) => errors.push(error.message));
  await storeArtwork(popup);
  await popup.getByRole('switch', show).check();
  await expect(youtube.locator(artworkStyle)).toHaveCount(1);
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
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  const initialTime = await video.evaluate((element) => (element as HTMLVideoElement).currentTime);
  await popup.getByRole('switch', show).uncheck();
  await expect(youtube.locator(artworkStyle)).toHaveCount(0);
  await expect(comment).toHaveText('Nice colors! こんにちは');
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(initialTime);
  await youtube.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await youtube.goBack();
  await expect(youtube.getByRole('heading', { name: 'Search results' })).toBeVisible();
  await youtube.goForward();
  await expect(youtube.getByRole('heading', { name: 'Watch', exact: true })).toBeVisible();
  await expect(youtube.locator('[data-around-settings-button]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('switching the artwork on and off never filters, replaces, or rewrites native images and media', async ({
  popup,
  youtube,
}) => {
  await storeArtwork(popup);
  await popup.getByRole('switch', show).uncheck();
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const native = await youtube.evaluateHandle(() => ({
    images: Array.from(document.images).map((image) => ({
      element: image,
      parent: image.parentElement,
      src: image.getAttribute('src'),
      alt: image.alt,
    })),
    video: document.querySelector('video')!,
    stream: document.querySelector('video')!.srcObject,
    // Where the page put it (YouTube's media container, as the fixture's): never moved.
    player: document.querySelector('video')!.parentElement,
  }));
  const assertMedia = async () => {
    expect(
      await youtube.evaluate(
        ({ images, video, stream, player }) => ({
          imagesUnchanged: images.every(
            ({ element, parent, src, alt }) =>
              element.isConnected &&
              element.parentElement === parent &&
              element.getAttribute('src') === src &&
              element.alt === alt,
          ),
          mediaUnchanged:
            document.querySelector('video') === video && video.srcObject === stream && video.parentElement === player,
          stylesUntouched: [...images.map((item) => item.element), video].every((element) => {
            const style = getComputedStyle(element);
            return (
              style.filter === 'none' &&
              style.transform === 'none' &&
              style.opacity === '1' &&
              style.mixBlendMode === 'normal'
            );
          }),
        }),
        native,
      ),
    ).toEqual({ imagesUnchanged: true, mediaUnchanged: true, stylesUntouched: true });
  };
  await assertMedia();
  for (let cycle = 0; cycle < 2; cycle++) {
    await popup.getByRole('switch', show).check();
    await expect(youtube.locator(artworkStyle)).toHaveCount(1);
    await assertMedia();
    await youtube.locator('html').evaluate((element) => element.toggleAttribute('dark'));
    await assertMedia();
    await popup.getByRole('switch', show).uncheck();
    await expect(youtube.locator(artworkStyle)).toHaveCount(0);
    await assertMedia();
  }
  await native.dispose();
});

test('nested chip shapes follow aria-pressed state without hiding the selected glass', async ({ popup, youtube }) => {
  await popup.getByRole('switch', show).check();
  await youtube.locator('.chip-row').evaluate((element) => {
    const chip = document.createElement('yt-chip-cloud-chip-renderer');
    chip.id = 'nested-chip';
    chip.innerHTML = '<button aria-pressed="false"><div class="ytChipShapeChip">Nested chip</div></button>';
    element.append(chip);
  });
  const button = youtube.locator('#nested-chip button');
  const shape = youtube.locator('#nested-chip .ytChipShapeChip');
  await expect(shape).toHaveAttribute('data-around-surface', /button/);
  await expect(shape).not.toHaveAttribute('data-around-surface', /selected/);
  await button.evaluate((element) => element.setAttribute('aria-pressed', 'true'));
  await expect(shape).toHaveAttribute('data-around-surface', /selected/);
  await expect(button).not.toHaveAttribute('data-around-surface', /selected/);
  await button.evaluate((element) => element.setAttribute('aria-pressed', 'false'));
  await expect(shape).not.toHaveAttribute('data-around-surface', /selected/);
});
