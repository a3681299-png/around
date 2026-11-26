import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openEditor } from './helpers/editor';
import { beginCanvasGesture, visiblePart } from './helpers/editor-workspace';
import { errorSummary, waitForAdvertToEnd } from './helpers/youtube-live';

test('optional signed-out YouTube: save and reopen Studio three times', async ({}, info) => {
  test.skip(process.env.AROUND_LIVE_STUDIO_RECOVERY !== '1', 'Explicit real YouTube Studio recovery validation.');
  test.setTimeout(120_000);
  const profileRoot = process.env.AROUND_TEST_PROFILE_ROOT ?? tmpdir();
  const context = await launchExtension(await mkdtemp(path.join(profileRoot, 'around-recovery-')), false, {
    headed: true,
    width: 1440,
    height: 950,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
    const page = await context.newPage();
    await page.goto(process.env.AROUND_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls', {
      waitUntil: 'domcontentloaded',
    });
    await showArtwork(popup);
    await expect(page.locator('[data-around-surface~="player-window"]')).toBeVisible({ timeout: 20_000 });
    let editor = await openEditor(popup, page);
    await editor.panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    for (const round of [1, 2, 3]) {
      const name = `保存した花 ${round}`;
      const input = editor.panel.getByLabel('レイヤー名', { exact: true });
      await input.fill(name);
      await input.press('Tab');
      await editor.panel.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor.panel.locator('.status')).toHaveText('保存しました。');
      await editor.studio.close();
      // The second round keeps the original page alive. The first and third
      // exercise recovery after its editing session is gone.
      if (round !== 2) await page.reload({ waitUntil: 'domcontentloaded' });
      editor = await openEditor(popup, page);
      const layer = editor.panel.getByRole('button', { name, exact: true });
      await expect(layer).toBeVisible();
      await expect(editor.panel.locator('.dirty')).toHaveText('保存済み');
      await expect(editor.studio.getByRole('region', { name: '作業中のコピーの復旧' })).toBeHidden();
      await layer.click();
    }
    await editor.studio.screenshot({ path: info.outputPath('studio-reopened.png') });
    await page.screenshot({ path: info.outputPath('youtube-reopened.png') });
  } finally {
    await context.close();
  }
});

test('optional signed-out YouTube: mouse-only grouping, mask, save, restore and cleanup', async () => {
  test.skip(process.env.AROUND_LIVE_EDITOR_UX !== '1', 'Explicit real YouTube UI validation.');
  test.setTimeout(120_000);
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-ux-live-')), false);
  context.setDefaultTimeout(8000);
  context.setDefaultNavigationTimeout(30_000);
  const results: { name: string; status: string; detail?: string }[] = [];
  const check = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      results.push({ name, status: 'passed' });
    } catch (error) {
      results.push({ name, status: 'unconfirmed', detail: errorSummary(error) });
    }
  };
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate(
      (element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id,
    );
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await manager.close();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded' });
    await showArtwork(popup);
    await page.bringToFront();
    await expect(page.locator('[data-around-surface~="player-window"]')).toBeVisible({ timeout: 20_000 });
    // UI0-d 3.1: the editor's window (as a tab); the artwork and its checks stay on the YouTube page.
    let { panel } = await openEditor(popup, page);
    const overlay = '#around-decorations';
    const presentation =
      ':is(#around-decorations, #around-video-decorations, #around-page-decorations, #around-atmosphere-decorations)';
    await check('mouse-only import, selection, grouping and drag', async () => {
      await panel
        .getByLabel('画像素材を追加')
        .setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
      await expect(page.locator(`${presentation} [data-image-id]`)).toHaveCount(3);
      await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
      await panel.getByRole('button', { name: '選択解除', exact: true }).click();
      for (const checkbox of await panel.locator('[data-multiselect]').all()) await checkbox.check();
      await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
      await expect(panel.locator('.layers .thumbnail img')).toHaveCount(3);
      await panel.page().screenshot({ path: '.work/verification/editor-ux-live-layers.png' });
      await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
      await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
      const image = page.locator(`${presentation} [data-image-id]`).first(),
        before = (await image.boundingBox())!;
      // Grouping briefly holds drawing; start only once the artwork is the real hit target.
      const start = await visiblePart(image);
      await beginCanvasGesture(image, start);
      await page.mouse.move(start.x - 30, start.y + 20, { steps: 8 });
      await page.mouse.up();
      expect((await image.boundingBox())!.x).toBeCloseTo(before.x - 30, 1);
    });
    await check('group mask and pointer tracking', async () => {
      await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
      await panel.getByLabel('円形マスクを使う', { exact: true }).check();
      await panel.getByLabel('光の半径', { exact: true }).fill('180');
      await page.mouse.move(430, 350);
      await expect(page.locator(`${presentation} .group-content`)).not.toHaveCSS('mask-image', 'none');
      await expect
        .poll(() =>
          page.locator(`${presentation} .group-content`).evaluate((element: HTMLElement) => {
            const match = element.style.maskImage.match(/at ([\d.e+-]+)px ([\d.e+-]+)px/)!,
              rect = element.getBoundingClientRect();
            return Math.abs(rect.x + Number(match[1]) - 430) + Math.abs(rect.y + Number(match[2]) - 350);
          }),
        )
        .toBeLessThan(0.04);
      await page.screenshot({ path: '.work/verification/editor-ux-live-properties.png' });
    });
    await check('pause signal, save and page reload', async () => {
      await panel.getByLabel('動画の一時停止で隠す', { exact: true }).check();
      await page
        .locator('#movie_player video')
        .first()
        .evaluate((video: HTMLVideoElement) => video.pause());
      await expect(page.locator(`${presentation} .group-content`)).toHaveAttribute('data-mask-intensity', '0');
      await panel.getByRole('button', { name: '保存', exact: true }).click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`${presentation} [data-image-id]`)).toHaveCount(3, { timeout: 20_000 });
      ({ panel } = await openEditor(popup, page));
      await panel.locator('[data-kind="group"] [data-action="select"]').click();
      await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
      await expect(panel.getByLabel('光の半径', { exact: true })).toHaveValue('180');
    });
    await check('ordinary mode click-through and OFF removal', async () => {
      await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
      expect(await page.locator(overlay).evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
      await waitForAdvertToEnd(page);
      const video = page.locator('#movie_player video').first(),
        paused = await video.evaluate((node: HTMLVideoElement) => node.paused);
      await page.locator('#movie_player .ytp-play-button').click();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).not.toBe(paused);
      await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
      await expect(page.locator(presentation)).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
    });
  } catch (error) {
    results.push({
      name: 'real site startup',
      status: 'unconfirmed',
      detail: errorSummary(error),
    });
  } finally {
    await writeFile(
      '.work/verification/editor-ux-live.json',
      JSON.stringify({ at: new Date().toISOString(), checks: results }, null, 2),
    );
    await context.close();
  }
  expect(results.filter((result) => result.status === 'unconfirmed')).toEqual([]);
});
