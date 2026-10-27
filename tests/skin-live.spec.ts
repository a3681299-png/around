import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { clearestPoint, declinePromotion, openNativeComments, waitForAdvertToEnd } from './helpers/youtube-live';
import {
  skinParts,
  partLocator,
  plainSkinDesign,
  storeDesign,
  importSkinArt,
  allPartsDesign,
  partSnapshot,
  focusSequence,
} from './helpers/skin-verification';
import { pixels } from './helpers/native-youtube';
import { hasFrameColour } from './helpers/skin-pixels';

for (const part of skinParts)
  test(`optional real YouTube: ${part} keeps native operations and paints all nine slices`, async ({}, info) => {
    test.skip(process.env.WW_LIVE_SKIN !== '1', 'Explicit signed-out real YouTube UI1 verification.');
    test.setTimeout(300_000);
    await mkdir('.work', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.resolve('.work/ui1-live-')), false);
    const shots = path.resolve('docs/screenshots/ui1/verification');
    const evidence: Record<string, unknown> = {};
    let livePage: import('@playwright/test').Page | undefined;
    try {
      await mkdir(shots, { recursive: true });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
      await storeDesign(popup, plainSkinDesign);
      const page = await context.newPage();
      livePage = page;
      await page.setViewportSize({ width: 1920, height: 1080 });
      const url =
        part === 'filter-chip' || part === 'video-card'
          ? 'https://www.youtube.com/results?search_query=lofi+hip+hop'
          : (process.env.WW_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (url.includes('/watch')) {
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
        await waitForAdvertToEnd(page);
        await page
          .locator('video.html5-main-video')
          .first()
          .evaluate((node: HTMLVideoElement) => node.pause());
      }
      await declinePromotion(page);
      const assetId = await importSkinArt(page, popup, 'tests/fixtures/skins/frame-light.png');
      await storeDesign(popup, plainSkinDesign);
      if (url.includes('/watch')) await openNativeComments(page);
      await test.step(part, async () => {
        await storeDesign(popup, plainSkinDesign);
        const target = partLocator(page, part).first();
        // Comments are lazy-loaded; scrolling their native region is a public signed-out action.
        if (part === 'comment-input') await page.locator('ytd-comments').first().scrollIntoViewIfNeeded();
        await expect(target, part).toBeVisible({ timeout: 20_000 });
        await target.scrollIntoViewIfNeeded();
        await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await (await target.elementHandle())!.waitForElementState('stable');
        await declinePromotion(page);
        const focusBefore = await focusSequence(page, target);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await target.scrollIntoViewIfNeeded();
        await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await page.mouse.move(
          ...(Object.values(await clearestPoint(page, { left: 0, top: 0, right: 1920, bottom: 1080 }, 0)) as [
            number,
            number,
          ]),
        );
        const before = await partSnapshot(target);
        await storeDesign(popup, allPartsDesign(assetId));
        await expect(target).toHaveCSS('border-image-width', '6px');
        await expect(target).toHaveCSS('border-image-slice', '24 fill');
        const after = await partSnapshot(target);
        const focusAfter = await focusSequence(page, target);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await target.scrollIntoViewIfNeeded();
        await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
        const clear = await clearestPoint(page, { left: 0, top: 0, right: 1920, bottom: 1080 }, 0);
        await page.mouse.move(clear.x, clear.y);
        const screenshot = await target.screenshot({
          path: path.join(shots, `${part}-frame-light.png`),
          animations: 'disabled',
        });
        const box = await target.boundingBox();
        if (!box) throw new Error(`No native box: ${part}`);
        const w = Math.floor(box.width),
          h = Math.floor(box.height);
        // Every region is sampled away from antialiased boundaries and text: TL,T,TR,L,C,R,BL,B,BR.
        const sampled = await pixels(page, screenshot, [
          { x: 2, y: 2 },
          { x: Math.floor(w / 2), y: 2 },
          { x: w - 3, y: 2 },
          { x: 2, y: Math.floor(h / 2) },
          { x: Math.floor(w / 2), y: Math.floor(h / 2) },
          { x: w - 3, y: Math.floor(h / 2) },
          { x: 2, y: h - 3 },
          { x: Math.floor(w / 2), y: h - 3 },
          { x: w - 3, y: h - 3 },
        ]);
        evidence[part] = { before, after, focusBefore, focusAfter, sampled };
        expect.soft(after.box, `${part} geometry`).toEqual(before.box);
        expect.soft(after.hits, `${part} elementFromPoint`).toEqual(before.hits);
        expect.soft(after.text, `${part} native text`).toEqual(before.text);
        expect.soft(after.focusables, `${part} native focusables`).toEqual(before.focusables);
        expect.soft(focusAfter, `${part} actual Tab order`).toEqual(focusBefore);
        const source = [
          [224, 48, 48],
          [0, 112, 192],
          [255, 128, 0],
          [128, 64, 192],
          [245, 245, 245],
          [0, 144, 96],
          [192, 48, 144],
          [208, 160, 0],
          [0, 160, 192],
        ];
        // Native text is deliberately visible in the screenshot. Its centre may be a glyph;
        // the fill contract is also fixed above as `24 fill`. Check all eight frame regions.
        for (const index of [0, 1, 2, 3, 5, 6, 7, 8])
          expect
            .soft(hasFrameColour(sampled[index]!, source[index]!), `${part} frame region ${index}: ${sampled[index]}`)
            .toBe(true);
        console.log('SKIN_PART ' + JSON.stringify({ part, before, after, focusBefore, focusAfter, sampled }));
      });
      await page.screenshot({ path: path.join(shots, 'real-youtube-nine-slice.png') });
    } finally {
      if (livePage && !livePage.isClosed()) {
        evidence.dom = await livePage.evaluate(() => ({
          url: location.href,
          targets: [...document.querySelectorAll('[data-ww-surface]')].map((element) => ({
            tag: element.tagName,
            surface: element.getAttribute('data-ww-surface'),
            box: element.getBoundingClientRect().toJSON(),
            html: element.outerHTML.slice(0, 1600),
          })),
        }));
        await livePage.screenshot({ path: path.join(shots, `${part}-page.png`) });
      }
      await mkdir('.work/ui1-verification/parts', { recursive: true });
      await writeFile(path.resolve(`.work/ui1-verification/parts/${part}.json`), JSON.stringify(evidence, null, 2));
      await info.attach('ui1-live-parts.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      await context.close();
    }
  });
