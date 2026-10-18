import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';

test('optional real YouTube: saved group, mask, anchors, signals, theater, fullscreen and SPA', async ({}, info) => {
  test.skip(process.env.WW_LIVE_MEDIA !== '1', 'Explicit signed-out real YouTube regression.'); test.setTimeout(120_000);
  await mkdir('.work/verification', { recursive: true });
  await writeFile('.work/verification/media2-live-attempt.json', JSON.stringify({ startedAt: new Date().toISOString(), status: 'starting' }));
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-real2-')), false);
  context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(30_000);
  const checks: { name: string; status: string; detail?: string }[] = [];
  const check = async (name: string, action: () => Promise<void>) => {
    try { await action(); checks.push({ name, status: 'passed' }); }
    catch (error) { checks.push({ name, status: 'unconfirmed', detail: String(error).split('\n')[0] ?? '' }); }
  };
  try {
    const manager = await context.newPage(); await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' }); await item.waitFor();
    const id = await item.evaluate((element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/index.html`); await manager.close();
    const page = await context.newPage(); await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('#movie_player video').first()).toBeAttached({ timeout: 20_000 });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check(); await page.bringToFront();
    await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible();
    await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
    const panel = page.getByRole('dialog', { name: 'デザインエディター' }); await expect(panel).toBeVisible();
    await panel.getByLabel('アニメーション素材を追加').setInputFiles(['petal.gif', 'petal.apng', 'alpha1080.webm'].map((name) => path.resolve(`tests/fixtures/motion/${name}`)));
    const overlay = '#web-world-themes-decorations', media = page.locator(`${overlay} .media`);
    await expect(media).toHaveCount(3);
    await expect(panel.getByRole('button', { name: 'アニメーションを追加', exact: true })).toBeEnabled();
    for (let i = 0; i < 3; i++) {
      await panel.locator('[data-kind="animation"] [data-action="select"]').nth(i).click();
      await panel.getByLabel('配置の基準').selectOption('video-player');
      await panel.getByLabel('画像のX位置', { exact: true }).fill(String(35 + i * 15));
    }
    for (let i = 0; i < 3; i++) await panel.locator('[data-kind="animation"] [data-action="select"]').nth(i).click(i ? { modifiers: ['Control'] } : {});
    await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
    await panel.getByLabel('円形マスクを使う').check(); await panel.getByLabel('動画の一時停止で隠す').check(); await panel.getByLabel('マスクのフェード時間').fill('120');
    await panel.getByRole('button', { name: '保存', exact: true }).click(); await expect(panel.locator('.status')).toHaveText('保存しました。');
    await panel.getByRole('button', { name: '編集を終了' }).click();
    checks.push({ name: 'real document, editor, player anchors, saved GIF/APNG/WebM group', status: 'passed' });
    const content = page.locator(`${overlay} .group-content`);
    await check('native video play/pause controls fade a group mask', async () => {
      const button = page.locator('#movie_player .ytp-play-button');
      if (await page.locator('#movie_player video').first().evaluate((video: HTMLVideoElement) => video.paused)) await button.click({ timeout: 5000 });
      await expect(content).toHaveAttribute('data-mask-intensity', '1', { timeout: 10_000 });
      await button.click(); await expect(content).toHaveAttribute('data-mask-intensity', '0');
    });
    await check('pointer follows the native player group', async () => {
      await page.locator('#movie_player .ytp-play-button').click({ timeout: 5000 });
      await expect(content).toHaveAttribute('data-mask-intensity', '1');
      await page.mouse.move(250, 320); const before = await content.evaluate((element: HTMLElement) => element.style.maskImage);
      await page.mouse.move(400, 350); await expect.poll(() => content.evaluate((element: HTMLElement) => element.style.maskImage)).not.toBe(before);
    });
    await check('GIF/APNG and alpha WebM play on the real document after mask resume', async () => {
      await expect(page.locator(`${overlay} .media :is(img, canvas)`)).toHaveCount(2);
      for (const format of ['gif', 'apng']) {
        const raster = page.locator(`${overlay} .media[data-format="${format}"]`), frame = await raster.getAttribute('data-frame');
        await expect.poll(() => raster.getAttribute('data-frame')).not.toBe(frame);
      }
      const video = page.locator(`${overlay} .media video`); await expect(video).toHaveJSProperty('videoWidth', 1920); await expect(video).toHaveJSProperty('paused', false);
      const time = await video.evaluate((n: HTMLVideoElement) => n.currentTime); await expect.poll(() => video.evaluate((n: HTMLVideoElement) => n.currentTime)).not.toBe(time);
    });
    await check('scroll updates player anchors', async () => {
      const before = await page.locator(`${overlay} [data-image-id]`).first().boundingBox();
      await page.evaluate(() => scrollTo(0, 200)); await page.waitForTimeout(250);
      await expect.poll(async () => (await page.locator(`${overlay} [data-image-id]`).first().boundingBox())?.y).not.toBe(before?.y);
      await page.evaluate(() => scrollTo(0, 0));
    });
    await check('native theater mode', async () => {
      await page.locator('#movie_player .ytp-size-button').click({ timeout: 5000 });
      await expect(page.locator('ytd-watch-flexy')).toHaveAttribute('theater', ''); await expect(media).toHaveCount(3);
    });
    await check('native fullscreen relocates the overlay and restores it', async () => {
      await page.locator('#movie_player .ytp-fullscreen-button').click({ timeout: 5000 });
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement?.querySelector('#web-world-themes-decorations')))).toBe(true);
      await page.locator('#movie_player .ytp-fullscreen-button').click({ timeout: 5000 }); await expect.poll(() => page.evaluate(() => !document.fullscreenElement)).toBe(true);
    });
    if (await page.evaluate(() => Boolean(document.fullscreenElement))) await page.evaluate(() => document.exitFullscreen());
    await check('native Home/back SPA retains the group and rebinds player anchors', async () => {
      const origin = await page.evaluate(() => performance.timeOrigin), url = page.url();
      await page.locator('ytd-masthead a#logo').click({ timeout: 5000 });
      await expect.poll(() => page.url(), { timeout: 15_000 }).not.toBe(url);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin); await expect(media).toHaveCount(3);
      await page.goBack();
      await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible();
    });
    await check('reload restores the saved animation group', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' }); await expect(media).toHaveCount(3);
      await expect(page.locator('[data-ww-surface~="player-window"]')).toBeVisible();
      if (await page.locator('#movie_player video').first().evaluate((n: HTMLVideoElement) => n.paused)) await page.locator('#movie_player .ytp-play-button').click({ timeout: 5000 });
      await expect(content).toHaveAttribute('data-mask-intensity', '1', { timeout: 10_000 });
      await expect(page.locator(`${overlay} .media video`)).toHaveJSProperty('paused', false);
    });
    await check('OFF removes artwork and editing handles', async () => {
      await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck(); await expect(page.locator(overlay)).toHaveCount(0);
    });
    await mkdir('.work/verification', { recursive: true }); await writeFile('.work/verification/media2-live.json', JSON.stringify({ fixture: false, checks }, null, 2));
    await info.attach('real-youtube-checks', { body: JSON.stringify(checks, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('real-youtube-after-off.png') });
  } finally { await context.close(); }
});
