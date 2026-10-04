import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';

for (const colorScheme of ['light', 'dark'] as const) {
test(`optional public YouTube ${colorScheme} watch inspection with unmodified network documents`, async ({}, testInfo) => {
  test.skip(process.env.WW_LIVE_YOUTUBE !== '1', 'Opt-in public-network smoke check; fixture checks remain deterministic.');
  test.setTimeout(120_000);
  await mkdir('.work', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/live-')), false);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme });
  const capture = async (name: string) => {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
  };
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate(element => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await manager.close();
    await page.setViewportSize({ width: 1360, height: 920 });
    // Public video from the reported screenshot. No cookies, account, CAPTCHA,
    // markup substitution, hidden API, or application-state injection is used.
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI&list=RDAS4q9yaWJkI&start_radio=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 45_000 });
    if (colorScheme === 'dark') {
      // YouTube may ignore the OS preference until Appearance is explicitly set.
      // Change only this disposable signed-out browser through the visible UI.
      await page.locator('ytd-masthead').getByRole('button', { name: /^(Settings|設定)$/ }).click();
      await page.getByRole('link', { name: /^(Appearance:|デザイン:)/ }).click();
      await page.getByRole('link', { name: /^(Dark theme|ダークモード)$/ }).click();
      await expect.poll(() => page.locator('html').evaluate(element => element.hasAttribute('dark'))).toBe(true);
    }
    // Appearance can reload the page; await the rebuilt native header/content.
    await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('ytd-masthead #logo-icon svg').first()).toBeVisible({ timeout: 30_000 });
    await capture('live-native-watch');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
    await expect(page.locator('#web-world-themes-player-titlebar')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.locator('#web-world-themes-player-titlebar').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && element.contains(hit));
    })).toBe(true);
    await expect(page.locator('ytd-masthead [id^="youtube-paths"]:visible').first()).toBeVisible();
    await capture('live-silver-watch');
    await page.locator('ytd-watch-metadata h1').first().scrollIntoViewIfNeeded();
    await capture('live-silver-metadata');
    const playerGeometry = await page.evaluate(() => {
      const selectors = ['#web-world-themes-player-titlebar', '#player', '#player-container-outer', '#player-container-inner', '#player-container', 'ytd-player', '#movie_player'];
      return selectors.map(selector => {
        const element = document.querySelector(selector); if (!element) return { selector, missing: true };
        const r = element.getBoundingClientRect(), s = getComputedStyle(element);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2));
        return { selector, parent: element.parentElement?.tagName + '#' + element.parentElement?.id,
          position: s.position, top: s.top, transform: s.transform, zIndex: s.zIndex,
          x: r.x, y: r.y, width: r.width, height: r.height, hit: hit?.tagName + '#' + hit?.id };
      });
    });
    await writeFile(testInfo.outputPath('live-player-geometry.json'), JSON.stringify(playerGeometry, null, 2));
    const backgrounds = await page.locator('ytd-watch-flexy, ytd-watch-metadata, ytd-comments').evaluateAll(elements => elements.map(element => ({
      tag: element.tagName, background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color,
    })));
    await writeFile(testInfo.outputPath('live-observations.json'), JSON.stringify({ url: page.url(), browserColorScheme: colorScheme, nativeDark: await page.locator('html').getAttribute('dark'), backgrounds }, null, 2));
    for (const surface of backgrounds) expect(surface.background).not.toBe('rgb(15, 15, 15)');
    const wordmark = page.locator('ytd-masthead [id^="youtube-paths"]').first();
    await expect(wordmark).toHaveAttribute('data-ww-surface', /wordmark/);
    await expect(wordmark).toHaveCSS('fill', 'rgb(37, 42, 52)');
    await page.evaluate(() => window.scrollTo(0, 454));
    await expect(page.locator('ytd-comments-header-renderer:visible').first()).toBeVisible({ timeout: 30_000 });
    await capture('live-silver-scroll-comments');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    await expect(page.locator('#web-world-themes-style')).toHaveCount(0);
    await expect(page.locator('[data-ww-surface]')).toHaveCount(0);
    await capture('live-restored-watch');
  } finally {
    await capture('live-last-state').catch(() => {});
    await context.close();
  }
});
}
