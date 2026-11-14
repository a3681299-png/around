import { test, expect, type BrowserContext } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { declinePromotion, errorSummary } from './helpers/youtube-live';
import { plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { openEditor } from './helpers/editor';
import { sidePanelDriver } from './helpers/side-panel';

/*
 * UI0-d round 2 evidence on the real YouTube (signed out): the editor in the Studio window (a tab,
 * 1440×900), the same page at a side panel's width (400×900), Chrome's own side panel (headed,
 * off-screen) and, before the change, the floating editor. Light and dark system schemes.
 * AROUND_LIVE_EDITOR_SURFACES_PREFIX names the set (before / after).
 */
const prefix = process.env.AROUND_LIVE_EDITOR_SURFACES_PREFIX ?? 'after';
const shots = path.resolve(process.env.AROUND_LIVE_EDITOR_SURFACES_SHOTS ?? 'docs/screenshots/ui0d-2');
const url = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const petal = path.resolve('tests/fixtures/motion/petal.png');

async function prepare(context: BrowserContext, scheme: 'light' | 'dark') {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await storeDesign(popup, plainSkinDesign);
  if (scheme === 'dark')
    await context.addCookies([
      { name: 'PREF', value: 'f6=400', domain: '.youtube.com', path: '/', secure: true, sameSite: 'None' },
    ]);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-around-surface~="video-card"]').first()).toBeVisible({ timeout: 30_000 });
  await declinePromotion(page);
  return { id, popup, page };
}

for (const scheme of ['light', 'dark'] as const)
  test(`optional real YouTube UI0-d round 2: editor surfaces, ${scheme}`, async ({}, info) => {
    test.skip(process.env.AROUND_LIVE_EDITOR_SURFACES !== '1', 'Explicit signed-out real YouTube UI0-d evidence.');
    test.setTimeout(420_000);
    await mkdir(shots, { recursive: true });
    await mkdir('.work', { recursive: true });
    const record: Record<string, unknown> = { scheme, prefix };
    const step = async (name: string, run: () => Promise<void>) => {
      try {
        await run();
        record[name] = 'ok';
      } catch (error) {
        record[name] = errorSummary(error);
      }
    };
    // The Studio page in a tab, at the window's and the side panel's widths.
    let context = await launchExtension(await mkdtemp(path.resolve('.work/ui0d2-live-')), false);
    context.setDefaultTimeout(20_000);
    try {
      const { popup, page } = await prepare(context, scheme);
      for (const width of [1440, 400]) {
        await step(`${scheme}-tab-${width}`, async () => {
          const { studio, panel } = await openEditor(popup, page, { width });
          await studio.emulateMedia({ colorScheme: scheme });
          await studio.waitForTimeout(800);
          await studio.screenshot({ path: path.join(shots, `${prefix}-${scheme}-tab-${width}-empty.png`) });
          await panel.getByLabel('画像素材を追加').setInputFiles([petal, petal]);
          await expect(page.locator('#around-decorations [data-image-id]')).toHaveCount(2);
          await studio.waitForTimeout(800);
          await studio.screenshot({ path: path.join(shots, `${prefix}-${scheme}-tab-${width}-layers.png`) });
          await panel.getByRole('button', { name: 'UIを着せ替え' }).click();
          const card = page.locator('[data-around-surface~="video-card"]').nth(1);
          await card.click({ position: { x: 20, y: 20 } });
          await studio.waitForTimeout(800);
          await studio.screenshot({ path: path.join(shots, `${prefix}-${scheme}-tab-${width}-skin.png`) });
          await panel.getByRole('button', { name: '選択・変形' }).click();
          await panel
            .getByRole('button', { name: '変更を破棄' })
            .first()
            .click()
            .catch(() => undefined);
          await studio.close();
        });
      }
      // 表示設定: the action popup (as a 340px page) and the panel the in-video icon opens.
      await step(`${scheme}-settings`, async () => {
        await popup.setViewportSize({ width: 340, height: 760 });
        await popup.emulateMedia({ colorScheme: scheme });
        await popup.waitForTimeout(400);
        await popup.screenshot({ path: path.join(shots, `${prefix}-${scheme}-settings-popup.png`) });
        await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
        await declinePromotion(page);
        await page.bringToFront();
        await page.getByRole('button', { name: 'Around の設定', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Around の設定' });
        await expect(settings).toBeVisible();
        await page.waitForTimeout(400);
        await settings.screenshot({ path: path.join(shots, `${prefix}-${scheme}-settings-video.png`) });
        await settings.getByRole('button', { name: '設定を閉じる' }).click();
      });
    } finally {
      await context.close();
    }
    // Chrome's own side panel, headed and off-screen.
    context = await launchExtension(await mkdtemp(path.resolve('.work/ui0d2-live-')), false, {
      headed: true,
      width: 1366,
      height: 768,
    });
    context.setDefaultTimeout(20_000);
    try {
      const { id, popup, page } = await prepare(context, scheme);
      await step(`${scheme}-sidepanel`, async () => {
        await page.bringToFront();
        const tab = await popup.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
        );
        await popup.evaluate(async (tabId) => {
          const result = await chrome.runtime.sendMessage({ type: 'around:open-side-panel', tabId });
          if (!result?.ok) throw new Error(result?.error ?? 'Native panel did not open.');
        }, tab);
        const panel = await sidePanelDriver(context, page, id, tab);
        await expect
          .poll(() => panel.evaluate('document.querySelector(".connection-status")?.dataset.connected'))
          .toBe('true');
        await panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await page.waitForTimeout(800);
        await panel.screenshot(path.join(shots, `${prefix}-${scheme}-sidepanel-empty.png`));
        await panel.files([petal, petal]);
        await expect(page.locator('#around-decorations [data-image-id]')).toHaveCount(2);
        await page.waitForTimeout(800);
        await panel.screenshot(path.join(shots, `${prefix}-${scheme}-sidepanel-layers.png`));
        await page.screenshot({ path: path.join(shots, `${prefix}-${scheme}-sidepanel-page.png`) });
        // UI0-d round 3: the ＋ menu and, with a restricted layer, 操作チェック in the header.
        if (prefix !== 'before') {
          await panel.evaluate(
            'document.querySelector("#around-creator").shadowRoot.querySelector(".add-menu > summary").click()',
          );
          await page.waitForTimeout(400);
          await panel.screenshot(path.join(shots, `${prefix}-${scheme}-sidepanel-add-menu.png`));
          await panel.evaluate(
            'document.querySelector("#around-creator").shadowRoot.querySelector(".add-menu").open = false',
          );
          await panel.fill('[data-image-prop="widthPx"]', '1600');
          await expect
            .poll(() => panel.evaluate('document.querySelector(".around-editor-safety .safety-check")?.hidden'))
            .toBe(false);
          await panel.evaluate('document.querySelector(".around-editor-safety .safety-check > summary").click()');
          await page.waitForTimeout(400);
          await panel.screenshot(path.join(shots, `${prefix}-${scheme}-sidepanel-safety.png`));
        }
      });
    } finally {
      await writeFile(path.join(shots, `${prefix}-${scheme}.json`), JSON.stringify(record, null, 2) + '\n');
      await info.attach('record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
      await context.close();
    }
  });
