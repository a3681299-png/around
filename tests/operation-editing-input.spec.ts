import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';

/*
 * G1.1.1: clicks the editor takes on the page (picking a part to dress, a card to edit) never stop
 * drawing, while a click a page element takes from a visible control still does; the editor's
 * 操作チェック brings a latched stop back with 描画を再開, and the same click stops it again.
 */
const cards = '[data-ww-surface~="video-card"]';
const overlay = '#web-world-themes-decorations';
const stopped = (youtube: Page) =>
  youtube.locator(overlay).evaluate((node: HTMLElement) => JSON.parse(node.dataset.wwSafety ?? '{}').stopped ?? '');

/** One image layer keeps the guard watching from load, as on a page with artwork. */
async function editWithLayer(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  await expect(youtube.locator(cards).first()).toBeVisible();
  const { studio, panel } = await openEditor(popup, youtube);
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await expect(youtube.locator(overlay + ' [data-image-id]')).toHaveCount(1);
  return { studio, panel };
}
async function clickThrice(youtube: Page, card: Locator) {
  const box = (await card.boundingBox())!;
  for (let i = 0; i < 3; i++) {
    await youtube.mouse.click(box.x + box.width * (0.3 + 0.2 * i), box.y + box.height * 0.4);
    await youtube.waitForTimeout(150);
  }
}

test('dressing a card and picking cards to edit never stop drawing', async ({ popup, youtube }) => {
  const { studio, panel } = await editWithLayer(popup, youtube);
  await panel.getByRole('button', { name: 'UIを着せ替え' }).click();
  const region = panel.getByRole('region', { name: 'UIの着せ替え' });
  const card = youtube.locator(cards).first();
  await card.click({ position: { x: 20, y: 20 } });
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
  const chooser = studio.waitForEvent('filechooser');
  await region.locator('.main-drop').click();
  await (await chooser).setFiles(path.resolve('tests/fixtures/skins/frame-light.png'));
  await expect.poll(() => card.evaluate((node) => getComputedStyle(node).borderImageSource)).toMatch(/^url\("blob:/);
  for (const tool of ['UIを着せ替え', '動画カードを編集']) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await clickThrice(youtube, card);
    // Longer than the guard's recovery wait: a stop here would still be showing.
    await youtube.waitForTimeout(800);
    expect(await stopped(youtube), tool).toBe('');
    await expect(studio.locator('.ww-editor-safety .safety-resume')).toBeHidden();
  }
});

test('a covered control stops drawing until 描画を再開, and the same covered click stops it again', async ({
  popup,
  youtube,
}) => {
  const { studio } = await editWithLayer(popup, youtube);
  // A page element over a visible native control takes its clicks, as covering artwork would.
  const input = youtube.locator('yt-searchbox input');
  const box = (await input.boundingBox())!;
  await youtube.evaluate((r) => {
    const cover = document.createElement('div');
    cover.id = 'g111-cover';
    cover.setAttribute(
      'style',
      `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483000`,
    );
    document.body.append(cover);
  }, box);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const coveredClick = async () => {
    await youtube.mouse.click(at.x, at.y);
    await youtube.waitForTimeout(500);
  };
  // The cover moves no control, so each click it takes is a failure from the first one on. A stop
  // below three failures recovers by itself, possibly between two polls, so every stop the overlay
  // publishes is recorded rather than sampled.
  await youtube.locator(overlay).evaluate((node: HTMLElement) => {
    const seen: string[] = ((window as unknown as { __g111Stops: string[] }).__g111Stops = []);
    new MutationObserver(() => {
      const value = JSON.parse(node.dataset.wwSafety ?? '{}').stopped ?? '';
      if (value) seen.push(value);
    }).observe(node, { attributes: true, attributeFilter: ['data-ww-safety'] });
  });
  const seen = () => youtube.evaluate(() => (window as unknown as { __g111Stops: string[] }).__g111Stops);
  await coveredClick();
  expect(await seen()).toContain('クリックがページの操作部品に届くよう、絵の表示を止めました。');
  // One failure stops drawing for a moment only: it recovers, and there is nothing to resume.
  await expect.poll(() => stopped(youtube)).toBe('');
  await expect(studio.locator('.ww-editor-safety .safety-resume')).toBeHidden();
  for (let i = 0; i < 2; i++) await coveredClick();
  await youtube.waitForTimeout(800);
  expect(await stopped(youtube)).toBe('クリックがページの操作部品に届くよう、絵の表示を止めました。');
  const check = studio.locator('.ww-editor-safety .safety-check');
  await check.locator('summary').click();
  const resume = check.getByRole('button', { name: '描画を再開', exact: true });
  await expect(resume).toBeVisible();
  // The stop, in the creator's words: what it protected and how to fix it.
  await expect(check.locator('.safety-stop')).toContainText('クリックがページの操作部品に届くよう');
  await expect(check.locator('.safety-stop')).toContainText('描画を再開');
  await expect(check.locator('.safety-stop')).not.toContainText(/世代|幾何|照合/);
  await resume.click();
  await expect.poll(() => stopped(youtube)).toBe('');
  await expect(resume).toBeHidden();
  // With nothing restricted for a moment, 操作チェック folds away as usual.
  await expect.poll(() => check.evaluate((node: HTMLDetailsElement) => node.open)).toBe(false);
  await youtube.mouse.click(at.x, at.y);
  await expect.poll(() => stopped(youtube)).toBeTruthy();
  await youtube.waitForTimeout(500);
  for (let i = 0; i < 2; i++) await coveredClick();
  await youtube.waitForTimeout(800);
  expect(await stopped(youtube)).toBe('クリックがページの操作部品に届くよう、絵の表示を止めました。');
  await check.locator('summary').click();
  await expect(resume).toBeVisible();
});
