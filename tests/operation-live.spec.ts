import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openEditor } from './helpers/editor';
import { exposeEditorControls } from './helpers/editor-workspace';
import { declinePromotion, waitForAdvertToEnd } from './helpers/youtube-live';

async function nativeInputs(page: Page) {
  const player = page.locator('#movie_player'),
    video = page.locator('video.html5-main-video');
  await expect(player).toBeVisible();
  await waitForAdvertToEnd(page);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => Number.isFinite(v.duration) && v.duration > 30), {
      timeout: 25_000,
    })
    .toBe(true);
  await player.hover();
  const bar = page.locator('.ytp-progress-bar-container');
  await expect(bar).toBeVisible();
  await (await bar.elementHandle())!.waitForElementState('stable');
  const seek = (await bar.boundingBox())!;
  await page.mouse.move(seek.x + seek.width * 0.2, seek.y + seek.height / 2);
  await page.mouse.down();
  await page.mouse.move(seek.x + seek.width * 0.35, seek.y + seek.height / 2, { steps: 8 });
  await page.mouse.up();
  console.log(
    'LIVE_SEEK_STATE ' +
      JSON.stringify(
        await video.evaluate((v: HTMLVideoElement) => ({
          currentTime: v.currentTime,
          duration: v.duration,
          readyState: v.readyState,
          error: v.error?.code,
          seekable: Array.from({ length: v.seekable.length }, (_, i) => [v.seekable.start(i), v.seekable.end(i)]),
        })),
      ),
  );
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeGreaterThan(0.3);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeLessThan(0.42);
  await page.locator('.ytp-mute-button').hover();
  const slider = page.locator('.ytp-volume-slider');
  await expect(slider).toBeVisible();
  // YouTube expands the volume panel on hover. Its visible, intermediate box
  // is not yet a usable coordinate for a raw native drag.
  await (await slider.elementHandle())!.waitForElementState('stable');
  await slider.evaluate((node) => {
    const records: unknown[] = [];
    const record = (event: MouseEvent) => {
      const rect = node.getBoundingClientRect();
      records.push({
        type: event.type,
        x: event.clientX,
        y: event.clientY,
        target: (event.target as Element)?.outerHTML.slice(0, 250),
        slider: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    };
    document.addEventListener('mousedown', record, true);
    document.addEventListener('mouseup', record, true);
    (window as unknown as { operationVolumeAudit: () => unknown[] }).operationVolumeAudit = () => {
      document.removeEventListener('mousedown', record, true);
      document.removeEventListener('mouseup', record, true);
      return records;
    };
  });
  const volume = (await slider.boundingBox())!;
  await page.mouse.move(volume.x + volume.width * 0.3, volume.y + volume.height / 2);
  await page.mouse.down();
  const quieter = await video.evaluate((v: HTMLVideoElement) => v.volume);
  await page.mouse.move(volume.x + volume.width * 0.65, volume.y + volume.height / 2, { steps: 6 });
  await page.mouse.up();
  console.log(
    'LIVE_VOLUME_INPUT ' +
      JSON.stringify({
        box: volume,
        quieter,
        events: await page.evaluate(() =>
          (window as unknown as { operationVolumeAudit: () => unknown[] }).operationVolumeAudit(),
        ),
      }),
  );
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBeGreaterThan(quieter);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBeLessThan(1);
  await player.focus();
  const paused = await video.evaluate((v: HTMLVideoElement) => v.paused);
  await page.keyboard.press('k');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(!paused);
  await page.locator('.ytp-fullscreen-button').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.locator('.ytp-fullscreen-button').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  const search = page.locator('yt-searchbox input, ytd-searchbox input').filter({ visible: true }).first();
  await search.fill('G1 input check');
  await expect(search).toHaveValue('G1 input check');
  await search.fill('');
  const comment = page.locator('ytd-comments [contenteditable="true"]').filter({ visible: true }).first();
  let commentResult = 'sign-in-gated; real text entry unavailable in this fresh signed-out profile';
  if (await comment.count()) {
    await comment.fill('G1 input check');
    await expect(comment).toHaveText('G1 input check');
    await comment.fill('');
    commentResult = 'text entered and cleared; never posted';
  }
  return {
    seekFraction: await video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration),
    volume: await video.evaluate((v: HTMLVideoElement) => v.volume),
    comment: commentResult,
  };
}

test('optional real YouTube operation checks with and without authored paint', async ({}, info) => {
  test.skip(
    process.env.WW_LIVE_OPERATIONS !== '1',
    'Explicit public-network operation verification; fixtures cover signed-in input behavior without posting.',
  );
  test.setTimeout(180_000);
  await mkdir('.work', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g1-live-')), false);
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    const url = process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
    await popup.getByRole('switch', { name: '作品を表示する' }).check();
    if (process.env.WW_LIVE_OPERATIONS_OFF === '1')
      await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await page.bringToFront();
    const before = await nativeInputs(page);
    await popup.getByRole('switch', { name: '作品を表示する' }).check();
    // UI0-d round 3: the editor window (as a tab); the operation checks stay on the YouTube page.
    const { panel: editor } = await openEditor(popup, page);
    await exposeEditorControls(editor);
    await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
    await editor.getByLabel('配置の基準').selectOption('video-player');
    await editor.getByLabel('画像のY位置', { exact: true }).fill('80');
    await editor.getByLabel('画像のY位置', { exact: true }).press('Tab');
    await editor.locator('.save').click();
    await expect(editor.locator('.dirty')).toHaveText('保存済み');
    await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
    // A fresh public document makes the two phases independent of buffering and
    // the video clock. The saved, fully validated artwork is actually restored.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('ytd-watch-metadata h1').first()).toBeVisible({ timeout: 30_000 });
    await waitForAdvertToEnd(page);
    let checkingArtwork = true;
    const dismissals = (async () => {
      while (checkingArtwork && !page.isClosed()) {
        // A promotion can appear during the original visibility assertion. Closing it is an
        // independent human action; keep Playwright's original auto-wait and verdict intact.
        await declinePromotion(page);
        if (checkingArtwork) await page.waitForTimeout(100);
      }
    })().catch(() => undefined); // A closed page must retain the visibility assertion's error.
    try {
      await expect(page.locator('[data-image-id]'))
        .toBeVisible()
        .catch(async (error: Error) => {
          // Keep why protection hides the restored artwork on the live page.
          const state = await page.evaluate(() => ({
            safety: document.querySelector('#web-world-themes-decorations')?.getAttribute('data-ww-safety'),
            planes: [...document.querySelectorAll('[id^="web-world-themes-"][id$="decorations"]')].map((h) => h.id),
            video: (() => {
              const v = document.querySelector<HTMLVideoElement>('video.html5-main-video');
              return v && { paused: v.paused, readyState: v.readyState, currentTime: v.currentTime };
            })(),
            centralButtons: [...document.querySelectorAll('#movie_player button')]
              .filter((b) => b.getBoundingClientRect().height > 0)
              .map((b) => String(b.className).slice(0, 40)),
          }));
          throw new Error(`${error.message}${String.fromCharCode(10)}Restored artwork state: ${JSON.stringify(state)}`);
        });
    } finally {
      checkingArtwork = false;
      await dismissals;
    }
    const after = await nativeInputs(page);
    expect(Math.abs(after.volume - before.volume)).toBeLessThan(0.02);
    expect(after.comment).toBe(before.comment);
    await page.screenshot({ path: info.outputPath('youtube-operations-protected.png') });
    await info.attach('real-operation-results.json', {
      body: JSON.stringify({ url, before, after }, null, 2),
      contentType: 'application/json',
    });
    console.log('LIVE_OPERATION_RESULTS ' + JSON.stringify({ before, after }));
  } finally {
    await context.close();
  }
});
