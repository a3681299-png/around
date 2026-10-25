import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { beginCanvasGesture, visiblePart } from './helpers/editor-workspace';
import { errorSummary, waitForAdvertToEnd } from './helpers/youtube-live';

test('optional real signed-out YouTube: independent Studio creation, bidirectional editing, recovery and cleanup', async () => {
  test.skip(process.env.WW_LIVE_STUDIO !== '1', 'Explicit real-site validation; fixture tests run separately.');
  test.setTimeout(150_000);
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-st-live-')), false);
  context.setDefaultTimeout(8000);
  context.setDefaultNavigationTimeout(30_000);
  let diagnostics: (() => Promise<string>) | undefined;
  const checks: { name: string; status: string; detail?: string }[] = [];
  const check = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      checks.push({ name, status: 'passed' });
    } catch (error) {
      checks.push({
        name,
        status: 'unconfirmed',
        detail: errorSummary(error) + (diagnostics ? await diagnostics() : ''),
      });
    }
  };
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate(
      (element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id,
    );
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await manager.close();
    const youtube = await context.newPage();
    await youtube.setViewportSize({ width: 1280, height: 900 });
    await youtube.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded' });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(youtube.locator('[data-ww-surface~="player-window"]')).toBeVisible({ timeout: 20_000 });
    await youtube.bringToFront();
    const opened = context.waitForEvent('page');
    await popup.locator('#creator-studio-open').evaluate((button: HTMLButtonElement) => button.click());
    const studio = await opened;
    await studio.setViewportSize({ width: 1440, height: 900 });
    await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    diagnostics = async () =>
      ' · ' +
      (await studio.locator('.connection-status').textContent()) +
      ' · ' +
      (await studio.locator('.recovery-status').textContent());
    const panel = studio.getByRole('dialog', { name: 'デザインエディター' }),
      overlay = '#web-world-themes-decorations',
      presentation =
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      images = `${presentation} [data-image-id]`;
    await check('standalone launch, image import and mouse-only grouping', async () => {
      await panel
        .getByLabel('画像素材を追加')
        .setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
      await expect(youtube.locator(images)).toHaveCount(3);
      await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
      await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
      await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
      await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
      await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
    });
    await check('YouTube direct movement synchronizes to Studio and shares Undo', async () => {
      await youtube.bringToFront();
      const first = youtube.locator(images).first(),
        before = (await first.boundingBox())!;
      // Start only once the artwork is the real hit target (protection may hold it briefly).
      const start = await visiblePart(first);
      await beginCanvasGesture(first, start);
      await youtube.mouse.move(start.x - 30, start.y + 20, { steps: 8 });
      await youtube.mouse.up();
      await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 1);
      await expect(panel.getByLabel('グループのX位置', { exact: true })).not.toHaveValue('0');
      await panel.getByRole('button', { name: '元に戻す', exact: true }).click();
      await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x, 1);
      await panel.getByRole('button', { name: 'やり直す', exact: true }).click();
      await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 1);
    });
    await check('shared group mask, pointer and video state', async () => {
      await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
      await panel.getByLabel('円形マスクを使う', { exact: true }).check();
      await panel.getByLabel('光の半径', { exact: true }).fill('180');
      await youtube.mouse.move(430, 350);
      await expect(youtube.locator(`${presentation} .group-content`)).toHaveCSS('mask-image', /radial-gradient/);
      await panel.getByLabel('動画の一時停止で隠す', { exact: true }).check();
      await youtube
        .locator('#movie_player video')
        .first()
        .evaluate((video: HTMLVideoElement) => video.pause());
      await expect(youtube.locator(`${presentation} .group-content`)).toHaveAttribute('data-mask-intensity', '0');
      await studio.screenshot({ path: '.work/verification/studio-live-workspace.png' });
      await youtube.screenshot({ path: '.work/verification/studio-live-youtube.png' });
    });
    await check('save, target reload and Studio reload reconnect', async () => {
      await panel.getByRole('button', { name: '保存', exact: true }).click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      await youtube.reload({ waitUntil: 'domcontentloaded' });
      await expect(youtube.locator(images)).toHaveCount(3, { timeout: 20_000 });
      await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 15_000 });
      await studio.reload();
      await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
      await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
      await expect(panel.getByLabel('光の半径', { exact: true })).toHaveValue('180');
    });
    await check('normal click-through after disconnect, player operation and SPA navigation', async () => {
      await studio.getByRole('button', { name: '接続を解除', exact: true }).click();
      await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
      expect(await youtube.locator(overlay).evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
      await waitForAdvertToEnd(youtube);
      const video = youtube.locator('#movie_player video').first(),
        paused = await video.evaluate((node: HTMLVideoElement) => node.paused);
      await youtube.locator('#movie_player .ytp-play-button').click();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).not.toBe(paused);
      await youtube.locator('a#logo').first().click();
      await expect(youtube).toHaveURL('https://www.youtube.com/');
      await studio.getByRole('button', { name: '接続 / 再開', exact: true }).click();
      await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
      await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
    });
    await check('theme OFF completely removes editing and decorations', async () => {
      await popup.getByRole('switch', { name: 'Theme ON / OFF' }).uncheck();
      await expect(youtube.locator(presentation)).toHaveCount(0);
      await expect(youtube.locator('[data-ww-editing]')).toHaveCount(0);
      await expect(youtube.locator('#web-world-themes-studio-link')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    });
  } catch (error) {
    checks.push({
      name: 'real site startup',
      status: 'unconfirmed',
      detail: errorSummary(error),
    });
  } finally {
    await writeFile(
      '.work/verification/studio-live.json',
      JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
    );
    await context.close();
  }
  expect(checks.filter((check) => check.status !== 'passed')).toEqual([]);
});
