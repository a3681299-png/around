import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function enable(popup: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
}

async function setFeature(popup: Page, id: string, enabled: boolean) {
  await popup.evaluate(
    async ({ id, enabled }) => {
      await chrome.storage.local.set({ [`webWorldThemes.features.${id}`]: enabled });
    },
    { id, enabled },
  );
}

async function assertFooterSafe(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector<HTMLElement>('#web-world-themes-statusbar')!;
        const style = getComputedStyle(footer);
        if (style.visibility === 'hidden' || style.display === 'none') return true;
        const bar = footer.getBoundingClientRect();
        const elements = document.querySelectorAll(
          '#movie_player, button, input, textarea, a[href], [contenteditable="true"]',
        );
        return [...elements]
          .filter((element) => !element.closest('#web-world-themes-window-chrome'))
          .every((element) => {
            const rect = element.getBoundingClientRect();
            return (
              !rect.width ||
              !rect.height ||
              rect.bottom <= bar.top ||
              rect.top >= bar.bottom ||
              rect.right <= bar.left ||
              rect.left >= bar.right
            );
          });
      }),
    )
    .toBe(true);
}

test('measured footer reservation yields to watch controls at the screenshot viewport and arbitrary scroll positions', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1917, height: 917 });
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await enable(popup);
  const footer = youtube.locator('#web-world-themes-statusbar');
  const root = youtube.locator('html');
  await expect
    .poll(() =>
      root.evaluate((element) =>
        parseFloat((element as HTMLElement).style.getPropertyValue('--ww-statusbar-reserved-height')),
      ),
    )
    .toBeGreaterThan(0);
  const initial = await youtube.locator('video').evaluate((element) => ({
    aspect: getComputedStyle(element.parentElement!).aspectRatio,
    filter: getComputedStyle(element).filter,
    objectFit: getComputedStyle(element).objectFit,
  }));
  // Reproduce the user's lower-half control collision with native fixture geometry.
  // Position the existing player; extension code must not reparent or resize it.
  await youtube.locator('#movie_player').evaluate((element) => {
    (element as HTMLElement).style.cssText =
      'position:fixed;left:20px;bottom:8px;width:1312px;aspect-ratio:16 / 9;z-index:100;';
  });
  await expect(footer).toHaveAttribute('data-ww-obstructed', '');
  await expect(footer).not.toBeVisible();
  await expect(footer).toHaveCSS('pointer-events', 'none');
  await youtube.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => youtube.locator('video').evaluate((element) => (element as HTMLVideoElement).paused))
    .toBe(false);
  for (const theater of [false, true, false]) {
    await youtube
      .locator('ytd-watch-flexy')
      .evaluate((element, value) => element.toggleAttribute('theater', value), theater);
    for (const height of [917, 700, 500]) {
      await youtube.setViewportSize({ width: 1917, height });
      await assertFooterSafe(youtube);
      await youtube.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
      await assertFooterSafe(youtube);
      await youtube.evaluate(() => scrollTo(0, 0));
    }
  }
  expect(
    await youtube.locator('video').evaluate((element) => ({
      aspect: getComputedStyle(element.parentElement!).aspectRatio,
      filter: getComputedStyle(element).filter,
      objectFit: getComputedStyle(element).objectFit,
    })),
  ).toEqual(initial);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(footer).toHaveCount(0);
  expect(
    await root.evaluate((element) =>
      Array.from((element as HTMLElement).style).filter((name) => name.startsWith('--ww-')),
    ),
  ).toEqual([]);
});

test('a footer height change is measured and native controls crossing its strip remain usable', async ({
  popup,
  youtube,
}) => {
  await enable(popup);
  await youtube.locator('#web-world-themes-statusbar').evaluate((element) => {
    (element as HTMLElement).style.height = '42px';
  });
  await expect(youtube.locator('body')).toHaveCSS('padding-bottom', '42px');
  await expect(youtube.locator('ytd-guide-renderer')).toHaveCSS('bottom', '42px');
  await youtube.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'native-bottom-action';
    button.textContent = 'Native bottom action';
    button.style.cssText = 'position:fixed;bottom:5px;left:300px;width:180px;height:32px;z-index:50';
    button.addEventListener('click', () => {
      button.textContent = 'Native action worked';
    });
    document.body.append(button);
  });
  await expect(youtube.locator('#web-world-themes-statusbar')).not.toBeVisible();
  await youtube.getByRole('button', { name: 'Native bottom action' }).click();
  await expect(youtube.getByRole('button', { name: 'Native action worked' })).toBeVisible();
  // Geometry-only movement triggers the intersection observer, no SPA event needed.
  await youtube.locator('#native-bottom-action').evaluate((element) => {
    (element as HTMLElement).style.bottom = '100px';
  });
  await assertFooterSafe(youtube);
  await setFeature(popup, 'window-chrome', false);
  await expect(youtube.locator('#web-world-themes-statusbar')).toHaveCount(0);
  await expect(youtube.locator('body')).toHaveCSS('padding-bottom', '0px');
  await expect(youtube.locator('ytd-guide-renderer')).toHaveCSS('bottom', '0px');
});

test('gloss, genuine pane focus, daily details, and fullscreen clean up independently', async ({ popup, youtube }) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture&list=fixture');
  await enable(popup);
  await setFeature(popup, 'focus-titlebars', true);
  await setFeature(popup, 'daily-details', true);
  const root = youtube.locator('html');
  const detail = youtube.locator('#web-world-themes-daily-detail');
  await expect(detail).toHaveCount(1);
  expect(await detail.evaluate((element) => Boolean(element.closest('#movie_player')))).toBe(false);
  const dailyText = await detail.textContent();
  await setFeature(popup, 'daily-details', false);
  await expect(detail).toHaveCount(0);
  await expect(youtube.locator('.ww-window-status')).toHaveText('RETRO MODE : ON');
  await setFeature(popup, 'daily-details', true);
  await expect(detail).toHaveText(dailyText!);
  await setFeature(popup, 'glossy-titlebars', false);
  await expect(youtube.locator('#web-world-themes-window-chrome .ww-titlebar')).toHaveCSS('background-image', 'none');
  await youtube.bringToFront();
  await youtube.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(root).toHaveAttribute('data-ww-document-active', '');
  await expect(root).toHaveAttribute('data-ww-active-pane', 'player');
  const playerTitle = youtube.locator('#web-world-themes-player-titlebar');
  const activeFlat = await playerTitle.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(
    await playerTitle.evaluate(
      (element) => getComputedStyle(element).color === getComputedStyle(element.querySelector('.ww-pane-kind')!).color,
    ),
  ).toBe(true);
  await youtube.locator('ytd-playlist-panel-renderer .header').click();
  await expect(root).toHaveAttribute('data-ww-active-pane', 'playlist');
  expect(await playerTitle.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(activeFlat);
  const playlistTitle = youtube.locator('#web-world-themes-playlist-titlebar');
  expect(
    await playlistTitle.evaluate(
      (element) => getComputedStyle(element).color === getComputedStyle(element.querySelector('.ww-pane-kind')!).color,
    ),
  ).toBe(true);
  await setFeature(popup, 'glossy-titlebars', true);
  await expect(playlistTitle).toHaveCSS('background-image', /linear-gradient/);
  await popup.bringToFront();
  await popup.getByRole('slider', { name: 'Effect Strength' }).focus();
  const assertActualFocus = async () => {
    await expect
      .poll(() =>
        youtube.evaluate(
          () =>
            document.documentElement.hasAttribute('data-ww-document-active') ===
            (document.hasFocus() && !document.hidden),
        ),
      )
      .toBe(true);
  };
  // Headless Chromium may keep both page documents focused. Verify the actual
  // browser state rather than treating bringToFront as proof of OS/tab blur.
  await assertActualFocus();
  if (await youtube.evaluate(() => document.hasFocus() && !document.hidden)) {
    test.info().annotations.push({
      type: 'focus-boundary',
      description:
        'Headless Chromium kept this document focused after bringToFront; unfocused/hidden behavior is covered by the deterministic lifecycle test.',
    });
  }
  const previousPane = await root.getAttribute('data-ww-active-pane');
  await youtube.evaluate(() => {
    document.querySelector('#movie_player')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('focus'));
  });
  await assertActualFocus();
  expect(await root.getAttribute('data-ww-active-pane')).toBe(previousPane);
  await youtube.bringToFront();
  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(root).toHaveAttribute('data-ww-fullscreen', '');
  await expect(youtube.locator('#web-world-themes-statusbar')).not.toBeVisible();
  await expect(detail).not.toBeVisible();
  await expect(youtube.locator('body')).toHaveCSS('padding-bottom', '0px');
  await youtube.evaluate(() => document.exitFullscreen());
  await setFeature(popup, 'focus-titlebars', false);
  await expect(root).not.toHaveAttribute('data-ww-document-active', '');
  await expect(root).not.toHaveAttribute('data-ww-active-pane', /.+/);
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
  await expect(detail).toHaveCount(0);
  await expect(youtube.locator('#web-world-themes-window-chrome')).toHaveCount(0);
});
