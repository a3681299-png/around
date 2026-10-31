import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { clickCanvas, exposeEditorControls, withCanvas } from './helpers/editor-workspace';
import { openEditor as openEditorPage } from './helpers/editor';

const cards = '[data-ww-surface~="video-card"]';
const host = '#web-world-themes-page-marks';
const COBALT = 'rgb(43, 81, 184)';

async function enable(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  await popup.getByRole('slider', { name: 'エフェクトの強さ' }).press('End');
  await expect(youtube.locator(cards).first()).toBeVisible();
}
async function openEditor(popup: Page, youtube: Page) {
  return (await openEditorPage(popup, youtube)).panel;
}
/** Ends editing, then closes the editor's page; the YouTube tab is left without an editor. */
async function closeEditor(dialog: Locator) {
  await dialog
    .getByRole('button', { name: /編集を終了/ })
    .first()
    .click();
  const youtube = dialog
    .page()
    .context()
    .pages()
    .find((page) => page.url().startsWith('https://www.youtube.com/'))!;
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
  await dialog.page().close();
}
/** What the extension leaves on the page: its listeners on document and window (every world, read
 * through DevTools), its elements, styles and attributes. */
async function footprint(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  // Listeners are read per world: the page's own and the extension's isolated world.
  const worlds: { id: number; name: string; frame: string | undefined }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) =>
    worlds.push({ id: context.id, name: context.name, frame: context.auxData?.['frameId'] as string | undefined }),
  );
  await cdp.send('Runtime.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  // The extension's world only: Playwright adds its own listeners to the page's world as it clicks.
  const main = worlds.filter((world) => world.frame === frameTree.frame.id && world.name === 'Web World Themes');
  const listeners = async (expression: string) => {
    const all: string[] = [];
    for (const world of main) {
      const { result } = await cdp.send('Runtime.evaluate', { expression, contextId: world.id });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
      all.push(...listeners.map((listener) => `${world.name || 'page'}:${listener.type}:${listener.useCapture}`));
    }
    return all.sort();
  };
  const value = {
    document: await listeners('document'),
    window: await listeners('window'),
    dom: await page.evaluate(() => ({
      ids: [...document.querySelectorAll('[id^="web-world-themes-"]')].map((node) => node.id).sort(),
      styles: document.querySelectorAll('style, link[rel="stylesheet"]').length,
      html: [...document.documentElement.attributes]
        .map((attribute) => attribute.name)
        .filter((name) => name.startsWith('data-ww'))
        .sort(),
      marked: document.querySelectorAll('[data-ww-editor-selected]').length,
      // The page's own ww-* classes (the theme's); marks never add one outside their shadow root.
      classes: document.querySelectorAll('[class*="ww-"]').length,
    })),
  };
  await cdp.detach();
  return value;
}
/** The box of a mark group and of its part, to the pixel. */
const geometry = (id: string, part: Locator) =>
  part.evaluate((node, id) => {
    const mark = document.querySelector('#web-world-themes-page-marks')!.shadowRoot!.getElementById(id)!;
    const round = (rect: DOMRect) => [rect.left, rect.top, rect.width, rect.height].map(Math.round);
    return { mark: round(mark.getBoundingClientRect()), part: round(node.getBoundingClientRect()) };
  }, id);
const grown = ([left, top, width, height]: number[]) => [left! - 4, top! - 4, width! + 8, height! + 8];

test('skin marks: a G-pen frame and tag in one shadow root that takes no input, ruled siblings, nothing left after closing', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const before = await footprint(youtube);
  const dialog = await openEditor(popup, youtube);
  await dialog.getByRole('button', { name: 'UIを着せ替え' }).click();
  const card = youtube.locator(cards).nth(1);
  await card.hover({ position: { x: 24, y: 24 } });

  // One container, an open shadow root; the frame is drawn in and then stays still.
  await expect(youtube.locator(host)).toHaveCount(1);
  const hover = youtube.locator('#web-world-themes-skin-hover');
  await expect(hover.locator('.ww-mark')).toBeVisible();
  await expect(hover.locator('.ww-tag')).toHaveText(/^動画カード・ページ上に\d+個　クリックで選択$/);
  const box = await geometry('web-world-themes-skin-hover', card);
  expect(box.mark).toEqual(grown(box.part));
  const facts = await youtube.evaluate(() => {
    const root = document.querySelector('#web-world-themes-page-marks')!.shadowRoot!;
    const group = root.getElementById('web-world-themes-skin-hover')!,
      tag = group.querySelector('.ww-tag')!,
      frame = group.querySelector('.ww-mark')!;
    const g = group.getBoundingClientRect(),
      t = tag.getBoundingClientRect();
    return {
      tag: [Math.round(t.left - g.left), Math.round(t.top - g.bottom)],
      tagColours: [getComputedStyle(tag).backgroundColor, getComputedStyle(tag).color],
      frame: getComputedStyle(frame, '::before').backgroundColor,
      pointer: [group, tag, frame, root.host].map((node) => getComputedStyle(node).pointerEvents),
      mode: root.mode,
      // Classes, colours and fonts stay inside: no new ww-* class outside the shadow root.
      classes: document.querySelectorAll('[class*="ww-"]').length,
    };
  });
  expect(facts).toEqual({
    tag: [0, 4],
    tagColours: [COBALT, 'rgb(255, 255, 255)'],
    frame: COBALT,
    pointer: ['none', 'none', 'none', 'none'],
    mode: 'open',
    classes: before.dom.classes,
  });
  // The real part stays under the pointer, on the stroke and on the tag alike.
  const hits = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return [
      [rect.left + 1, rect.top + rect.height / 2],
      [rect.left + 10, rect.top + 1],
    ].map(([x, y]) => node.contains(document.elementFromPoint(x!, y!)));
  });
  expect(hits).toEqual([true, true]);
  await youtube.waitForTimeout(500);
  await card.hover({ position: { x: 40, y: 30 } });
  await youtube.waitForTimeout(100);
  // Moving over the same part does not draw it again.
  expect(
    await youtube.evaluate(
      () => document.querySelector('#web-world-themes-page-marks')!.shadowRoot!.getAnimations().length,
    ),
  ).toBe(0);

  // A plain control: a ruled dashed edge and 未対応.
  await youtube.getByRole('button', { name: 'Guide' }).hover();
  await expect(hover.locator('.ww-unsupported')).toBeVisible();
  await expect(hover.locator('.ww-tag--off')).toHaveText('未対応');
  await expect(hover.locator('.ww-mark')).toHaveCount(0);

  // The chosen kind: every part gets a ruled 1px cobalt outline at 50%, no tracking.
  await card.locator('a').first().click();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
  const sibling = youtube.locator(cards).nth(2);
  await expect(sibling).toHaveCSS('outline-style', 'solid');
  await expect(sibling).toHaveCSS('outline-width', '1px');
  await expect(sibling).toHaveCSS('outline-color', 'rgba(43, 81, 184, 0.5)');
  await expect(sibling).toHaveCSS('outline-offset', '4px');

  // Emergency OFF: every mark goes, the editor stays; resuming brings them back.
  // The part's own element: emergency OFF also removes the adapter's data-ww-surface marks.
  const plain = youtube.locator('ytd-rich-grid-media').nth(2);
  await expect(plain).toHaveCSS('outline-style', 'solid');
  await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator(host)).toBeHidden();
  await expect(plain).toHaveCSS('outline-style', 'none');
  await expect(dialog).toBeVisible();
  await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
  await expect(plain).toHaveCSS('outline-style', 'solid');
  await youtube.bringToFront();
  await card.hover({ position: { x: 24, y: 24 } });
  await expect(hover.locator('.ww-mark')).toBeVisible();

  await closeEditor(dialog);
  await expect(youtube.locator(host)).toHaveCount(0);
  expect(await footprint(youtube)).toEqual(before);
});

test('the selected video card wears the G-pen frame, which follows scrolling and resizing only while editing', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const before = await footprint(youtube);
  const dialog = await openEditor(popup, youtube);
  const card = youtube.locator(cards).first();
  // From the editor page, a page click picks a card only with the card tool (UI0-d decision 2).
  await dialog.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  await card.locator('a').first().click();
  await expect(card).toHaveAttribute('data-ww-editor-selected', '');
  const mark = youtube.locator('#web-world-themes-selection-mark .ww-mark');
  await expect(mark).toBeVisible();
  await expect(card).toHaveCSS('outline-style', 'none');
  const placed = async () => {
    const box = await geometry('web-world-themes-selection-mark', card);
    return JSON.stringify(box.mark) === JSON.stringify(grown(box.part));
  };
  await expect.poll(placed).toBe(true);
  // While shown, exactly one scroll (capture) and one resize listener more than before.
  const shown = await footprint(youtube);
  const added = (now: string[], then: string[]) => {
    const rest = [...then];
    return now.filter((entry) => {
      const index = rest.indexOf(entry);
      if (index < 0) return true;
      rest.splice(index, 1);
      return false;
    });
  };
  expect(added(shown.document, before.document)).toEqual(expect.arrayContaining(['Web World Themes:scroll:true']));
  expect(added(shown.window, before.window)).toEqual(expect.arrayContaining(['Web World Themes:resize:false']));

  const top = (await card.boundingBox())!.y;
  await youtube.mouse.wheel(0, 180);
  await expect.poll(async () => (await card.boundingBox())!.y).toBeLessThan(top - 100);
  await expect.poll(placed).toBe(true);
  await card.evaluate((node: HTMLElement) => {
    node.style.width = `${node.getBoundingClientRect().width - 60}px`;
  });
  await expect.poll(placed).toBe(true);
  // No loop runs while nothing moves.
  await youtube.waitForTimeout(200);
  const frames = await youtube.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const root = document.querySelector('#web-world-themes-page-marks')!.shadowRoot!;
        let changes = 0;
        const observer = new MutationObserver((records) => (changes += records.length));
        observer.observe(root, { attributes: true, subtree: true, childList: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(changes);
        }, 500);
      }),
  );
  expect(frames).toBe(0);

  await closeEditor(dialog);
  await expect(youtube.locator(host)).toHaveCount(0);
  await card.evaluate((node: HTMLElement) => node.style.removeProperty('width'));
  expect(await footprint(youtube)).toEqual(before);
});

test('layer selection is ruled: 1px cobalt with a white edge, 12px square handles that keep a 14px hit area', async ({
  popup,
  youtube,
}) => {
  test.setTimeout(90_000);
  await enable(popup, youtube);
  const dialog = await openEditor(popup, youtube);
  await exposeEditorControls(dialog);
  // The small layer the layer-editor suite uses: it lands clear of the protected controls.
  const data = await youtube.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e877aa';
    context.fillRect(10, 0, 50, 40);
    return canvas.toDataURL();
  });
  await dialog
    .getByLabel('画像素材を追加')
    .setInputFiles({ name: 'petal.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1]!, 'base64') });
  const image = youtube.locator('#web-world-themes-decorations [data-image-id]').first();
  await expect(image.locator('img')).toBeVisible();
  // Into the clear middle of the feed, away from the guide's links that protection keeps clear.
  await dialog.getByLabel('画像のX位置', { exact: true }).fill('55');
  await dialog.getByLabel('画像のY位置', { exact: true }).fill('60');
  await dialog.getByLabel('画像のY位置', { exact: true }).press('Tab');
  await clickCanvas(image);
  await withCanvas(youtube, async () => {
    const frame = youtube.locator('#web-world-themes-decorations .selection-frame:visible').first();
    await expect(frame).toHaveCSS('border-top-width', '1px');
    await expect(frame).toHaveCSS('border-top-color', COBALT);
    await expect(frame).toHaveCSS('border-top-style', 'solid');
    const handles = await frame.evaluate((node) =>
      [...node.querySelectorAll<HTMLElement>('.handle')].map((handle) => {
        const rect = handle.getBoundingClientRect(),
          square = getComputedStyle(handle, '::before');
        // The hit area is the button's own 14px box: the 12px square and the glyph are its
        // pseudo-elements. (Where it may be pressed stays G1's decision: here the feed's thumbnail
        // links clip it, before and after UI0-c alike.)
        return {
          mode: handle.dataset.handle,
          size: [Math.round(rect.width), Math.round(rect.height)],
          square: [square.width, square.height, square.borderTopColor, square.backgroundColor, square.borderRadius],
          glyph: getComputedStyle(handle, '::after').content !== 'none',
          pointer: getComputedStyle(handle).pointerEvents,
        };
      }),
    );
    expect(handles).toHaveLength(5);
    for (const handle of handles) {
      expect(handle.size).toEqual([14, 14]);
      expect(handle.square).toEqual(['12px', '12px', COBALT, 'rgb(255, 255, 255)', '0px']);
      expect(handle.pointer).toBe('auto');
      expect(handle.glyph).toBe(handle.mode === 'rotate');
    }
  });
});

test('protection overlays are the vermilion 45° hatch with a mono label, and emergency OFF removes them', async ({
  popup,
  youtube,
  context,
  extensionId,
}) => {
  await popup.getByRole('switch', { name: 'テーマを使う' }).check();
  const studio = await context.newPage();
  await studio.goto(`chrome-extension://${extensionId}/studio/index.html`);
  await expect(studio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
  // UI0-d round 3: 操作チェック sits in the editor's header while a layer is restricted, so one
  // layer is made too large for the player first.
  const panel = studio.locator('#web-world-themes-creator');
  await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await panel.getByLabel('画像の幅', { exact: true }).fill('1600');
  await panel.getByLabel('画像の幅', { exact: true }).press('Tab');
  await studio.locator('.ww-editor-safety .safety-check > summary').click();
  await studio.getByLabel('操作面の保護範囲を表示').check();
  const box = youtube.locator('#web-world-themes-operation-check div').first();
  await expect(box).toHaveCount(1);
  const style = await box.evaluate((node) => {
    const value = getComputedStyle(node),
      line = getComputedStyle(node, '::first-line');
    return {
      hatch: value.backgroundImage,
      edge: value.borderTopColor,
      colour: value.color,
      font: value.fontFamily,
      pointer: value.pointerEvents,
      label: line.backgroundColor,
    };
  });
  expect(style.hatch).toContain('repeating-linear-gradient(45deg, rgb(191, 63, 29)');
  expect(style.edge).toBe('rgb(191, 63, 29)');
  expect(style.colour).toBe('rgb(191, 63, 29)');
  expect(style.font).toMatch(/^"IBM Plex Mono"/);
  expect(style.pointer).toBe('none');
  expect(style.label).toBe('rgb(251, 250, 248)');
  await studio.getByRole('button', { name: '緊急OFF', exact: true }).click();
  await expect(youtube.locator('#web-world-themes-operation-check')).toHaveCount(0);
});
