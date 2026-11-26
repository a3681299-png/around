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
    test.skip(process.env.AROUND_LIVE_SKIN !== '1', 'Explicit signed-out real YouTube UI1 verification.');
    test.setTimeout(300_000);
    await mkdir('.work', { recursive: true });
    const context = await launchExtension(await mkdtemp(path.resolve('.work/ui1-live-')), false);
    // A later run can keep earlier evidence by choosing another folder (UI1.1: before/after).
    const shots = path.resolve(process.env.AROUND_LIVE_SKIN_SHOTS ?? 'docs/screenshots/ui1/verification');
    const evidenceRoot = path.resolve(process.env.AROUND_LIVE_SKIN_DATA ?? '.work/ui1-verification');
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
          : (process.env.AROUND_LIVE_VIDEO_URL ?? 'https://www.youtube.com/watch?v=LC1a-DwUhls');
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
        const native = await target.boundingBox();
        if (!native) throw new Error(`No native box: ${part}`);
        // UI1.1: parts whose edges are covered (cards) or whose text starts at the edge (comment
        // entry) draw the frame outward. Sample the box the frame is drawn in, as the browser
        // reports it; inside-drawn parts report 0 and keep the native box.
        const outset = parseFloat(await target.evaluate((node) => getComputedStyle(node).borderImageOutset)) || 0;
        const box = {
          x: native.x - outset,
          y: native.y - outset,
          width: native.width + outset * 2,
          height: native.height + outset * 2,
        };
        const screenshot = await page.screenshot({
          clip: box,
          path: path.join(shots, `${part}-frame-light.png`),
          animations: 'disabled',
        });
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
        if (part === 'description-panel') {
          // Expansion is public even when signed out. Compare the expanded native DOM with
          // and without a selected-state frame, rather than treating it as login-only.
          await storeDesign(popup, plainSkinDesign);
          const collapsedHeight = (await target.boundingBox())!.height;
          await target
            .getByRole('button', { name: /more|もっと見る|さらに表示/i })
            .first()
            .click();
          await expect.poll(async () => (await target.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
          await (await target.elementHandle())!.waitForElementState('stable');
          const expandedBefore = await partSnapshot(target);
          const expandedDesign = allPartsDesign(assetId);
          const rule = expandedDesign.rules.find((item) => item.target === part)!;
          await storeDesign(popup, {
            ...expandedDesign,
            rules: [
              {
                ...rule,
                skin: { states: { ...rule.skin.states, selected: { ...rule.skin.states.normal, scalePct: 50 } } },
              },
            ],
          });
          await expect(target).toHaveCSS('border-image-width', '12px');
          const expandedAfter = await partSnapshot(target);
          evidence.expanded = { before: expandedBefore, after: expandedAfter };
          expect.soft(expandedAfter.box, 'expanded description geometry').toEqual(expandedBefore.box);
          expect.soft(expandedAfter.hits, 'expanded description hits').toEqual(expandedBefore.hits);
          expect.soft(expandedAfter.text, 'expanded description text').toEqual(expandedBefore.text);
          expect.soft(expandedAfter.focusables, 'expanded description focusables').toEqual(expandedBefore.focusables);
          await page.screenshot({ path: path.join(shots, 'description-expanded-page.png') });
        }
      });
      await page.screenshot({ path: path.join(shots, 'real-youtube-nine-slice.png') });
    } finally {
      if (livePage && !livePage.isClosed()) {
        evidence.dom = await livePage.evaluate(() => ({
          url: location.href,
          targets: [...document.querySelectorAll('[data-around-surface]')].map((element) => ({
            tag: element.tagName,
            surface: element.getAttribute('data-around-surface'),
            box: element.getBoundingClientRect().toJSON(),
            html: element.outerHTML.slice(0, 1600),
          })),
        }));
        await livePage.screenshot({ path: path.join(shots, `${part}-page.png`) });
      }
      await mkdir(path.join(evidenceRoot, 'parts'), { recursive: true });
      await writeFile(path.join(evidenceRoot, `parts/${part}.json`), JSON.stringify(evidence, null, 2));
      await info.attach('ui1-live-parts.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      await context.close();
    }
  });
