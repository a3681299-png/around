import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'node:path';
import { YOUTUBE_DESIGN_TARGETS } from '../../src/sites/youtube-targets';
import { parseDesign } from '../../src/design/schema';
import { openEditor } from './editor';

export const skinParts = YOUTUBE_DESIGN_TARGETS.map((target) => target.id);
export const partLocator = (page: Page, part: string) =>
  page.locator(`[data-ww-surface~="${part}"]`).filter({ visible: true });
/** Public signed-out native shapes, shared by the fixture operation and lifecycle checks. */
export async function nativeFixtureParts(page: Page) {
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await page.evaluate(() => {
    const metadata = document.querySelector('ytd-watch-metadata')!;
    const actions = metadata.querySelector('.watch-actions')!;
    const subscribe = actions.querySelector('yt-button-shape')!;
    const wrapper = document.createElement('ytd-subscribe-button-renderer');
    subscribe.before(wrapper);
    wrapper.append(subscribe);
    const like = actions.querySelector('button[aria-label="Like video"]')!;
    const buttons = document.createElement('div');
    buttons.id = 'top-level-buttons-computed';
    const segmented = document.createElement('segmented-like-dislike-button-view-model');
    const likeModel = document.createElement('like-button-view-model');
    likeModel.append(like);
    const dislikeModel = document.createElement('dislike-button-view-model');
    dislikeModel.innerHTML = '<button aria-label="Dislike" aria-pressed="false">Dislike</button>';
    segmented.append(likeModel, dislikeModel);
    const share = document.createElement('yt-button-shape');
    share.innerHTML = '<button>Share</button>';
    buttons.append(segmented, share);
    actions.append(buttons);
    const chip = document.createElement('yt-chip-cloud-chip-renderer');
    chip.innerHTML = '<button><div class="ytChipShapeChip">All</div></button>';
    metadata.prepend(chip);
    const input = document.querySelector('#contenteditable-root')!;
    const placeholder = document.createElement('div');
    placeholder.id = 'placeholder-area';
    input.before(placeholder);
    placeholder.append(input);
    const expand = document.createElement('button');
    expand.textContent = 'Show more';
    metadata.querySelector('#description')!.append(expand);
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  for (const part of skinParts) await expect(partLocator(page, part).first(), part).toBeVisible();
}
/** The native look with every part referenced: parts are marked only for artwork that names
 * them (UI1.1), and empty style rules compile to no CSS, so this is still the baseline. */
export const plainSkinDesign = {
  schemaVersion: 13,
  id: 'ui1-independent-verification',
  siteId: 'youtube',
  baseThemeId: null,
  rules: skinParts.map((target) => ({ kind: 'surface-style', target, style: {} })),
  decorations: [],
};
export async function storeDesign(popup: Page, design: object) {
  await popup.evaluate(async (design) => {
    await chrome.storage.local.set({
      'webWorldThemes.showArtwork': true,
      'webWorldThemes.safety.emergencyOff': false,
      'webWorldThemes.design.youtube': design,
    });
  }, design);
}
/** Use the real import/validation/lease path; no synthetic blob URL enters the renderer. */
export async function importSkinArt(page: Page, popup: Page, filename: string) {
  await page.bringToFront();
  await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await expect(popup.locator('#creator-editor-direct')).toBeEnabled();
  const { studio, panel: editor } = await openEditor(popup, page);
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await editor.locator('.skin-part[data-target="video-card"]').click();
  const zone = (await editor.locator('.main-drop').isVisible())
    ? editor.locator('.main-drop')
    : editor.getByRole('button', { name: '絵を差し替える' });
  const [chooser] = await Promise.all([studio.waitForEvent('filechooser'), zone.click()]);
  await chooser.setFiles(path.resolve(filename));
  await expect(editor.locator('.slice')).toBeVisible();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.status')).toHaveText('保存しました。');
  const saved = await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
  await editor
    .getByRole('button', { name: /編集を終了/ })
    .first()
    .click();
  // The editing session ends on the page itself; then the editor's page goes.
  await expect(page.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
  await studio.close();
  return parseDesign(saved).rules.find((rule) => rule.target === 'video-card')!.skin!.states.normal.assetId;
}
export function allPartsDesign(assetId: string, scalePct = 25, slices = { top: 24, right: 24, bottom: 24, left: 24 }) {
  return {
    ...plainSkinDesign,
    rules: skinParts.map((target) => ({
      kind: 'surface-style',
      target,
      style: {},
      skin: {
        states: { normal: { assetId, slices, scalePct, center: 'stretch' } },
      },
    })),
  };
}
/** Stable identities live in a WeakMap rather than adding test attributes to native elements. */
export async function partSnapshot(part: Locator) {
  return part.evaluate((node) => {
    const scope = window as typeof window & { __skinIds?: WeakMap<Element, number>; __skinSerial?: number };
    const ids = (scope.__skinIds ??= new WeakMap<Element, number>());
    const key = (element: Element | null) => {
      if (!element) return null;
      let id = ids.get(element);
      if (!id) {
        id = (scope.__skinSerial ?? 0) + 1;
        scope.__skinSerial = id;
        ids.set(element, id);
      }
      return { id, tag: element.tagName, name: element.getAttribute('aria-label'), domId: element.id };
    };
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    const points = [
      [0.5, 0.5],
      [0.05, 0.05],
      [0.95, 0.05],
      [0.05, 0.95],
      [0.95, 0.95],
    ];
    const properties = [
      'borderImageSource',
      'borderImageSlice',
      'borderImageWidth',
      'borderImageOutset',
      'borderImageRepeat',
      'backgroundColor',
      'backgroundImage',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'borderTopStyle',
      'borderRadius',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'color',
      'opacity',
      'display',
      'position',
      'pointerEvents',
      'transform',
      'zIndex',
      'outline',
      'boxSizing',
    ] as const;
    const focusable = [
      ...node.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex],[contenteditable="true"]'),
    ];
    if (node instanceof HTMLElement && node.tabIndex >= 0) focusable.unshift(node);
    return {
      node: key(node),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      text: (node as HTMLElement).innerText,
      focusables: focusable.map((element) => ({ ...key(element), tabIndex: element.tabIndex })),
      hits: points.map(([x, y]) => key(document.elementFromPoint(box.x + box.width * x!, box.y + box.height * y!))),
      compact: node.getAttribute('data-ww-skin-compact'),
      style: Object.fromEntries(properties.map((property) => [property, style[property]])),
    };
  });
}
/** Actual Tab navigation from a native descendant; identities must remain exactly the same. */
export async function focusSequence(page: Page, part: Locator) {
  const start = await part.evaluate((node) => {
    const candidate =
      node instanceof HTMLElement && node.tabIndex >= 0
        ? node
        : (node.querySelector<HTMLElement>('a[href],button,input,textarea,[tabindex="0"],[contenteditable="true"]') ??
          node.closest<HTMLElement>('button,[tabindex="0"]'));
    candidate?.focus();
    return Boolean(candidate);
  });
  if (!start) return [];
  const sequence = [];
  for (let index = 0; index < 4; index++) {
    sequence.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        const scope = window as typeof window & { __skinIds?: WeakMap<Element, number>; __skinSerial?: number };
        const ids = (scope.__skinIds ??= new WeakMap<Element, number>());
        if (!element) return null;
        if (!ids.has(element)) {
          scope.__skinSerial = (scope.__skinSerial ?? 0) + 1;
          ids.set(element, scope.__skinSerial);
        }
        return ids.get(element);
      }),
    );
    await page.keyboard.press('Tab');
  }
  return sequence;
}
