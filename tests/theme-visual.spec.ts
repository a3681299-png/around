import { test, expect } from './fixtures';

test('capture the silver software shell on home, watch, playlist, narrow, and fullscreen fixtures', async ({
  popup,
  youtube,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  youtube.on('pageerror', (error) => errors.push(error.message));
  await youtube.setViewportSize({ width: 1360, height: 920 });
  const capture = async (name: string, fullPage = true) => {
    await youtube.evaluate(async () => {
      await document.fonts.ready;
    });
    await youtube.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage, animations: 'disabled' });
    await testInfo.attach(name, { path: testInfo.outputPath(`${name}.png`), contentType: 'image/png' });
  };
  const capturePart = async (name: string, selector: string) => {
    await youtube.locator(selector).screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
    await testInfo.attach(name, { path: testInfo.outputPath(`${name}.png`), contentType: 'image/png' });
  };
  const assertNoOverflow = async () => {
    expect(await youtube.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  await capture('fixture-native-home');
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await expect(youtube.locator('#web-world-themes-clock')).toBeVisible();
  await capture('fixture-silver-60-home');
  await popup.getByRole('slider', { name: 'エフェクトの強さ' }).press('End');
  await expect(youtube.locator('html')).toHaveAttribute('style', /--ww-strength: 1;/);
  await capture('fixture-silver-100-home');
  const header = await youtube.locator('ytd-masthead').boundingBox();
  const guide = await youtube.locator('ytd-guide-renderer').boundingBox();
  const page = await youtube.locator('ytd-page-manager').boundingBox();
  expect(page!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(guide!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await assertNoOverflow();
  await youtube.locator('html').evaluate((element) => element.setAttribute('dark', ''));
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-mode', 'dark');
  await capture('fixture-native-dark-silver-100-home');
  await youtube.getByRole('button', { name: 'SPA navigation' }).click();
  await expect(youtube.getByRole('heading', { name: 'Watch', exact: true })).toBeVisible();
  await expect(youtube.locator('#web-world-themes-player-titlebar')).toContainText('A quiet afternoon by the sea');
  await expect(youtube.locator('#web-world-themes-playlist-titlebar')).toBeVisible();
  await capture('fixture-native-dark-silver-100-watch');
  await capturePart('fixture-player-window-detail', '#player-mount');
  await capturePart('fixture-playlist-window-detail', 'ytd-playlist-panel-renderer');
  // Clock detail is sampled only in a naturally unobstructed viewport; ordinary
  // watch captures above retain the real footer-yielding behavior.
  const originalViewport = youtube.viewportSize()!;
  if (!(await youtube.locator('#web-world-themes-statusbar').isVisible())) {
    await youtube.setViewportSize({ width: originalViewport.width, height: 2400 });
    await youtube.evaluate(() => scrollTo(0, 0));
  }
  await expect(youtube.locator('#web-world-themes-statusbar')).toBeVisible();
  await capturePart('fixture-statusbar-clock-detail', '#web-world-themes-statusbar');
  await youtube.setViewportSize(originalViewport);
  await youtube.locator('html').evaluate((element) => element.removeAttribute('dark'));
  await capture('fixture-silver-100-watch');
  await assertNoOverflow();

  await youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
  await expect(youtube.getByRole('dialog', { name: 'Web World Themes の設定' })).toBeVisible();
  await capture('fixture-player-settings');
  await youtube.getByRole('button', { name: '設定を閉じる', exact: true }).click();
  await popup.setViewportSize({ width: 380, height: 620 });
  await popup.screenshot({
    path: testInfo.outputPath('fixture-popup-settings.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await testInfo.attach('fixture-popup-settings', {
    path: testInfo.outputPath('fixture-popup-settings.png'),
    contentType: 'image/png',
  });

  await youtube.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => youtube.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  for (const selector of [
    '#web-world-themes-window-chrome',
    '#web-world-themes-player-titlebar',
    '#web-world-themes-playlist-titlebar',
    '#web-world-themes-statusbar',
  ]) {
    await expect(youtube.locator(selector)).not.toBeVisible();
  }
  await capture('fixture-fullscreen-player', false);
  await youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
  await expect(youtube.getByRole('dialog', { name: 'Web World Themes の設定' })).toBeVisible();
  await capture('fixture-fullscreen-settings', false);
  await youtube.getByRole('button', { name: '設定を閉じる', exact: true }).click();
  await youtube.evaluate(() => document.exitFullscreen());
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-fullscreen', '');
  await expect(youtube.locator('#web-world-themes-statusbar')).toHaveCount(1);
  // A restored footer may still yield to native controls at this scroll position.
  await expect
    .poll(() =>
      youtube.locator('#web-world-themes-statusbar').evaluate((element) => {
        if (getComputedStyle(element).visibility === 'hidden') return true;
        const bar = element.getBoundingClientRect();
        return [...document.querySelectorAll('#movie_player, button, input, a[href]')]
          .filter((node) => !node.closest('#web-world-themes-window-chrome'))
          .every((node) => {
            const rect = node.getBoundingClientRect();
            return !rect.width || !rect.height || rect.bottom <= bar.top || rect.top >= bar.bottom;
          });
      }),
    )
    .toBe(true);

  await youtube.setViewportSize({ width: 900, height: 760 });
  await capture('fixture-silver-100-900px-watch-playlist');
  await assertNoOverflow();
  await popup.getByRole('switch', { name: '窓の飾り', exact: true }).uncheck();
  for (const id of ['window-chrome', 'player-titlebar', 'playlist-titlebar', 'statusbar', 'clock']) {
    await expect(youtube.locator(`#web-world-themes-${id}`)).toHaveCount(0);
  }
  await capture('fixture-silver-chrome-disabled');
  await popup.getByRole('switch', { name: '窓の飾り', exact: true }).check();
  await youtube.goto('https://www.youtube.com/');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
  await capture('fixture-silver-100-900px-home');
  await assertNoOverflow();
  expect(errors).toEqual([]);
});
