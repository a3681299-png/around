import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openRetiredEditor } from './helpers/editor';
import { clearestPoint, declinePromotion, errorSummary, waitForAdvertToEnd } from './helpers/youtube-live';
import { plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { exposeEditorControls } from './helpers/editor-workspace';

/*
 * UI0-c evidence: the editor's marks on the real page (skin hover, 未対応, the selected kind, the
 * selected video card, layer selection, group, lock, snap guides and protection), on a light and a
 * dark YouTube and over a bright and a dark video frame. The same spec runs against the build
 * before the change (WW_TEST_EXTENSION_PATH) and after it; WW_LIVE_PAGE_MARKS_PREFIX names the set.
 */
const prefix = process.env.WW_LIVE_PAGE_MARKS_PREFIX ?? 'after';
const shots = path.resolve(process.env.WW_LIVE_PAGE_MARKS_SHOTS ?? 'docs/screenshots/ui0c');
const dialogName = 'デザインエディター';
// Two frames of public videos: a bright outdoor scene and a dark one, paused at a fixed time.
// The first search result for each query; the record keeps the URL and the measured luminance.
const videos = [
  { name: 'bright', url: process.env.WW_LIVE_BRIGHT_URL, query: 'snow skiing powder day 4k', at: 30 },
  { name: 'dark', url: process.env.WW_LIVE_DARK_URL, query: 'night sky stars timelapse 4k', at: 30 },
];
async function resolveVideo(page: Page, video: (typeof videos)[number]) {
  if (video.url) return video.url;
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(video.query)}`, {
    waitUntil: 'domcontentloaded',
  });
  const link = page.locator('ytd-video-renderer a#thumbnail[href^="/watch?v="]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  return new URL((await link.getAttribute('href'))!.split('&')[0]!, 'https://www.youtube.com').href;
}

async function clip(page: Page, name: string, box: { x: number; y: number; width: number; height: number }) {
  const viewport = page.viewportSize()!;
  const margin = 48,
    x = Math.max(0, Math.floor(box.x - margin)),
    y = Math.max(0, Math.floor(box.y - margin));
  await page.screenshot({
    path: path.join(shots, `${prefix}-${name}.png`),
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, Math.ceil(box.width + margin * 2)),
      height: Math.min(viewport.height - y, Math.ceil(box.height + margin * 2)),
    },
  });
}
async function openEditor(page: Page, popup: Page) {
  await page.bringToFront();
  // UI0-d: the UI0-c evidence was taken with the floating editor; opened through its retained message.
  await openRetiredEditor(popup, page);
  const editor = page.getByRole('dialog', { name: dialogName });
  await expect(editor).toBeVisible();
  return editor;
}
async function closeEditor(editor: Locator) {
  if (!(await editor.isVisible())) return;
  await editor.getByRole('button', { name: /編集を終了/ }).click();
  const discard = editor.page().getByRole('button', { name: /破棄|保存しない/ });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await expect(editor).toBeHidden();
}
async function moveAway(page: Page) {
  const viewport = page.viewportSize()!;
  const point = await clearestPoint(page, { left: 0, top: 0, right: viewport.width, bottom: viewport.height }, 0);
  await page.mouse.move(point.x, point.y);
}
/** Mean luminance of the paused video frame, so the record says which background each shot had. */
async function frameLuminance(page: Page) {
  // The middle half of the frame: letterbox bars would make every frame read darker.
  const video = (await page.locator('video.html5-main-video').first().boundingBox())!;
  const box = {
    x: video.x + video.width / 4,
    y: video.y + video.height / 4,
    width: video.width / 2,
    height: video.height / 2,
  };
  const png = await page.screenshot({ clip: box });
  return page.evaluate(
    async (data) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(64, 36),
        context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0, 64, 36);
      const pixels = context.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4)
        sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      return Math.round(sum / (pixels.length / 4));
    },
    [...png],
  );
}

for (const scheme of ['light', 'dark'] as const)
  test(`optional real YouTube UI0-c: page marks on a ${scheme} YouTube`, async ({}, info) => {
    test.skip(process.env.WW_LIVE_PAGE_MARKS !== '1', 'Explicit signed-out real YouTube UI0-c evidence.');
    test.setTimeout(600_000);
    await mkdir(shots, { recursive: true });
    await mkdir('.work', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.resolve('.work/ui0c-live-')), false);
    // One stuck step is recorded and the rest still run.
    context.setDefaultTimeout(20_000);
    const record: Record<string, unknown> = { scheme, prefix };
    const step = async (name: string, run: () => Promise<void>) => {
      try {
        await run();
        record[name] = 'ok';
      } catch (error) {
        record[name] = errorSummary(error);
      }
    };
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const extensionId = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
      await storeDesign(popup, plainSkinDesign);
      // Signed-out YouTube keeps its own theme in PREF (f6=400 is dark); the editor follows the system.
      if (scheme === 'dark')
        await context.addCookies([
          { name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/', secure: true, sameSite: 'None' },
        ]);
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Results page: the skin tool's marks and a selected video card.
      await page.goto('https://www.youtube.com/results?search_query=lofi+hip+hop', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
      const cards = page.locator('[data-ww-surface~="video-card"]');
      await expect(cards.first()).toBeVisible({ timeout: 30_000 });
      await declinePromotion(page);
      let editor = await openEditor(page, popup);
      await step(`${scheme}-skin`, async () => {
        await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
        const card = cards.nth(1);
        await card.scrollIntoViewIfNeeded();
        await card.hover({ position: { x: 20, y: 20 } });
        const hover = page.locator('#web-world-themes-skin-hover');
        await expect(hover).toContainText('動画カード');
        await page.waitForTimeout(600);
        await clip(page, `${scheme}-skin-hover`, (await card.boundingBox())!);
        // On the frame's stroke and under its tag, the real card is still what the pointer hits.
        record[`${scheme}-hover-hits-card`] = await card.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return [
            // The text side: YouTube's own hover preview video covers the thumbnail.
            [rect.right - 1, rect.top + rect.height / 2],
            [rect.left + rect.width * 0.7, rect.top + 1],
            [rect.left + rect.width * 0.7, rect.bottom - 2],
          ].map(([x, y]) => {
            const hit = document.elementFromPoint(x!, y!);
            return node.contains(hit) || `${hit?.tagName}#${hit?.id}`;
          });
        });
        const control = page.locator('#guide-button button, yt-icon-button#guide-button').first();
        await control.hover();
        await expect(hover).toContainText('未対応');
        await page.waitForTimeout(600);
        await clip(page, `${scheme}-skin-unsupported`, (await control.boundingBox())!);
        await card.click({ position: { x: 20, y: 20 } });
        await expect(page.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
        await moveAway(page);
        await page.waitForTimeout(600);
        const first = (await cards.nth(1).boundingBox())!,
          next = (await cards.nth(2).boundingBox())!;
        await clip(page, `${scheme}-skin-siblings`, {
          x: Math.min(first.x, next.x),
          y: Math.min(first.y, next.y),
          width: Math.max(first.x + first.width, next.x + next.width) - Math.min(first.x, next.x),
          height: Math.max(first.y + first.height, next.y + next.height) - Math.min(first.y, next.y),
        });
      });
      await closeEditor(editor);
      editor = await openEditor(page, popup);
      await step(`${scheme}-card`, async () => {
        const card = cards.nth(2);
        await card.scrollIntoViewIfNeeded();
        await card.click({ position: { x: 20, y: 20 } });
        await expect(card).toHaveAttribute('data-ww-editor-selected', '');
        await moveAway(page);
        await page.waitForTimeout(600);
        await clip(page, `${scheme}-card-selected`, (await card.boundingBox())!);
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(600);
        await clip(page, `${scheme}-card-selected-scrolled`, (await card.boundingBox())!);
      });
      await closeEditor(editor);
      // The Studio badge appears on the page while a Studio window holds the session.
      await step(`${scheme}-studio-badge`, async () => {
        const studio = await context.newPage();
        await studio.goto(`chrome-extension://${extensionId}/studio/index.html`);
        await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
        await page.bringToFront();
        const badge = page.locator('#web-world-themes-studio-link');
        await expect(badge.getByRole('button', { name: 'クイック編集を表示' })).toBeVisible();
        await clip(page, `${scheme}-studio-badge`, (await badge.boundingBox())!);
        await studio.close();
        await expect(badge).toHaveCount(0);
      });

      for (const video of videos) {
        const name = `${scheme}-${video.name}`;
        let ready = false;
        await step(`${name}-video`, async () => {
          const url = await resolveVideo(page, video);
          record[`${name}-url`] = url;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
          await waitForAdvertToEnd(page, 60_000);
          await page
            .locator('video.html5-main-video')
            .first()
            .evaluate(async (node: HTMLVideoElement, at) => {
              node.pause();
              node.currentTime = at;
              await Promise.race([
                new Promise((resolve) => node.addEventListener('seeked', resolve, { once: true })),
                new Promise((resolve) => setTimeout(resolve, 10_000)),
              ]);
            }, video.at);
          await declinePromotion(page);
          await page.waitForTimeout(1500);
          record[`${name}-luminance`] = await frameLuminance(page);
          ready = true;
        });
        if (!ready) continue;
        await step(`${name}-open`, async () => {
          editor = await openEditor(page, popup);
        });
        await step(`${name}-layers`, async () => {
          await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
          const images = page.locator('#web-world-themes-decorations [data-image-id]');
          await expect(images).toHaveCount(1);
          const player = (await page.locator('#movie_player').boundingBox())!;
          // Move the layer into the clear middle of the frame and keep it selected.
          const box = (await images.first().boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(player.x + player.width * 0.3, player.y + player.height * 0.45, { steps: 8 });
          await page.mouse.up();
          await moveAway(page);
          await page.waitForTimeout(600);
          const frame = page.locator('#web-world-themes-decorations .selection-frame:visible').first();
          await clip(page, `${name}-layer-selected`, (await frame.boundingBox())!);
          // The handles' hit boxes, and whether each one is what its own centre hits.
          record[`${name}-handles`] = await frame.evaluate((node) =>
            [...node.querySelectorAll<HTMLElement>('.handle')].map((handle) => {
              const rect = handle.getBoundingClientRect(),
                root = handle.getRootNode() as ShadowRoot;
              return [
                handle.dataset.handle,
                Math.round(rect.width),
                Math.round(rect.height),
                root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === handle,
              ];
            }),
          );
          await page.keyboard.press('Control+d');
          await expect(images).toHaveCount(2);
          const rows = editor.locator('[data-kind="image"] [data-action="select"]');
          await rows.nth(0).click();
          await rows.nth(1).click({ modifiers: ['Control'] });
          await editor.getByRole('button', { name: '選択をグループ化', exact: true }).click();
          await moveAway(page);
          await page.waitForTimeout(600);
          const group = page.locator('#web-world-themes-decorations .selection-frame[data-group]:visible').first();
          await clip(page, `${name}-layer-group`, (await group.boundingBox())!);
          await editor.getByRole('button', { name: 'グループを解除', exact: true }).click();
          await rows.nth(0).click();
          await editor
            .locator('[data-kind="image"]')
            .nth(0)
            .getByRole('button', { name: 'ロック', exact: true })
            .click();
          await moveAway(page);
          await page.waitForTimeout(600);
          const locked = page.locator('#web-world-themes-decorations .selection-frame[data-locked]:visible').first();
          await clip(page, `${name}-layer-locked`, (await locked.boundingBox())!);
          await editor.locator('[data-kind="image"]').nth(0).getByRole('button', { name: 'ロック解除' }).click();
          await exposeEditorControls(editor);
          await rows.nth(1).click();
          const snap = editor.getByRole('checkbox', { name: 'スナップを有効にする' });
          if (!(await snap.isChecked())) await snap.check();
          const moving = (await images.nth(1).boundingBox())!;
          await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
          await page.mouse.down();
          await page.mouse.move(player.x + player.width / 2 + 3, player.y + player.height * 0.4, { steps: 12 });
          await page.waitForTimeout(400);
          const guide = page.locator('#web-world-themes-decorations [data-snap-guide]:visible').first();
          await expect(guide).toBeVisible();
          const g = (await guide.boundingBox())!;
          await clip(page, `${name}-layer-snap`, {
            x: g.x - 120,
            y: Math.max(g.y, player.y + player.height * 0.25),
            width: g.width + 240,
            height: Math.min(g.height, player.height * 0.4),
          });
          await page.mouse.up();
        });
        await step(`${name}-protect`, async () => {
          const studio = await context.newPage();
          await studio.goto(`chrome-extension://${extensionId}/studio/index.html`);
          await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
          await studio.locator('.ww-safety-controls summary').click();
          await studio.getByLabel('操作面の保護範囲を表示').check();
          await page.bringToFront();
          await expect(page.locator('#web-world-themes-operation-check')).toHaveCount(1);
          await moveAway(page);
          await page.waitForTimeout(600);
          await clip(page, `${name}-protect`, (await page.locator('#movie_player').boundingBox())!);
          await studio.getByLabel('操作面の保護範囲を表示').uncheck();
          await studio.close();
        });
        editor = page.getByRole('dialog', { name: dialogName });
        await closeEditor(editor).catch(() => undefined);
      }
    } finally {
      await writeFile(path.join(shots, `${prefix}-${scheme}.json`), JSON.stringify(record, null, 2));
      await info.attach('record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
      await context.close();
    }
  });
