import { exposeEditorControls } from './helpers/editor-workspace';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { openEditor as openEditorPage } from './helpers/editor';

const cards = '[data-ww-surface~="video-card"]';
const key = 'webWorldThemes.design.youtube';
// The open editor, so a card pick can first choose the card tool (UI0-d decision 2).
let editor: Locator | undefined;

async function enable(popup: Page, youtube: Page) {
  await popup.getByRole('switch', { name: '作品を表示する' }).check();
  await expect(youtube.locator(cards).first()).toBeVisible();
}

async function openEditor(popup: Page, youtube: Page) {
  const { panel: dialog } = await openEditorPage(popup, youtube);
  await exposeEditorControls(dialog);
  editor = dialog;
  return dialog;
}

async function selectCard(youtube: Page, card = youtube.locator(cards).first()) {
  // From the editor page, a page click picks a card only with the card tool.
  await editor!.getByRole('button', { name: '動画カードを編集', exact: true }).click();
  await card.locator('a').first().click();
  await expect(card).toHaveAttribute('data-ww-editor-selected', '');
  return card;
}

async function background(dialog: Locator, value: string) {
  await dialog.getByRole('checkbox', { name: '背景色を変更' }).check();
  await dialog.getByLabel('背景色', { exact: true }).fill(value);
}

async function save(dialog: Locator) {
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
}

test('pick a card, preview all properties locally, save across tabs, discard, reload and resume normal clicks', async ({
  popup,
  youtube,
  context,
}) => {
  await enable(popup, youtube);
  const second = await context.newPage();
  await second.goto('https://www.youtube.com/results?search_query=fixture');
  await expect(second.locator(cards).first()).toBeVisible();
  const baselineSecond = await second
    .locator(cards)
    .first()
    .evaluate((node) => getComputedStyle(node).background);
  const dialog = await openEditor(popup, youtube);
  const card = await selectCard(youtube);
  expect(youtube.url()).toBe('https://www.youtube.com/');
  const size = await card.boundingBox();
  const imageBefore = await card
    .locator('img')
    .first()
    .evaluate((image) => ({
      src: image.getAttribute('src'),
      filter: getComputedStyle(image).filter,
      width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height,
    }));
  const descriptionBefore = await youtube.locator('#description').evaluate((node) => getComputedStyle(node).background);

  await background(dialog, '#ebdfff');
  await dialog.getByRole('checkbox', { name: '枠線を変更' }).check();
  await dialog.getByLabel('枠線の色', { exact: true }).fill('#443366');
  await dialog.getByLabel('枠線の太さ', { exact: true }).fill('5');
  await dialog.getByRole('checkbox', { name: '角丸を変更' }).check();
  await dialog.getByLabel('角丸', { exact: true }).fill('14');
  for (const item of await youtube.locator(cards).all()) {
    await expect(item).toHaveCSS('background-color', 'rgb(235, 223, 255)');
    await expect(item).toHaveCSS('background-image', 'none');
    await expect(item).toHaveCSS('border-radius', '14px');
  }
  await card.hover();
  await expect(card).toHaveCSS('box-shadow', /5px/);
  await expect(card).toHaveCSS('box-shadow', /rgb\(68, 51, 102\)/);
  const afterSize = await card.boundingBox();
  expect(afterSize?.width).toBe(size?.width);
  expect(afterSize?.height).toBe(size?.height);
  expect(
    await card
      .locator('img')
      .first()
      .evaluate((image) => ({
        src: image.getAttribute('src'),
        filter: getComputedStyle(image).filter,
        width: image.getBoundingClientRect().width,
        height: image.getBoundingClientRect().height,
      })),
  ).toEqual(imageBefore);
  expect(await youtube.locator('#description').evaluate((node) => getComputedStyle(node).background)).toBe(
    descriptionBefore,
  );
  expect(
    await second
      .locator(cards)
      .first()
      .evaluate((node) => getComputedStyle(node).background),
  ).toBe(baselineSecond);

  await save(dialog);
  await expect(second.locator(cards).first()).toHaveCSS('background-color', 'rgb(235, 223, 255)');
  await expect(second.locator(cards).first()).toHaveCSS('border-radius', '14px');
  const stored = await popup.evaluate(async (designKey) => (await chrome.storage.local.get(designKey))[designKey], key);
  expect(stored).toMatchObject({
    schemaVersion: 14,
    siteId: 'youtube',
    // New artwork names no base theme since the retro theme was removed.
    baseThemeId: null,
    rules: [
      {
        kind: 'surface-style',
        target: 'video-card',
        style: { backgroundColor: '#ebdfff', border: { color: '#443366', widthPx: 5 }, borderRadiusPx: 14 },
      },
    ],
  });

  await background(dialog, '#ffccaa');
  await expect(card).toHaveCSS('background-color', 'rgb(255, 204, 170)');
  await dialog.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(card).toHaveCSS('background-color', 'rgb(235, 223, 255)');
  await background(dialog, '#ffccaa');
  await dialog.getByRole('button', { name: '編集を終了' }).click();
  await expect(youtube.locator('[data-ww-editor-selected]')).toHaveCount(0);
  await expect(youtube.locator('#web-world-themes-selection-style')).toHaveCount(0);
  await expect(card).toHaveCSS('background-color', 'rgb(235, 223, 255)');
  await youtube.reload();
  await expect(youtube.locator(cards).first()).toHaveCSS('border-radius', '14px');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing');
  await youtube.locator(cards).first().locator('#video-title').click();
  await expect(youtube).toHaveURL(/\/watch\?v=fixture/);
});

test('OFF and 緊急OFF remove editing UI, selection, styles, variables and surfaces; ON restores the saved design and 描画を再開 the unsaved one', async ({
  popup,
  youtube,
}) => {
  const nativeCard = await youtube
    .locator('ytd-rich-grid-media')
    .first()
    .evaluate((node) => ({
      background: getComputedStyle(node).background,
      radius: getComputedStyle(node).borderRadius,
    }));
  await enable(popup, youtube);
  let dialog = await openEditor(popup, youtube);
  await selectCard(youtube);
  await background(dialog, '#eeddff');
  await save(dialog);
  for (const boundary of ['off', 'emergency'] as const) {
    await background(dialog, '#ffddaa');
    if (boundary === 'off') await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    else await popup.getByRole('button', { name: '緊急OFF', exact: true }).click();
    await expect(
      youtube.locator(
        '[data-ww-surface], [data-ww-editor-selected], #web-world-themes-creator, #web-world-themes-design-style, #web-world-themes-selection-style, #web-world-themes-style',
      ),
    ).toHaveCount(0);
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing');
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-design');
    expect((await youtube.locator('html').getAttribute('style')) ?? '').not.toContain('--ww-');
    expect(
      await youtube
        .locator('ytd-rich-grid-media')
        .first()
        .evaluate((node) => ({
          background: getComputedStyle(node).background,
          radius: getComputedStyle(node).borderRadius,
        })),
    ).toEqual(nativeCard);
    await expect(youtube.locator('ytd-thumbnail #thumbnail').first()).toHaveCSS('border-radius', '16px');
    if (boundary === 'off') {
      await popup.getByRole('switch', { name: '作品を表示する' }).check();
      await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(238, 221, 255)');
      dialog = await openEditor(popup, youtube);
      await selectCard(youtube);
    } else {
      // 緊急OFF keeps the unsaved edit and its Undo until 描画を再開 (docs/operation-safety.md).
      await popup.getByRole('button', { name: '描画を再開', exact: true }).click();
      await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(255, 221, 170)');
      await expect(dialog.locator('.dirty')).toHaveText('未保存');
    }
  }
});

test('home, search and recommendations keep the draft across SPA and release stale selections', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const dialog = await openEditor(popup, youtube);
  await expect(youtube.locator('ytd-rich-grid-media').first()).toHaveAttribute('data-ww-surface', /video-card/);
  await selectCard(youtube);
  await background(dialog, '#ddeeff');
  await youtube.getByRole('textbox', { name: 'Search', exact: true }).fill('fixture');
  await youtube.getByRole('textbox', { name: 'Search', exact: true }).press('Enter');
  await expect(youtube).toHaveURL(/\/results\?/);
  await expect(youtube.locator('ytd-video-renderer').first()).toHaveAttribute('data-ww-surface', /video-card/);
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(221, 238, 255)');
  await expect(youtube.locator('[data-ww-editor-selected]')).toHaveCount(0);
  await expect(dialog.locator('.properties')).toBeHidden();
  await selectCard(youtube);
  // UI0-d: the editor is its own page; nothing needs moving off the page (was: パネルを左へ).
  await youtube.locator('#navigate').click();
  await expect(youtube).toHaveURL(/\/watch\?/);
  await expect(youtube.locator('.related yt-lockup-view-model').first()).toHaveAttribute(
    'data-ww-surface',
    /video-card/,
  );
  await expect(youtube.locator('.related yt-lockup-view-model').first()).toHaveCSS(
    'background-color',
    'rgb(221, 238, 255)',
  );
  await expect(youtube.locator('ytd-playlist-panel-video-renderer').first()).not.toHaveAttribute(
    'data-ww-surface',
    /video-card/,
  );
  await selectCard(youtube, youtube.locator('.related yt-lockup-view-model').first());
  await expect(youtube.locator('#web-world-themes-design-style')).toHaveCount(1);
  await save(dialog);
});

test('target classification excludes non-video cards, avoids nested targets, and follows delayed or recycled links', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  await youtube.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'creator-target-cases';
    box.innerHTML = `
      <ytd-grid-video-renderer id="legacy-grid"><a href="/watch?v=grid">Grid</a></ytd-grid-video-renderer>
      <ytd-compact-video-renderer id="legacy-recommended"><a href="/watch?v=compact">Compact</a></ytd-compact-video-renderer>
      <ytd-rich-grid-media id="outer-card"><yt-lockup-view-model id="inner-card"><a href="/watch?v=nested">Nested</a></yt-lockup-view-model></ytd-rich-grid-media>
      <yt-lockup-view-model id="playlist-card" content-type="playlist"><a href="/watch?v=example&list=playlist">Playlist</a></yt-lockup-view-model>
      <yt-lockup-view-model id="channel-card"><a href="/@example">Channel</a></yt-lockup-view-model>
      <ytm-shorts-lockup-view-model id="shorts-card"><a href="/shorts/example">Shorts</a></ytm-shorts-lockup-view-model>
      <ytd-feed-nudge-renderer id="nudge-card">Notice</ytd-feed-nudge-renderer>
      <ytd-ad-slot-renderer><yt-lockup-view-model id="ad-card"><a href="/watch?v=ad">Ad</a></yt-lockup-view-model></ytd-ad-slot-renderer>
      <yt-lockup-view-model id="delayed-card"><a>Loading</a></yt-lockup-view-model>`;
    document.querySelector('ytd-page-manager')!.append(box);
  });
  for (const id of ['legacy-grid', 'legacy-recommended', 'outer-card']) {
    await expect(youtube.locator(`#${id}`)).toHaveAttribute('data-ww-surface', /video-card/);
  }
  for (const id of [
    'inner-card',
    'playlist-card',
    'channel-card',
    'shorts-card',
    'nudge-card',
    'ad-card',
    'delayed-card',
  ]) {
    await expect(youtube.locator(`#${id}`)).not.toHaveAttribute('data-ww-surface', /video-card/);
  }
  await youtube.locator('#delayed-card a').evaluate((link) => link.setAttribute('href', '/watch?v=delayed'));
  await expect(youtube.locator('#delayed-card')).toHaveAttribute('data-ww-surface', /video-card/);
  await youtube.locator('#delayed-card a').evaluate((link) => link.setAttribute('href', '/playlist?list=changed'));
  await expect(youtube.locator('#delayed-card')).not.toHaveAttribute('data-ww-surface', /video-card/);
});

test('external saves update clean tabs, preserve another tab draft and let discard load the latest saved design', async ({
  popup,
  youtube,
  context,
}) => {
  await enable(popup, youtube);
  const second = await context.newPage();
  await second.goto('https://www.youtube.com/');
  const firstDialog = await openEditor(popup, youtube);
  await selectCard(youtube);
  await background(firstDialog, '#ddeeff');
  await save(firstDialog);
  const secondDialog = await openEditor(popup, second);
  await selectCard(second);
  await background(secondDialog, '#ffddaa');
  await background(firstDialog, '#eeccff');
  await save(firstDialog);
  await expect(secondDialog.locator('.status')).toContainText('別のタブで保存されました');
  await expect(second.locator(cards).first()).toHaveCSS('background-color', 'rgb(255, 221, 170)');
  await secondDialog.getByRole('button', { name: '変更を破棄', exact: true }).click();
  await expect(second.locator(cards).first()).toHaveCSS('background-color', 'rgb(238, 204, 255)');
  await background(secondDialog, '#ddffaa');
  await save(secondDialog);
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(221, 255, 170)');
});

test('real storage quota failure preserves the preview and retry saves it', async ({ popup, youtube }) => {
  await enable(popup, youtube);
  const dialog = await openEditor(popup, youtube);
  await selectCard(youtube);
  await background(dialog, '#ddffee');
  await popup.evaluate(async () => {
    const used = await chrome.storage.local.getBytesInUse(null);
    const fillerKey = 'creatorQuota';
    await chrome.storage.local.set({
      [fillerKey]: 'x'.repeat(chrome.storage.local.QUOTA_BYTES - used - fillerKey.length - 32),
    });
  });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.locator('.status')).toContainText('保存できませんでした');
  // The one save indicator: the header chip with the dashed circle, one reason and the way out.
  await expect(dialog.locator('.dirty')).toHaveText('保存できませんでした');
  await expect(dialog.locator('.dirty')).toHaveAttribute('data-state', 'failed');
  await expect(dialog.locator('.save-failure')).toBeVisible();
  await expect(dialog.locator('.save-reason')).toHaveText('ブラウザの保存領域に書き込めませんでした。');
  // The footer keeps the message for assistive technology only; it is not drawn a second time.
  expect(await dialog.locator('.status').evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(221, 255, 238)');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await popup.evaluate(async () => {
    await chrome.storage.local.remove('creatorQuota');
  });
  await dialog.getByRole('button', { name: 'もう一度保存', exact: true }).click();
  await expect(dialog.locator('.status')).toHaveText('保存しました。');
  await expect(dialog.locator('.dirty')).toHaveText('保存済み');
  await expect(dialog.locator('.save-failure')).toBeHidden();
  await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(221, 255, 238)');
});

for (const baseThemeId of [null, 'retro'] as const) {
  test(`version 1 artwork based on ${baseThemeId ?? 'nothing'} draws on native YouTube, keeps its base when edited, and OFF restores native styling`, async ({
    popup,
    youtube,
  }) => {
    await enable(popup, youtube);
    await popup.evaluate(
      async ({ designKey, baseThemeId }) => {
        await chrome.storage.local.set({
          [designKey]: {
            schemaVersion: 1,
            id: 'independent',
            siteId: 'youtube',
            baseThemeId,
            rules: [
              {
                kind: 'surface-style',
                target: 'video-card',
                style: { backgroundColor: '#ddeeff', borderRadiusPx: 18 },
              },
            ],
          },
        });
      },
      { designKey: key, baseThemeId },
    );
    await expect(youtube.locator(cards).first()).toHaveCSS('background-color', 'rgb(221, 238, 255)');
    await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-theme');
    expect((await youtube.locator('html').getAttribute('style')) ?? '').not.toContain('--ww-');
    await expect(youtube.locator('ytd-thumbnail #thumbnail').first()).toHaveCSS('border-radius', '16px');
    const dialog = await openEditor(popup, youtube);
    await selectCard(youtube);
    await background(dialog, '#eeffdd');
    await save(dialog);
    // An edit keeps the artwork's own base: existing artwork is never rewritten to another one.
    expect(
      await popup.evaluate(async (designKey) => {
        const design = (await chrome.storage.local.get(designKey))[designKey] as { baseThemeId: string | null };
        return design.baseThemeId;
      }, key),
    ).toBe(baseThemeId);
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(
      youtube.locator('[data-ww-surface], #web-world-themes-design-style, #web-world-themes-creator'),
    ).toHaveCount(0);
  });
}

test('unknown versions remain stored, disable editing and recover after a supported document arrives', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  await popup.evaluate(async (designKey) => {
    await chrome.storage.local.set({ [designKey]: { schemaVersion: 99, custom: 'keep me' } });
  }, key);
  // The editor page connects to the tab, which refuses: the reason shows in the connection line.
  await youtube.bringToFront();
  const tab = await popup.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
  );
  const refused = await youtube.context().newPage();
  await refused.goto(new URL(`../studio/index.html?target=${tab}`, popup.url()).href);
  await expect(refused.locator('.connection-status')).toContainText('バージョン');
  await expect(refused.locator('.connection-status')).toHaveAttribute('data-connected', 'false');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-editing', /.*/);
  await refused.close();
  expect(
    await popup.evaluate(async (designKey) => (await chrome.storage.local.get(designKey))[designKey], key),
  ).toEqual({ schemaVersion: 99, custom: 'keep me' });
  await popup.evaluate(async (designKey) => {
    await chrome.storage.local.remove(designKey);
  }, key);
  await openEditor(popup, youtube);
});

test('resetting overrides restores the native card and persists the reset; only storage and the approved official sidePanel permission are requested', async ({
  popup,
  youtube,
}) => {
  await enable(popup, youtube);
  const dialog = await openEditor(popup, youtube);
  const card = await selectCard(youtube);
  const initial = await card.evaluate((node) => getComputedStyle(node).background);
  const radius = await card.evaluate((node) => getComputedStyle(node).borderRadius);
  await background(dialog, '#ddeeff');
  await save(dialog);
  await dialog.getByRole('button', { name: 'カードの変更をリセット' }).click();
  expect(await card.evaluate((node) => getComputedStyle(node).background)).toBe(initial);
  await save(dialog);
  await expect(youtube.locator('#web-world-themes-design-style')).toHaveCount(0);
  await youtube.reload();
  await expect(youtube.locator(cards).first()).toHaveCSS('border-radius', radius);
  expect(
    await youtube
      .locator(cards)
      .first()
      .evaluate((node) => getComputedStyle(node).background),
  ).toBe(initial);
  const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(['storage', 'sidePanel']);
  expect(manifest.host_permissions).toBeUndefined();
});
