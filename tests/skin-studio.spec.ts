import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';

/*
 * UI0-d round 1: UI skin editing from the Studio page (side panel and Studio window), which reaches
 * the YouTube tab through the Studio port. The page keeps its own part of the work: the marks, the
 * part under the pointer and the forced previews.
 */
const cards = '[data-ww-surface~="video-card"]';
const key = 'webWorldThemes.design.youtube';

async function enable(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  await expect(youtube.locator(cards).first()).toBeVisible();
}
/** A 48×48 frame: corners, edges and centre in three colours, so slices show in pixels. */
async function framePng(page: Page, colors = ['#e53935', '#43a047', '#1e88e5']): Promise<Buffer> {
  const data = await page.evaluate(async (colors) => {
    const canvas = new OffscreenCanvas(48, 48),
      context = canvas.getContext('2d')!;
    context.fillStyle = colors[1]!;
    context.fillRect(0, 0, 48, 48);
    context.fillStyle = colors[0]!;
    for (const [x, y] of [
      [0, 0],
      [32, 0],
      [0, 32],
      [32, 32],
    ])
      context.fillRect(x!, y!, 16, 16);
    context.fillStyle = colors[2]!;
    context.fillRect(16, 16, 16, 16);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, colors);
  return Buffer.from(data);
}
async function importInto(page: Page, zone: Locator, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await zone.click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
}
const skinStyle = (card: Locator) =>
  card.evaluate((node) => {
    const style = getComputedStyle(node);
    return { source: style.borderImageSource, slice: style.borderImageSlice, repeat: style.borderImageRepeat };
  });

// The window's arrangement and the side panel's (by width). The real side panel is covered in
// tests/side-panel.spec.ts.
for (const width of [1440, 400])
  test(`skin editing from the Studio page (${width}px): parts, import, slots, preview, drop, undo and save`, async ({
    popup,
    youtube,
  }) => {
    const errors: string[] = [];
    youtube.on('pageerror', (error) => errors.push(error.message));
    await enable(popup, youtube);
    const { studio, panel } = await openEditor(popup, youtube, { width });
    studio.on('pageerror', (error) => errors.push(error.message));

    // The tool is offered, and the page reports the parts it found.
    await panel.getByRole('button', { name: 'UIを着せ替え' }).click();
    const region = panel.getByRole('region', { name: 'UIの着せ替え' });
    await expect(region).toBeVisible();
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-picking', '');
    await expect(region.locator('.skin-part[data-target="video-card"] .state')).toHaveText(/^[0-9]+個$/);
    await expect(region.locator('.skin-part[data-target="subscribe-button"] .state')).toHaveText('見つかりません');

    // Parts are picked on the page itself.
    const card = youtube.locator(cards).first();
    await card.hover();
    await expect(youtube.locator('#web-world-themes-skin-hover')).toContainText('動画カード');
    await card.locator('a').first().click();
    expect(youtube.url()).toBe('https://www.youtube.com/');
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
    const count = await youtube.locator(cards).count();
    await expect(region.locator('.skin-reach')).toHaveText(`ページ上の${count}個に同時に反映されます`);

    // The art goes through the Studio's asset transfer; the preview reads the stored image.
    await importInto(studio, region.locator('.main-drop'), 'frame.png', await framePng(studio));
    await expect(region.locator('.slice')).toBeVisible();
    await expect.poll(async () => (await skinStyle(card)).source).toMatch(/^url\("blob:/);
    expect((await skinStyle(card)).slice).toBe('16 fill');
    await expect
      .poll(() => region.locator('.slice-image').evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(48);

    // A state slot: hover gets its own art and the page shows it when forced.
    await region.getByRole('tab', { name: 'ホバー' }).click();
    await importInto(
      studio,
      region.locator('.main-drop'),
      'hover.png',
      await framePng(studio, ['#8e24aa', '#fdd835', '#00897b']),
    );
    await region.locator('.skin-center').selectOption('repeat');
    await region.getByRole('checkbox', { name: 'ページ上でこの状態を表示' }).check();
    await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force', 'video-card:hover');
    await expect.poll(async () => (await skinStyle(card)).repeat).toBe('round');
    const hoverSource = (await skinStyle(card)).source;

    // A file dropped on the slice editor replaces the open slot's art; it never becomes a layer.
    const bytes = [...(await framePng(studio, ['#000000', '#ffffff', '#ff00ff']))];
    const transfer = await studio.evaluateHandle((bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
      return data;
    }, bytes);
    await region.locator('.slice-stage').dispatchEvent('drop', { dataTransfer: transfer });
    await expect
      .poll(async () => {
        const style = await skinStyle(card);
        return style.source !== hoverSource && style.source.startsWith('url(') && style.repeat === 'round';
      })
      .toBe(true);
    await expect(youtube.locator('[data-image-id]')).toHaveCount(0);
    await region.getByRole('checkbox', { name: 'ページ上でこの状態を表示' }).uncheck();
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-force', /.*/);

    // Undo from the Studio page removes the dropped art, then the hover slot, one step each.
    await panel.getByRole('button', { name: '元に戻す' }).first().click();
    await expect.poll(async () => (await skinStyle(card)).source).not.toBe(hoverSource);
    await panel.getByRole('button', { name: 'やり直す' }).first().click();

    // Saving persists the skin with both slots.
    await panel.getByRole('button', { name: '保存', exact: true }).first().click();
    await expect(panel.locator('.status')).toHaveText('保存しました。');
    const saved = await popup.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key);
    const rule = (saved as { rules: { target: string; skin?: { states: Record<string, unknown> } }[] }).rules.find(
      (rule) => rule.target === 'video-card',
    );
    expect(Object.keys(rule!.skin!.states).sort()).toEqual(['hover', 'normal']);

    // Leaving the tool releases the page.
    await panel.getByRole('button', { name: '選択・変形' }).click();
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-picking', /.*/);
    await expect(youtube.locator('#web-world-themes-skin-hover')).toBeHidden();
    expect(errors).toEqual([]);
  });

test('from the Studio page, a click on the page picks a video card only with the card tool', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const { panel } = await openEditor(popup, youtube);
  const card = youtube.locator(cards).first();
  // The select tool leaves the page's own clicks alone: no card is chosen.
  await panel.getByRole('button', { name: '選択・変形' }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editor-card-picking', /.*/);
  await card.locator('a').first().click();
  // The click was YouTube's: it navigated (in-page), and no card was chosen.
  await expect(youtube).toHaveURL(/\/watch\?/);
  await expect(youtube.locator('[data-ww-editor-selected]')).toHaveCount(0);
  // The card tool picks a card and never navigates.
  const next = youtube.locator(cards).first();
  await expect(next).toBeVisible();
  const url = youtube.url();
  await panel.getByRole('button', { name: '動画カードを編集' }).click();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-editor-card-picking', '');
  await next.locator('a').first().click();
  await expect(next).toHaveAttribute('data-ww-editor-selected', '');
  expect(youtube.url()).toBe(url);
});
