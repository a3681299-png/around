import { test, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { declinePromotion, errorSummary } from './helpers/youtube-live';
import { plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { openEditor } from './helpers/editor';

/*
 * G1.1.1 on the real YouTube (signed out): a resting pointer on a thumbnail makes YouTube draw its
 * inline preview over the card, as an element outside the card. With the card or skin tool that
 * click chooses the card underneath and never reaches YouTube (no navigation, no playback); with
 * サイト操作 (browse) it is YouTube's again. AROUND_LIVE_CARD_PREVIEW=1.
 */
const url = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const cards = '[data-around-surface~="video-card"]';
const shots = path.resolve(process.env.AROUND_LIVE_CARD_PREVIEW_SHOTS ?? 'docs/screenshots/g111');

/** Rests on the card's thumbnail until something outside the card is under the pointer. */
async function previewOver(page: Page, index: number) {
  const card = page.locator(cards).nth(index);
  await card.scrollIntoViewIfNeeded();
  const thumbnail = card.locator('a#thumbnail, yt-thumbnail-view-model, ytd-thumbnail').first();
  const box = (await thumbnail.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x - 40, at.y - 20);
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ x, y, index, cards }) => {
            const card = document.querySelectorAll(cards)[index]!;
            const top = document.elementFromPoint(x, y);
            return Boolean(top && !card.contains(top));
          },
          { ...at, index, cards },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  const chain = await page.evaluate(
    ({ x, y, cards }) => {
      const name = (node: Element) => `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}`;
      const out: string[] = [];
      for (let node = document.elementFromPoint(x, y); node && out.length < 8; node = node.parentElement)
        out.push(name(node));
      // What lies beneath the preview at this point, and which card that is.
      const preview = document.elementFromPoint(x, y)?.closest('ytd-video-preview');
      const beneath = document
        .elementsFromPoint(x, y)
        .find((node) => preview && !preview.contains(node) && !node.contains(preview));
      const all = [...document.querySelectorAll(cards)];
      return {
        top: out,
        beneath: beneath ? name(beneath) : null,
        beneathCard: beneath ? all.findIndex((card) => card.contains(beneath)) : null,
      };
    },
    { ...at, cards },
  );
  return { card, at, chain };
}
const selectedCard = (page: Page) =>
  page.evaluate(
    (cards) =>
      [...document.querySelectorAll(cards)].findIndex((card) => card.hasAttribute('data-around-editor-selected')),
    cards,
  );

test('optional real YouTube G1.1.1: a click on the inline preview chooses the card underneath', async ({}, info) => {
  test.skip(process.env.AROUND_LIVE_CARD_PREVIEW !== '1', 'Explicit signed-out real YouTube check.');
  test.setTimeout(240_000);
  await mkdir('.work', { recursive: true });
  await mkdir(shots, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/card-preview-live-')), false);
  context.setDefaultTimeout(20_000);
  const record: Record<string, unknown> = {};
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await storeDesign(popup, plainSkinDesign);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(cards).first()).toBeVisible({ timeout: 30_000 });
    await declinePromotion(page);
    const { panel } = await openEditor(popup, page);

    // The card tool: the preview's click selects the card and stays on the results page.
    await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
    const card = await previewOver(page, 1);
    record.cardPreview = card.chain;
    // Where each part of the click lands (window capture runs before any page listener).
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __g111: string[] }).__g111 = log;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        window.addEventListener(
          type,
          (event) => {
            const target = event.target as Element;
            log.push(
              `${type}:${target.tagName?.toLowerCase()}${target.closest?.('ytd-video-preview') ? '(preview)' : ''}`,
            );
          },
          true,
        );
    });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1500);
    record.cardEvents = await page.evaluate(() => (window as unknown as { __g111: string[] }).__g111);
    record.cardUrl = new URL(page.url()).pathname;
    record.selectedCard = await selectedCard(page);
    expect(new URL(page.url()).pathname).toBe('/results');
    await expect(card.card).toHaveAttribute('data-around-editor-selected', '');
    await page.screenshot({ path: path.join(shots, 'card-tool-preview-selected.png') });

    // The skin tool: the same click picks the video card part.
    await panel.getByRole('button', { name: 'UIを着せ替え', exact: true }).click();
    const skin = await previewOver(page, 2);
    record.skinPreview = skin.chain;
    await expect(page.locator('#around-skin-hover')).toContainText('動画カード');
    await page.screenshot({ path: path.join(shots, 'skin-tool-preview-hover.png') });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/results');
    await expect(page.locator('html')).toHaveAttribute('data-around-skin-selected', 'video-card');

    // サイト操作: the click is YouTube's again.
    await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
    const browse = await previewOver(page, 3);
    record.browsePreview = browse.chain;
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/watch');
    record.result = 'ok';
  } catch (error) {
    record.result = errorSummary(error);
    throw error;
  } finally {
    await writeFile('.work/card-preview-live.json', JSON.stringify(record, null, 2) + '\n');
    await info.attach('record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
    await context.close();
  }
});
