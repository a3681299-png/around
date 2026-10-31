import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor } from './helpers/editor';

/*
 * UI0-d round 2: one editor, arranged by the width it is given. A side panel's width gets the
 * floating editor's arrangement (the tabs, one column); the editor's window gets both panes. The
 * surface (side panel or window) never chooses the arrangement. 表示設定 is the same ww-panel in the
 * action popup and in the panel the in-video icon opens.
 */
const cards = '[data-ww-surface~="video-card"]';

async function enable(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
  await expect(youtube.locator(cards).first()).toBeVisible();
}
const shown = (panel: Locator, selector: string) =>
  panel.evaluate((host, selector) => {
    const node = host.shadowRoot!.querySelector<HTMLElement>(selector);
    return Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  }, selector);

test('a side panel width gets the tabs and one column; the window width gets both panes; resizing switches', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const { studio, panel } = await openEditor(popup, youtube, { width: 400 });
  // One column: the tabs choose the pane; the design system's tabs and save chip.
  await expect(panel.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'プロパティ', exact: true })).toBeVisible();
  await expect(panel.locator('.save-state .dirty')).toHaveText('保存済み');
  await panel.getByLabel('画像素材を追加').setInputFiles('tests/fixtures/motion/petal.png');
  await expect(youtube.locator('#web-world-themes-decorations [data-image-id]')).toHaveCount(1);
  await expect(panel.locator('.save-state .dirty')).toHaveText('未保存');
  await panel.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  expect([await shown(panel, '.layers-pane'), await shown(panel, '.inspector-pane')]).toEqual([true, false]);
  await panel.getByRole('tab', { name: 'プロパティ', exact: true }).click();
  expect([await shown(panel, '.layers-pane'), await shown(panel, '.inspector-pane')]).toEqual([false, true]);
  await expect(panel.getByLabel('画像の幅', { exact: true })).toBeVisible();
  // Every tool is reachable in the narrow toolbar.
  for (const name of ['選択・変形', 'サイト操作', '動画カードを編集', 'UIを着せ替え'])
    await expect(panel.getByRole('button', { name, exact: true })).toBeInViewport();
  // Widening past 720 rebuilds the window's arrangement around the same draft.
  await studio.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => shown(panel, '.studio-library')).toBe(true);
  expect([await shown(panel, '.layers-pane'), await shown(panel, '.inspector-pane')]).toEqual([true, true]);
  await expect(panel.getByRole('tab', { name: 'レイヤー', exact: true })).toBeHidden();
  await expect(panel.locator('[data-layer-id]')).toHaveCount(1);
  await expect(panel.locator('.save-state .dirty')).toHaveText('未保存');
  // And narrowing brings the tabs back.
  await studio.setViewportSize({ width: 400, height: 900 });
  await expect(panel.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible();
  await expect(panel.locator('[data-layer-id]')).toHaveCount(1);
});

test('the editor wears the design system: tokens follow the scheme, nothing below 12px, glyph icons only', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const { studio, panel } = await openEditor(popup, youtube);
  for (const scheme of ['light', 'dark'] as const) {
    await studio.emulateMedia({ colorScheme: scheme });
    const facts = await panel.evaluate((host) => {
      const root = host.shadowRoot!;
      const small = [...root.querySelectorAll<HTMLElement>('*')].filter((node) => {
        if (!node.getClientRects().length || !node.textContent?.trim() || node.children.length) return false;
        return Number.parseFloat(getComputedStyle(node).fontSize) < 12;
      });
      return {
        surface: getComputedStyle(root.querySelector('main')!).backgroundColor,
        font: getComputedStyle(root.querySelector('main')!).fontFamily,
        small: small.map((node) => node.className || node.tagName).slice(0, 5),
        // Every icon is a 16-unit glyph from the design system's set.
        // (The chosen tool's G-pen ring is a mark drawn into its button, not an icon.)
        icons: [...root.querySelectorAll('.icon-button > svg:not(.tool-ring)')].map((svg) =>
          svg.getAttribute('viewBox'),
        ),
      };
    });
    expect(facts.surface).toBe(scheme === 'light' ? 'rgb(243, 242, 239)' : 'rgb(30, 34, 42)');
    expect(facts.font).toMatch(/^"BIZ UDPGothic"/);
    expect(facts.small).toEqual([]);
    expect(new Set(facts.icons)).toEqual(new Set(['0 0 16 16']));
  }
});

test('表示設定 is the same ww-panel in the popup and in the in-video panel, with the two ways into the editor', async ({
  popup,
  youtube,
}) => {
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  await enable(popup, youtube);
  const contents = (root: Locator) =>
    root.evaluate((node) => {
      const scope = (node.shadowRoot ?? node) as ParentNode;
      const header = scope.querySelector('.ww-titlebar')!;
      return {
        title: header.querySelector('h2')!.textContent,
        buttons: [...scope.querySelectorAll('.creator-entry button')].map((button) => button.textContent),
        retro: Boolean(scope.querySelector('.ww-app-icon, .ww-editor-menu')),
        background: getComputedStyle(header).backgroundImage,
        font: getComputedStyle(scope.querySelector('.ww-editor-body')!).fontFamily,
      };
    });
  const fromPopup = await contents(popup.locator('.popup'));
  await youtube.bringToFront();
  await youtube.getByRole('button', { name: 'Web World Themes の設定', exact: true }).click();
  const panel = youtube.getByRole('dialog', { name: 'Web World Themes の設定' });
  await expect(panel).toBeVisible();
  const fromVideo = await contents(panel);
  expect(fromPopup).toEqual(fromVideo);
  expect(fromPopup).toMatchObject({
    title: '表示設定',
    buttons: ['エディターを開く', '別ウィンドウで開く'],
    retro: false,
    background: 'none',
  });
  expect(fromPopup.font).toMatch(/^"BIZ UDPGothic"/);
  // No word "Studio" on either.
  expect(await popup.locator('.popup').innerText()).not.toContain('Studio');
  expect(await panel.innerText()).not.toContain('Studio');
});
