import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { declinePromotion, errorSummary } from './helpers/youtube-live';
import { plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { openEditor } from './helpers/editor';
import { sidePanelDriver } from './helpers/side-panel';

/*
 * UI0-d round 1 on the real YouTube (signed out): UI skin editing from the Studio window (a tab)
 * and from Chrome's own side panel (headed, off-screen). Evidence goes to docs/screenshots/ui0d-1.
 */
const shots = path.resolve(process.env.WW_LIVE_SKIN_STUDIO_SHOTS ?? 'docs/screenshots/ui0d-1');
const url = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const art = path.resolve('tests/fixtures/skins/frame-light.png');

async function prepare(context: BrowserContext) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await storeDesign(popup, plainSkinDesign);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
  await expect(page.locator('[data-ww-surface~="video-card"]').first()).toBeVisible({ timeout: 30_000 });
  await declinePromotion(page);
  return { id, popup, page };
}
const source = (page: Page) =>
  page
    .locator('[data-ww-surface~="video-card"]')
    .first()
    .evaluate((node) => getComputedStyle(node).borderImageSource);

test('optional real YouTube UI0-d: skin editing from the Studio window tab', async ({}, info) => {
  test.skip(process.env.WW_LIVE_SKIN_STUDIO !== '1', 'Explicit signed-out real YouTube UI0-d verification.');
  test.setTimeout(240_000);
  await mkdir(shots, { recursive: true });
  await mkdir('.work', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/ui0d-live-')), false);
  context.setDefaultTimeout(20_000);
  const record: Record<string, unknown> = {};
  try {
    const { popup, page } = await prepare(context);
    const { studio, panel } = await openEditor(context, popup, page);
    await panel.getByRole('button', { name: 'UIを着せ替え' }).click();
    const region = panel.getByRole('region', { name: 'UIの着せ替え' });
    await expect(region.locator('.skin-part[data-target="video-card"] .state')).toHaveText(/^[0-9]+個$/);
    record.cards = await region.locator('.skin-part[data-target="video-card"] .state').textContent();
    const card = page.locator('[data-ww-surface~="video-card"]').nth(1);
    await card.scrollIntoViewIfNeeded();
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(page.locator('#web-world-themes-skin-hover')).toContainText('動画カード');
    await card.click({ position: { x: 20, y: 20 } });
    await expect(page.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
    record.url = page.url();
    const chooser = studio.waitForEvent('filechooser');
    await region.locator('.main-drop').click();
    await (await chooser).setFiles(art);
    await expect.poll(() => source(page)).toMatch(/^url\("blob:/);
    await expect
      .poll(() => region.locator('.slice-image').evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(96);
    await studio.screenshot({ path: path.join(shots, 'window-panel.png') });
    await page.screenshot({ path: path.join(shots, 'window-page.png') });
    await panel.getByRole('button', { name: '元に戻す' }).first().click();
    await expect.poll(() => source(page)).toBe('none');
    record.result = 'ok';
  } catch (error) {
    record.result = errorSummary(error);
    throw error;
  } finally {
    await writeFile(path.join(shots, 'window.json'), JSON.stringify(record, null, 2) + '\n');
    await info.attach('record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
    await context.close();
  }
});

test('optional real YouTube UI0-d: skin editing from Chrome side panel', async ({}, info) => {
  test.skip(process.env.WW_LIVE_SKIN_STUDIO !== '1', 'Explicit signed-out real YouTube UI0-d verification.');
  test.setTimeout(240_000);
  await mkdir(shots, { recursive: true });
  const context = await launchExtension(await mkdtemp(path.resolve('.work/ui0d-live-')), false, {
    headed: true,
    width: 1920,
    height: 1080,
  });
  context.setDefaultTimeout(20_000);
  const record: Record<string, unknown> = {};
  try {
    const { id, popup, page } = await prepare(context);
    await page.bringToFront();
    const tab = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
    );
    await popup.evaluate(async (tabId) => {
      const result = await chrome.runtime.sendMessage({ type: 'web-world-themes:open-side-panel', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'Native panel did not open.');
    }, tab);
    const panel = await sidePanelDriver(context, page, id, tab);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.click('[data-tool="skin"]');
    await expect.poll(() => panel.text('.skin-part[data-target="video-card"] .state')).toMatch(/^[0-9]+個$/);
    record.cards = await panel.text('.skin-part[data-target="video-card"] .state');
    const card = page.locator('[data-ww-surface~="video-card"]').nth(1);
    await card.scrollIntoViewIfNeeded();
    await card.hover({ position: { x: 20, y: 20 } });
    await card.click({ position: { x: 20, y: 20 } });
    await expect(page.locator('html')).toHaveAttribute('data-ww-skin-selected', 'video-card');
    await panel.files([art], '.skin-file');
    await expect.poll(() => source(page)).toMatch(/^url\("blob:/);
    await expect
      .poll(() =>
        panel.evaluate<number>(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".slice-image").naturalWidth',
        ),
      )
      .toBe(96);
    await panel.screenshot(path.join(shots, 'sidepanel-panel.png'));
    await page.screenshot({ path: path.join(shots, 'sidepanel-page.png') });
    await panel.click('.undo');
    await expect.poll(() => source(page)).toBe('none');
    record.result = 'ok';
  } catch (error) {
    record.result = errorSummary(error);
    throw error;
  } finally {
    await writeFile(path.join(shots, 'sidepanel.json'), JSON.stringify(record, null, 2) + '\n');
    await info.attach('record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
    await context.close();
  }
});
