import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { sidePanelDriver } from './helpers/side-panel';
import { declinePromotion } from './helpers/youtube-live';
import { plainSkinDesign, storeDesign } from './helpers/skin-verification';
import { ui0dOperationProbeBuild } from './helpers/ui0d-probe-build';
import { waitForAdvertToEnd } from './helpers/youtube-live';
import { enterNativeTheater } from './helpers/youtube-theater';

const shots = path.resolve('docs/screenshots/ui0d-verification');
for (const scheme of ['light', 'dark'] as const)
  test(`UI0-d independent real-site appearance: ${scheme}`, async ({}, info) => {
    test.skip(process.env.AROUND_LIVE_UI0D !== '1', 'Explicit signed-out real YouTube verification.');
    test.setTimeout(180_000);
    await mkdir(shots, { recursive: true });
    let context = await launchExtension(await mkdtemp(path.resolve('.work/ui0dv-')), false, {
      headed: true,
      width: 1920,
      height: 1080,
    });
    const record: Record<string, unknown> = { scheme };
    try {
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
      await page.goto('https://www.youtube.com/results?search_query=lofi+hip+hop', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-around-surface~="video-card"]').first()).toBeVisible({ timeout: 30_000 });
      await declinePromotion(page);
      await page.bringToFront(); // Required: the panel edits the active target tab.
      const tab = await popup.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
      );
      await popup.evaluate(async (tabId) => {
        const reply = await chrome.runtime.sendMessage({ type: 'around:open-side-panel', tabId });
        if (!reply?.ok) throw new Error(reply?.error ?? 'Panel did not open');
      }, tab);
      const side = await sidePanelDriver(context, page, id, tab);
      await expect
        .poll(() => side.evaluate('document.querySelector(".connection-status")?.dataset.connected'))
        .toBe('true');
      await side.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await side.files([path.resolve('tests/fixtures/motion/petal.png')]);
      await expect(page.locator('#around-decorations [data-image-id]')).toHaveCount(1);
      await expect
        .poll(() =>
          side.evaluate(
            'Boolean(document.querySelector("#around-creator").shadowRoot.querySelector("[data-thumbnail] img")?.naturalWidth)',
          ),
        )
        .toBe(true);
      for (const width of [360, 400]) {
        await side.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await side.click('[data-tool="select"]');
        await side.send('Runtime.evaluate', {
          expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
          awaitPromise: true,
        });
        await side.screenshot(path.join(shots, `s-${scheme}-${width}-layers.png`));
        await side.click('[data-tool="skin"]');
        await side.click('.skin-part[data-target="video-card"]');
        await side.screenshot(path.join(shots, `s-${scheme}-${width}-skin.png`));
        record[`s-${width}`] = await side.evaluate('({width:innerWidth,height:innerHeight,title:document.title})');
      }
      await side.send('Page.close');
      await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
      await context.close();
      // Chrome rejects off-screen bounds in windows.create. Exercise the real W entry in a
      // separate headless browser; its popup window never appears on the user's desktop.
      context = await launchExtension(await mkdtemp(path.resolve('.work/ui0dv-window-')), false);
      const worker2 = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const popup2 = await context.newPage();
      await popup2.goto(`chrome-extension://${new URL(worker2.url()).host}/popup/index.html`);
      await storeDesign(popup2, plainSkinDesign);
      const page2 = await context.newPage();
      await page2.goto('https://www.youtube.com/results?search_query=lofi+hip+hop', { waitUntil: 'domcontentloaded' });
      await expect(page2.locator('[data-around-surface~="video-card"]').first()).toBeVisible({ timeout: 30_000 });
      await declinePromotion(page2);
      await page2.bringToFront();
      const opened = context.waitForEvent('page');
      await popup2.locator('#creator-editor-window').evaluate((button) => (button as HTMLElement).click());
      const windowPage = await opened;
      await windowPage.waitForLoadState();
      await windowPage.setViewportSize({ width: 1440, height: 900 });
      await windowPage.emulateMedia({ colorScheme: scheme });
      await expect(windowPage.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
      const panel = windowPage.getByRole('dialog', { name: 'デザインエディター' });
      await panel.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
      await expect(page2.locator('#around-decorations [data-image-id]')).toHaveCount(1);
      await expect
        .poll(() =>
          panel
            .locator('[data-thumbnail] img')
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
      await panel.getByRole('button', { name: '選択・変形', exact: true }).click();
      await windowPage.screenshot({ path: path.join(shots, `w-${scheme}-1440-layers.png`) });
      await panel.getByRole('button', { name: 'UIを着せ替え', exact: true }).click();
      await panel.locator('.skin-part[data-target="video-card"]').click();
      await windowPage.screenshot({ path: path.join(shots, `w-${scheme}-1440-skin.png`) });
      record.w = await windowPage.evaluate(() => ({ width: innerWidth, height: innerHeight, screenX, screenY }));
    } finally {
      await writeFile(path.join(shots, `${scheme}.json`), JSON.stringify(record, null, 2) + '\n');
      await info.attach('appearance', { body: JSON.stringify(record), contentType: 'application/json' });
      await context.close();
    }
  });

test('UI0-d real side-panel viewport changes keep the published G1 bands and native hit targets current through modes and SPA', async ({}, info) => {
  test.skip(process.env.AROUND_LIVE_UI0D !== '1', 'Explicit real YouTube operation verification.');
  test.setTimeout(240_000);
  const extension = path.resolve('.work/ui0d-verify-g1');
  await ui0dOperationProbeBuild(path.resolve(process.env.AROUND_TEST_EXTENSION_PATH ?? 'dist'), extension);
  const context = await launchExtension(await mkdtemp(path.resolve('.work/ui0dv-g1-')), false, {
    headed: true,
    width: 1920,
    height: 1080,
    extensionPath: extension,
  });
  const records: unknown[] = [];
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
      id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await storeDesign(popup, plainSkinDesign);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await page.bringToFront();
    const tab = await popup.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!.id!,
    );
    const open = async () => {
      await popup.evaluate(async (tabId) => {
        const r = await chrome.runtime.sendMessage({ type: 'around:open-side-panel', tabId });
        if (!r?.ok) throw Error(r?.error);
      }, tab);
      return sidePanelDriver(context, page, id, tab);
    };
    let panel = await open();
    await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
    await panel.fill('[data-image-prop="anchor"]', 'video-player');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await panel.detach();
    await popup.evaluate(async (tabId) => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
    }, tab);
    await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
    const cdp = await context.newCDPSession(page);
    let isolated = 0;
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
      if (c.auxData?.type === 'isolated' && c.origin.startsWith('chrome-extension://')) isolated = c.id;
    });
    await cdp.send('Runtime.enable');
    const guard = async () => {
      const r = await cdp.send('Runtime.evaluate', {
        contextId: isolated,
        expression: 'globalThis.__ui0dGuard?.snapshot().surfaces',
        returnByValue: true,
      });
      return r.result.value;
    };
    const snapshot = async (label: string) => {
      await page.evaluate(() => scrollTo(0, 0));
      let priorWidth = -1;
      await expect
        .poll(async () => {
          const s = await guard(),
            width = await page.evaluate(() => innerWidth),
            stable = width === priorWidth;
          priorWidth = width;
          return stable && s?.viewport.width === width;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const s = await guard(),
            r = await page.locator('[data-around-surface~="player-window"]').boundingBox();
          const top = s?.surfaces.find((v: any) => v.id === 'player.controls.top');
          return Boolean(
            r &&
            top &&
            Math.abs(top.protectedEnvelope.width - r.width) < 1 &&
            Math.abs(top.protectedEnvelope.top - r.y) < 1,
          );
        })
        .toBe(true);
      const s = await guard();
      const top = s.surfaces.find((v: any) => v.id === 'player.controls.top'),
        bottom = s.surfaces.find((v: any) => v.id === 'player.controls.bottom');
      expect(top.protectedEnvelope.height).toBe(64);
      expect(bottom.protectedEnvelope.height).toBe(112);
      const player = await page.locator('[data-around-surface~="player-window"]').boundingBox();
      expect(bottom.protectedEnvelope.top).toBeCloseTo(player!.y + player!.height - 112, 0);
      await page.locator('[data-around-surface~="player-window"]').hover();
      const hits = await page.evaluate(() =>
        [...document.querySelectorAll('[data-around-surface~="player-window"] button')]
          .filter((node) =>
            /^(Play|Pause|再生|一時停止|Settings|設定|Theater mode|Default view|シアター|デフォルト|Full screen|Exit full screen|全画面)/i.test(
              node.getAttribute('aria-label') ?? '',
            ),
          )
          .map((node) => {
            const name = node.getAttribute('aria-label'),
              r = node.getBoundingClientRect(),
              hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return {
              name,
              width: r.width,
              height: r.height,
              hit: hit === node || Boolean(hit && node.contains(hit)),
            };
          }),
      );
      expect(hits.filter((v) => v.width > 0 && v.height > 0).length).toBeGreaterThanOrEqual(3);
      for (const hit of hits.filter((v) => v.width > 0 && v.height > 0))
        expect(hit.hit, JSON.stringify({ label, hit })).toBe(true);
      const record = {
        label,
        viewport: s.viewport,
        geometry: s.generation,
        top: top.protectedEnvelope,
        bottom: bottom.protectedEnvelope,
        player,
        hits,
      };
      records.push(record);
      return record;
    };
    const before = await snapshot('before-S');
    panel = await open();
    const after = await snapshot('after-S');
    expect(after.viewport.width).toBeLessThan(before.viewport.width);
    const leaveTheater = await enterNativeTheater(page);
    await snapshot('theater-S');
    await leaveTheater();
    await snapshot('normal-S');
    await page
      .locator('[data-around-surface~="player-window"]')
      .getByRole('button', { name: /^(Full screen|全画面)/i })
      .click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await snapshot('fullscreen-S');
    await page.evaluate(() => document.exitFullscreen());
    await snapshot('exit-fullscreen-S');
    const old = page.url();
    await page
      .locator('[data-around-surface~="video-card"] a[href*="/watch?v="]')
      .filter({ visible: true })
      .first()
      .click();
    await expect.poll(() => page.url()).not.toBe(old);
    await expect(page.locator('[data-around-surface~="player-window"]')).toBeVisible();
    await declinePromotion(page);
    await waitForAdvertToEnd(page);
    await snapshot('SPA-S');
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status")?.dataset.connected'))
      .toBe('true');
    // Exercise the same emergency path on actual YouTube, with picking and a painted skin active.
    await panel.click('[data-tool="skin"]');
    await panel.click('.skin-part[data-target="video-card"]');
    await panel.files([path.resolve('tests/fixtures/skins/frame-light.png')], '.skin-file');
    const nativeCard = (await page
      .locator('[data-around-surface~="video-card"]')
      .filter({ visible: true })
      .first()
      .elementHandle())!;
    const paint = () => nativeCard.evaluate((node) => getComputedStyle(node).borderImageSource);
    await expect.poll(paint).toMatch(/^url\("blob:/);
    await panel.evaluate('document.querySelector(".around-editor-safety > .emergency-off").click()');
    await expect(page.locator('html')).not.toHaveAttribute('data-around-editing', /.*/);
    await expect(page.locator('html')).not.toHaveAttribute('data-around-skin-picking', /.*/);
    await expect(page.locator('[data-image-id]')).toHaveCount(0);
    await expect(page.locator('#around-page-marks')).toHaveCount(0);
    await expect.poll(paint).toBe('none');
    await expect.poll(() => panel.evaluate('document.querySelector(".emergency-resume").hidden')).toBe(false);
    records.push({ label: 'emergency-off-S', editing: false, drawing: false, skin: 'none', marks: 0, resume: true });
    await panel.evaluate('document.querySelector(".emergency-resume").click()');
    await expect(page.locator('html')).toHaveAttribute('data-around-editing', '');
    await expect.poll(paint).toMatch(/^url\("blob:/);
    await expect(page.locator('[data-image-id]')).toHaveCount(1);
    records.push({ label: 'resume-S', editing: true, drawing: true, skin: 'blob' });
  } finally {
    await mkdir('.work/ui0d-verification', { recursive: true });
    await writeFile('.work/ui0d-verification/g1-real.json', JSON.stringify(records, null, 2));
    await info.attach('g1-real', { body: JSON.stringify(records), contentType: 'application/json' });
    await context.close();
  }
});
