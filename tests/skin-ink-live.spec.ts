import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { declinePromotion, openNativeComments, waitForAdvertToEnd } from './helpers/youtube-live';
import { allPartsDesign, importSkinArt, partLocator, plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { contrastAt } from './helpers/native-youtube';

// Parts whose native text sits on the art's centre. Icon-only parts are recorded, not asserted.
const pages = {
  results: { url: 'https://www.youtube.com/results?search_query=lofi+hip+hop', parts: ['filter-chip', 'video-card'] },
  watch: {
    url: process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls',
    parts: ['subscribe-button', 'like-button', 'description-panel', 'comment-input'],
  },
};

/** Tags the part's first visible text-bearing element outside thumbnails, for contrastAt(). */
async function tagText(page: Page, part: string) {
  return partLocator(page, part)
    .first()
    .evaluate((node) => {
      document.querySelectorAll('[data-ink-probe]').forEach((element) => element.removeAttribute('data-ink-probe'));
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const parent = text.parentElement!;
        if (!text.textContent?.trim() || !parent.getClientRects().length) continue;
        if (parent.closest('ytd-thumbnail, yt-thumbnail-view-model')) continue;
        parent.setAttribute('data-ink-probe', '');
        return { text: text.textContent.trim().slice(0, 24), color: getComputedStyle(parent).color };
      }
      return null;
    });
}

for (const mode of ['light', 'dark'] as const)
  test(`optional real YouTube: engine text colour keeps native text at 3:1 or more (${mode} mode)`, async ({}, info) => {
    test.skip(process.env.WW_LIVE_SKIN !== '1', 'Explicit signed-out real YouTube UI1.1 verification.');
    test.setTimeout(600_000);
    await mkdir('.work', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.resolve('.work/ui1-ink-')), false);
    // YouTube's own appearance setting (signed out): f6=400 is the dark theme.
    if (mode === 'dark')
      await context.addCookies([{ name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/' }]);
    const evidence: Record<string, unknown>[] = [];
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
      await storeDesign(popup, plainSkinDesign);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });
      // Each art is imported right before use: a later import's save releases an image no saved
      // artwork references any more, as the product should.
      for (const art of ['light', 'dark'] as const) {
        await page.goto(pages.results.url, { waitUntil: 'domcontentloaded' });
        await declinePromotion(page);
        const assetId = await importSkinArt(page, popup, `tests/fixtures/skins/frame-${art}.png`);
        // 25%: 6px edges, so the art's centre is under the text.
        await storeDesign(popup, allPartsDesign(assetId));
        for (const { url, parts } of Object.values(pages)) {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('html')).toHaveAttribute('data-ww-mode', mode, { timeout: 20_000 });
          if (url.includes('/watch')) {
            await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
            await waitForAdvertToEnd(page);
            await page
              .locator('video.html5-main-video')
              .first()
              .evaluate((node: HTMLVideoElement) => node.pause());
            await openNativeComments(page);
          }
          await declinePromotion(page);
          for (const part of parts) {
            if (part === 'comment-input') await page.locator('ytd-comments').first().scrollIntoViewIfNeeded();
            const target = partLocator(page, part).first();
            await expect(target, part).toBeVisible({ timeout: 20_000 });
            await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
            await expect(target).toHaveCSS('border-image-slice', '24 fill');
            const tagged = await tagText(page, part);
            if (!tagged) throw new Error(`No visible native text in ${part}`);
            // The plan follows the asset load; wait until the measured contrast settles at 3:1.
            let measured: Awaited<ReturnType<typeof contrastAt>> | undefined;
            await expect
              .poll(
                async () => {
                  await tagText(page, part);
                  measured = await contrastAt(page, '[data-ink-probe]');
                  return measured.ratio;
                },
                { timeout: 15_000, message: `${mode} ${art} ${part}` },
              )
              .toBeGreaterThanOrEqual(3);
            const ink = await page.locator('[data-ink-probe]').evaluate((node) => getComputedStyle(node).color);
            evidence.push({
              mode,
              art,
              part,
              text: tagged.text,
              nativeColour: tagged.color,
              shownColour: ink,
              background: measured!.background,
              ratio: Math.round(measured!.ratio * 100) / 100,
              unobscured: measured!.unobscured,
            });
            // `unobscured` is recorded only: on buttons the hit point is YouTube's own touch-feedback
            // layer, a native sibling of the text. Hit-testing equality is skin-live.spec.ts's check.
            await target.screenshot({
              path: path.resolve(`docs/screenshots/ui1/after/ink-${mode}-${art}-${part}.png`),
              animations: 'disabled',
            });
          }
        }
      }
      console.log('INK ' + JSON.stringify(evidence));
    } finally {
      await mkdir('.work/ui1-verification', { recursive: true });
      await writeFile(path.resolve(`.work/ui1-verification/ink-${mode}.json`), JSON.stringify(evidence, null, 2));
      await info.attach(`ink-${mode}.json`, {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      await context.close();
    }
  });
