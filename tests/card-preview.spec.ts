import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';

/*
 * G1.1.1: YouTube draws its inline preview (ytd-video-preview) over a card's thumbnail as an
 * element outside the card. The card and skin tools take a click there as a click on the card
 * underneath and keep it from YouTube; サイト操作 leaves it to YouTube. Other layers over a card
 * (a menu) are not the card's.
 */
const cards = '[data-ww-surface~="video-card"]';

/** Lays a site element over the first card's thumbnail, outside the card, counting the clicks
 * YouTube would get. */
async function overlay(youtube: Page, tag: 'ytd-video-preview' | 'tp-yt-iron-dropdown') {
  const card = youtube.locator(cards).first();
  const box = (await card.locator('img').first().boundingBox())!;
  await youtube.evaluate(
    ({ tag, box }) => {
      const layer = document.createElement(tag),
        link = document.createElement('a');
      layer.id = 'g111-layer';
      layer.dataset.clicks = '0';
      layer.setAttribute(
        'style',
        `display:block;position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:2000;background:#123`,
      );
      link.href = '#g111-preview';
      link.setAttribute('style', 'display:block;width:100%;height:100%');
      layer.append(link);
      layer.addEventListener('pointerdown', () => (layer.dataset.clicks = String(Number(layer.dataset.clicks) + 1)));
      layer.addEventListener('click', () => (layer.dataset.clicks = String(Number(layer.dataset.clicks) + 1)));
      document.body.append(layer);
    },
    { tag, box },
  );
  return { card, at: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}
const clicks = (youtube: Page) => youtube.locator('#g111-layer').evaluate((node: HTMLElement) => node.dataset.clicks);

async function start(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await expect(youtube.locator(cards).first()).toBeVisible();
  return openEditor(popup, youtube);
}

test('the card tool takes a click on the inline preview as the card underneath, and YouTube never gets it', async ({
  popup,
  youtube,
}) => {
  const { panel } = await start(popup, youtube);
  await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  const { card, at } = await overlay(youtube, 'ytd-video-preview');
  const before = youtube.url();
  await youtube.mouse.click(at.x, at.y);
  await expect(card).toHaveAttribute('data-ww-editor-selected', '');
  expect(await clicks(youtube)).toBe('0');
  expect(youtube.url()).toBe(before);
});

test('a preview that appears between press and release still completes the press on the card', async ({
  popup,
  youtube,
}) => {
  const { panel } = await start(popup, youtube);
  await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  const card = youtube.locator(cards).first();
  const box = (await card.locator('img').first().boundingBox())!;
  const before = youtube.url();
  await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await youtube.mouse.down();
  // The press lands on the card; the release on the preview, so the click goes to an ancestor.
  await overlay(youtube, 'ytd-video-preview');
  await youtube.mouse.up();
  await expect(card).toHaveAttribute('data-ww-editor-selected', '');
  expect(await clicks(youtube)).toBe('0');
  expect(youtube.url()).toBe(before);
});

test('the skin tool frames and picks the card under the inline preview, and YouTube never gets the click', async ({
  popup,
  youtube,
}) => {
  const { panel } = await start(popup, youtube);
  await panel.getByRole('button', { name: 'UIを着せ替え', exact: true }).click();
  const { at } = await overlay(youtube, 'ytd-video-preview');
  const before = youtube.url();
  await youtube.mouse.move(at.x - 10, at.y);
  await youtube.mouse.move(at.x, at.y, { steps: 3 });
  await expect(youtube.locator('#web-world-themes-skin-hover')).toContainText('動画カード');
  await youtube.mouse.click(at.x, at.y);
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
  expect(await clicks(youtube)).toBe('0');
  expect(youtube.url()).toBe(before);
});

test('サイト操作 leaves the inline preview to YouTube, and a menu over a card is never the card', async ({
  popup,
  youtube,
}) => {
  const { panel } = await start(popup, youtube);
  await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
  let layer = await overlay(youtube, 'ytd-video-preview');
  await youtube.mouse.click(layer.at.x, layer.at.y);
  await expect.poll(() => clicks(youtube)).toBe('2');
  await youtube.locator('#g111-layer').evaluate((node) => node.remove());
  // A menu YouTube opens over a card keeps its own clicks, even with the card tool.
  await panel.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  layer = await overlay(youtube, 'tp-yt-iron-dropdown');
  await youtube.mouse.click(layer.at.x, layer.at.y);
  await expect.poll(() => clicks(youtube)).toBe('2');
  await expect(layer.card).not.toHaveAttribute('data-ww-editor-selected', '');
});
