import { test, expect, launchExtension } from './fixtures';
import type { Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeShortcut } from './helpers/native-shortcut';
import { build } from 'esbuild';
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

/** Public native shapes observed in the signed-out capture, added to the local watch fixture. */
async function nativeParts(page: Page) {
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

test('nine skins preserve the G1 operation contract, both player bands and every safe paint region', async ({
  youtube,
  popup,
}, info) => {
  await storeDesign(popup, plainSkinDesign);
  await nativeParts(youtube);
  const assetId = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
  await storeDesign(popup, plainSkinDesign);
  const probe = await build({
    stdin: {
      contents:
        "export {youtubeOperations} from './src/sites/youtube-operations'; export {safePaintRegions} from './src/world/operations';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'SkinG1',
  });
  await youtube.addScriptTag({ content: probe.outputFiles[0]!.text });
  const snapshot = () =>
    youtube.evaluate(() => {
      const api = (globalThis as any).SkinG1;
      const source = api.youtubeOperations(document),
        value = source.capture();
      const result = {
        supported: value.supported,
        surfaces: value.surfaces,
        regions: api.safePaintRegions(value, false),
      };
      source.destroy();
      return result;
    });
  const before = await snapshot();
  await storeDesign(popup, allPartsDesign(assetId));
  await expect(partLocator(youtube, 'subscribe-button').first()).toHaveCSS('border-image-width', '6px');
  const after = await snapshot();
  await writeFile('.work/ui1-g1-contract.json', JSON.stringify({ before, after }, null, 2));
  await info.attach('skin-g1-contract.json', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(after).toEqual(before);
  expect(before.supported).toBe(true);
  expect(after.regions.length).toBeGreaterThan(0);
  expect(after.surfaces.find((surface: any) => surface.id === 'player.controls.top').protectedEnvelope.height).toBe(64);
  expect(after.surfaces.find((surface: any) => surface.id === 'player.controls.bottom').protectedEnvelope.height).toBe(
    112,
  );
});

test('all nine native fixture parts retain exact boxes, hits, text, tab stops and keyboard sequences', async ({
  youtube,
  popup,
}) => {
  await storeDesign(popup, plainSkinDesign);
  await nativeParts(youtube);
  const assetId = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
  for (const part of skinParts) {
    await storeDesign(popup, plainSkinDesign);
    const target = partLocator(youtube, part).first();
    await expect(target).toHaveCSS('border-image-source', 'none');
    const keyboardBefore = await focusSequence(youtube, target);
    await target.scrollIntoViewIfNeeded();
    const before = await partSnapshot(target);
    await storeDesign(popup, allPartsDesign(assetId));
    await expect(target).toHaveCSS('border-image-width', '6px');
    const after = await partSnapshot(target);
    const keyboardAfter = await focusSequence(youtube, target);
    expect(after.box, part).toEqual(before.box);
    expect(after.hits, part).toEqual(before.hits);
    expect(after.text, part).toEqual(before.text);
    expect(after.focusables, part).toEqual(before.focusables);
    expect(keyboardAfter, part).toEqual(keyboardBefore);
    expect(keyboardAfter.length, part).toBeGreaterThan(0);
  }
});

test('forced state and compact previews survive neither save/reload nor an Undo/Redo roundtrip', async ({
  youtube,
  popup,
}) => {
  await storeDesign(popup, plainSkinDesign);
  await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
  await youtube.bringToFront();
  await popup.locator('#creator-editor-open').evaluate((button: HTMLButtonElement) => button.click());
  const editor = youtube.getByRole('dialog', { name: 'デザインエディター' });
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await editor.locator('.skin-part[data-target="video-card"]').click();
  await editor.locator('.skin-compact > summary').click();
  await editor.getByRole('radio', { name: /色だけにする/ }).check();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.status')).toHaveText('保存しました。');
  const read = () =>
    popup.evaluate(
      async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
    );
  const saved = await read();
  await editor.getByRole('tab', { name: 'ホバー' }).click();
  await editor.getByRole('checkbox', { name: 'ページ上でこの状態を表示' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force', 'video-card:hover');
  expect(await read()).toEqual(saved);
  await editor.getByRole('checkbox', { name: 'ページ上で小さいときの見た目を表示' }).check();
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force-compact', 'video-card');
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-force', /.*/);
  await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  // A real authoring edit makes Save available while the temporary compact preview is active.
  await editor.getByRole('tab', { name: '通常' }).click();
  await editor.getByRole('checkbox', { name: 'ページ上で小さいときの見た目を表示' }).check();
  await editor.locator('.skin-scale').fill('30');
  await editor.locator('.skin-scale').press('Tab');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.status')).toHaveText('保存しました。');
  const authored = structuredClone(saved) as {
    rules: Array<{ target: string; skin: { states: { normal: { scalePct: number } } } }>;
  };
  authored.rules.find((rule) => rule.target === 'video-card')!.skin.states.normal.scalePct = 30;
  expect(await read()).toEqual(authored);
  await editor.getByRole('button', { name: '元に戻す' }).click();
  await expect(editor.locator('.skin-scale')).toHaveValue('100');
  await expect(youtube.locator('html')).toHaveAttribute('data-ww-skin-force-compact', 'video-card');
  await editor.getByRole('button', { name: 'やり直す' }).click();
  await expect(editor.locator('.skin-scale')).toHaveValue('30');
  await editor.getByRole('button', { name: /編集を終了/ }).click();
  await youtube.reload();
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-force', /.*/);
  await expect(youtube.locator('html')).not.toHaveAttribute('data-ww-skin-force-compact', /.*/);
  expect(await read()).toEqual(authored);
});

test('emergency OFF removes every skin, compact mark and surface sheet and restores native style', async () => {
  test.setTimeout(90_000);
  await mkdir('.work', { recursive: true });
  const profile = await mkdtemp(path.resolve('.work/g-entry-profile-'));
  const extension = await mkdtemp(path.resolve('.work/g-entry-extension-'));
  await cp(path.resolve(process.env.WW_TEST_EXTENSION_PATH ?? 'dist'), extension, { recursive: true });
  const context = await launchExtension(profile, true, {
    headed: true,
    width: 1920,
    height: 1080,
    extensionPath: extension,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
    const youtube = await context.newPage();
    await youtube.goto('https://www.youtube.com/');
    await storeDesign(popup, plainSkinDesign);
    await nativeParts(youtube);
    const baseline: Record<string, unknown> = {};
    for (const part of skinParts) baseline[part] = await partSnapshot(partLocator(youtube, part).first());
    const assetId = await importSkinArt(youtube, popup, 'tests/fixtures/skins/frame-light.png');
    await storeDesign(popup, allPartsDesign(assetId));
    for (const part of skinParts)
      await expect(partLocator(youtube, part).first()).toHaveCSS('border-image-width', '6px');
    const handles = await Promise.all(skinParts.map((part) => partLocator(youtube, part).first().elementHandle()));
    await nativeShortcut(youtube, profile, extension, 'Q');
    await expect(youtube.locator('#web-world-themes-design-style')).toHaveCount(0);
    await expect(youtube.locator('[data-ww-skin-compact]')).toHaveCount(0);
    for (const [index, part] of skinParts.entries()) {
      const style = await handles[index]!.evaluate((node) => ({
        source: getComputedStyle(node).borderImageSource,
        background: getComputedStyle(node).backgroundColor,
      }));
      expect(style.source, part).toBe('none');
      expect(style.background, part).toBe(
        (baseline[part] as Awaited<ReturnType<typeof partSnapshot>>).style.backgroundColor,
      );
    }
  } finally {
    await context.close();
  }
});
