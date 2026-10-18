import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';

test('layout feasibility on real signed-out YouTube, preserving native media and DOM parents', async () => {
  test.skip(process.env.WW_LAYOUT_PILOT !== '1', 'Explicit live layout pilot.'); test.setTimeout(90_000);
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-layout-')), false);
  const results: unknown[] = [];
  try {
    const manager = await context.newPage(); await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' }); await item.waitFor();
    const id = await item.evaluate((element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id); await manager.close();
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage(); await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded' }); await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 20_000 });
    await page.bringToFront(); const opened = context.waitForEvent('page'); await popup.locator('#creator-studio-open').evaluate((button: HTMLButtonElement) => button.click());
    const oldStudio = await opened; await oldStudio.setViewportSize({ width: 1366, height: 900 }); await expect(oldStudio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    await oldStudio.screenshot({ path: '.work/verification/studio-before-1366.png' }); await oldStudio.close();
    await page.bringToFront();
    const before = await page.locator('#movie_player').boundingBox();
    const player = await page.locator('#movie_player').elementHandle(), parent = await page.locator('#movie_player').evaluate((node) => node.parentElement?.id);
    const css = await readFile('src/sites/youtube-studio.css', 'utf8');
    await page.evaluate((css) => {
      const root = document.documentElement; root.dataset.wwInpageStudio = ''; root.dataset.wwStudioLayout = 'reserved'; root.dataset.wwStudioCompact = '';
      for (const [name, value] of Object.entries({ left: 160, right: 300, top: 56, bottom: 24 })) root.style.setProperty(`--ww-studio-${name}`, `${value}px`);
      const style = document.createElement('style'); style.id = 'ww-layout-pilot'; style.textContent = css; document.head.append(style);
    }, css);
    await expect.poll(async () => (await page.locator('ytd-app').boundingBox())!.width).toBeLessThan(920);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    for (const width of [1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((width) => { document.documentElement.toggleAttribute('data-ww-studio-compact', width < 1500); }, width);
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => { const node = document.querySelector(selector), r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined; };
        return { width: innerWidth, app: box('ytd-app'), masthead: box('#masthead-container'), player: box('#movie_player'), video: box('#movie_player video'), primary: box('#primary'), columns: box('#columns'), guide: box('#guide'), scrollWidth: document.documentElement.scrollWidth };
      });
      results.push(metrics); await page.screenshot({ path: `.work/verification/studio-layout-pilot-${width}.png` });
      expect(metrics.app!.x).toBeCloseTo(160); expect(metrics.player!.x).toBeGreaterThanOrEqual(160);
      expect(metrics.player!.x + metrics.player!.width).toBeLessThanOrEqual(width - 295);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width + 2);
      expect(metrics.video!.width).toBeCloseTo(metrics.player!.width, 0); expect(metrics.video!.height).toBeCloseTo(metrics.player!.height, 0);
      expect(await player!.evaluate((node) => node === document.querySelector('#movie_player') && node.parentElement?.id)).toBe(parent);
    }
    await page.evaluate(() => { document.querySelector('#ww-layout-pilot')!.remove(); const root = document.documentElement; for (const key of ['data-ww-inpage-studio', 'data-ww-studio-layout', 'data-ww-studio-compact']) root.removeAttribute(key); for (const name of ['left', 'right', 'top', 'bottom']) root.style.removeProperty(`--ww-studio-${name}`); });
    await page.setViewportSize({ width: 1366, height: 900 }); await expect.poll(async () => (await page.locator('#movie_player').boundingBox())!.width).toBeCloseTo(before!.width, 0);
  } finally { await writeFile('.work/verification/studio-layout-pilot.json', JSON.stringify(results, null, 2)); await context.close(); }
});
