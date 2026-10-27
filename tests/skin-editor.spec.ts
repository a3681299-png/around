import { mkdir } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

const cards = '[data-ww-surface~="video-card"]';
const dialogName = 'デザインエディター';
const shots = process.env.WW_SKIN_SHOTS;

async function enable(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await popup.getByRole('slider', { name: 'Effect Strength' }).press('End');
  await expect(youtube.locator(cards).first()).toBeVisible();
}
async function openEditor(popup: Page, youtube: Page) {
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const dialog = youtube.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}
/** A 48×48 frame: red corners, green edges, blue centre, so slices are visible in pixels. */
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
async function importInto(youtube: Page, zone: Locator, name: string, buffer: Buffer) {
  const chooser = youtube.waitForEvent('filechooser');
  await zone.click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
}
const skinStyle = (card: Locator) =>
  card.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      source: style.borderImageSource,
      slice: style.borderImageSlice,
      width: style.borderImageWidth,
      repeat: style.borderImageRepeat,
      background: style.backgroundColor,
      box: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
    };
  });
async function shot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('skin tool: hover names parts, click dresses every card, guides and state previews update the real page', async ({
  popup,
  youtube,
}) => {
  const errors: string[] = [];
  youtube.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  youtube.on('pageerror', (error) => errors.push(error.message));
  await enable(popup, youtube);
  const dialog = await openEditor(popup, youtube);
  const card = youtube.locator(cards).first();
  const before = await skinStyle(card);
  // Parts no artwork names are not matched during scans; the skin tool marks them all.
  await expect(youtube.locator('[data-ww-surface~="search-box"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'UIを着せ替え' }).click();
  await expect(dialog.getByRole('region', { name: 'UIの着せ替え' })).toBeVisible();
  await expect(youtube.locator('[data-ww-surface~="search-box"]')).not.toHaveCount(0);
  const layout = await youtube.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
      }),
    '[data-ww-surface]',
  );
  // The part list reports page presence: cards exist here, the subscribe button does not.
  await expect(dialog.locator('.skin-part[data-target="video-card"] .state')).toHaveText(/^[0-9]+個$/);
  await expect(dialog.locator('.skin-part[data-target="subscribe-button"] .state')).toHaveText('見つかりません');

  // Hover: a supported part shows its name and count; a plain control says 未対応.
  const hover = youtube.locator('#web-world-themes-skin-hover');
  await card.hover();
  await expect(hover).toBeVisible();
  await expect(hover).toContainText('動画カード');
  await expect(hover).toContainText('ページ上に');
  await shot(youtube, 'skin-pick-hover');
  await youtube.getByRole('button', { name: 'Guide' }).hover();
  await expect(hover).toContainText('未対応');
  await shot(youtube, 'skin-pick-unsupported');
  await youtube.getByRole('button', { name: 'Guide' }).click();
  await expect(dialog.locator('.status')).toContainText('着せ替えに対応していません');

  // Click: the page does not navigate, and every card of the kind is outlined.
  await card.locator('a').first().click();
  expect(youtube.url()).toBe('https://www.youtube.com/');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
  const count = await youtube.locator(cards).count();
  expect(count).toBeGreaterThan(1);
  await expect(dialog.locator('.skin-reach')).toHaveText(`ページ上の${count}個に同時に反映されます`);
  await expect(youtube.locator(cards).nth(1)).toHaveCSS('outline-style', 'dashed');

  // Import the normal art through the shared asset import; all cards change, none move.
  await importInto(youtube, dialog.locator('.main-drop'), 'frame.png', await framePng(youtube));
  await expect(dialog.locator('.slice')).toBeVisible();
  await expect.poll(async () => (await skinStyle(card)).source).toMatch(/^url\("blob:/);
  const dressed = await skinStyle(card);
  expect(dressed.slice).toBe('16 fill');
  expect(dressed.width).toBe('16px');
  expect((await skinStyle(youtube.locator(cards).nth(1))).source).toBe(dressed.source);
  expect(dressed.box).toEqual(before.box);
  expect(dressed.background).toBe('rgba(0, 0, 0, 0)');
  expect(
    await youtube.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].map((node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
        }),
      '[data-ww-surface]',
    ),
  ).toEqual(layout);

  // Drag the left guide: the page follows during the drag; the whole drag is one undo step.
  const guide = dialog.locator('.slice-guide[data-side="left"]');
  await guide.scrollIntoViewIfNeeded();
  const box = (await guide.boundingBox())!;
  await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await youtube.mouse.down();
  for (let step = 1; step <= 4; step++)
    await youtube.mouse.move(box.x + box.width / 2 + step * 6, box.y + box.height / 2);
  await expect.poll(async () => (await skinStyle(card)).slice).not.toBe('16 fill');
  await youtube.mouse.up();
  const dragged = await skinStyle(card);
  expect(dragged.slice).toMatch(/^16 16 16 \d+ fill$/);
  await shot(youtube, 'skin-slice-edit');
  await dialog.getByRole('button', { name: '元に戻す' }).click();
  await expect.poll(async () => (await skinStyle(card)).slice).toBe('16 fill');
  await dialog.getByRole('button', { name: 'やり直す' }).click();
  await expect.poll(async () => (await skinStyle(card)).slice).toBe(dragged.slice);

  // State tabs: give hover its own art, then force it on the page without hovering.
  await dialog.getByRole('tab', { name: 'ホバー' }).click();
  await expect(dialog.locator('.skin-inherit')).toBeVisible();
  await importInto(
    youtube,
    dialog.locator('.main-drop'),
    'hover.png',
    await framePng(youtube, ['#8e24aa', '#fdd835', '#00897b']),
  );
  await dialog.locator('.skin-center').selectOption('repeat');
  await youtube.mouse.move(2, 400);
  expect((await skinStyle(card)).repeat).toBe('stretch');
  await dialog.getByRole('checkbox', { name: 'ページ上でこの状態を表示' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force', 'video-card:hover');
  await expect.poll(async () => (await skinStyle(card)).repeat).toBe('round');
  // Outlines step aside so the preview shows the true look.
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-selected', /.*/);
  await shot(youtube, 'skin-state-preview');
  await dialog.getByRole('checkbox', { name: 'ページ上でこの状態を表示' }).uncheck();
  await expect.poll(async () => (await skinStyle(card)).repeat).toBe('stretch');
  await card.hover();
  await expect.poll(async () => (await skinStyle(card)).repeat).toBe('round');

  // A file dropped on the slice editor replaces the open tab's art; it never becomes an image layer.
  // The forced preview shows the hover art without depending on the pointer staying on the card.
  const force = dialog.getByRole('checkbox', { name: 'ページ上でこの状態を表示' });
  await force.check();
  await youtube.mouse.move(2, 400);
  await expect.poll(async () => (await skinStyle(card)).repeat).toBe('round');
  const hoverSource = (await skinStyle(card)).source;
  const bytes = [...(await framePng(youtube, ['#000000', '#ffffff', '#ff00ff']))];
  const transfer = await youtube.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
    return data;
  }, bytes);
  await dialog.locator('.slice-stage').dispatchEvent('drop', { dataTransfer: transfer });
  await expect.poll(async () => (await skinStyle(card)).source).not.toBe(hoverSource);
  expect((await skinStyle(card)).repeat).toBe('round');
  await expect(youtube.locator('[data-image-id]')).toHaveCount(0);
  await force.uncheck();

  // Size preview renders the frame at three sizes inside the panel.
  await expect(dialog.locator('.size-box')).toHaveCount(3);
  await expect(dialog.locator('.size-box').first()).toHaveCSS('border-image-source', /^url\("blob:/);

  // Compact: colour only, previewed on the real page without shrinking anything.
  await dialog.getByRole('tab', { name: '通常' }).click();
  await dialog.locator('.skin-compact > summary').click();
  await dialog.getByRole('radio', { name: /色だけにする/ }).check();
  await dialog.getByRole('checkbox', { name: 'ページ上で小さいときの見た目を表示' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force-compact', 'video-card');
  await youtube.mouse.move(2, 400);
  await expect.poll(async () => (await skinStyle(card)).source).toBe('none');
  expect((await skinStyle(card)).box).toEqual(before.box);
  await dialog.locator('.skin-sizes').scrollIntoViewIfNeeded();
  await shot(youtube, 'skin-size-compact');
  await dialog.getByRole('checkbox', { name: 'ページ上で小さいときの見た目を表示' }).uncheck();
  await expect.poll(async () => (await skinStyle(card)).source).toMatch(/^url\("blob:/);

  // Saving persists; leaving the skin tool restores normal page clicks.
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
  await dialog.getByRole('button', { name: '選択・変形' }).click();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-picking', /.*/);
  await expect(hover).toBeHidden();
  // Leaving the skin tool keeps only the parts the artwork names (here the video card).
  await expect(youtube.locator('[data-ww-surface~="search-box"]')).toHaveCount(0);
  await expect(youtube.locator(cards).first()).toHaveCSS('border-image-source', /^url\("blob:/);
  expect(errors).toEqual([]);
});

test('the in-page Studio shows the skin editor in its inspector column and picks parts from the canvas', async ({
  popup,
  youtube,
}) => {
  await youtube.setViewportSize({ width: 1366, height: 900 });
  await enable(popup, youtube);
  await youtube.bringToFront();
  await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
  const panel = youtube.getByRole('dialog', { name: dialogName });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'UIを着せ替え' }).click();
  const region = panel.getByRole('region', { name: 'UIの着せ替え' });
  await expect(region).toBeVisible();
  // Chips are their own part: the innermost part under the pointer wins.
  const chip = youtube.locator('[data-ww-surface~="filter-chip"]').first();
  await chip.hover();
  await expect(youtube.locator('#web-world-themes-skin-hover')).toContainText('絞り込みチップ');
  await chip.click();
  expect(new URL(youtube.url()).pathname).toBe('/');
  await expect(region.locator('.skin-name')).toHaveText('絞り込みチップ');
  await expect(region.getByRole('tab', { name: '選択中のカテゴリ' })).toBeVisible();
  await importInto(youtube, region.locator('.main-drop'), 'chip.png', await framePng(youtube));
  await expect.poll(() => chip.evaluate((node) => getComputedStyle(node).borderImageSource)).toMatch(/^url\("blob:/);
  await shot(youtube, 'skin-inpage-studio');
});
