import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';

test('optional public YouTube watch inspection with unmodified network documents', async ({}, testInfo) => {
  test.skip(process.env.WW_LIVE_YOUTUBE !== '1', 'Opt-in public-network smoke check; fixture checks remain deterministic.');
  test.setTimeout(120_000);
  await mkdir('.work', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/live-')), false);
  const page = await context.newPage();
  const capture = async (name: string) => {
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
    await capture('live-native-watch');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
    await expect(page.locator('#web-world-themes-player-titlebar')).toBeVisible();
    await capture('live-silver-watch');
    await page.locator('ytd-watch-metadata h1').first().scrollIntoViewIfNeeded();
    await capture('live-silver-metadata');
    const backgrounds = await page.locator('ytd-watch-flexy, ytd-watch-metadata, ytd-comments').evaluateAll(elements => elements.map(element => ({
      tag: element.tagName, background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color,
    })));
    await testInfo.attach('live-observations', { body: JSON.stringify({ url: page.url(), nativeDark: await page.locator('html').getAttribute('dark'), backgrounds }, null, 2), contentType: 'application/json' });
    for (const surface of backgrounds) expect(surface.background).not.toBe('rgb(15, 15, 15)');
    const wordmark = page.locator('ytd-masthead [id^="youtube-paths"]').first();
    await expect(wordmark).toHaveAttribute('data-ww-surface', /wordmark/);
    await expect(wordmark).toHaveCSS('fill', 'rgb(37, 42, 52)');
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
    await expect(page.locator('#web-world-themes-style')).toHaveCount(0);
    await expect(page.locator('[data-ww-surface]')).toHaveCount(0);
    await capture('live-restored-watch');
  } finally {
    await capture('live-last-state').catch(() => {});
    await context.close();
  }
});
