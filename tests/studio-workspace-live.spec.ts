import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { beginCanvasGesture, visiblePart } from './helpers/editor-workspace';

test('layout feasibility on real signed-out YouTube, preserving native media and DOM parents', async () => {
  test.skip(process.env.WW_LAYOUT_PILOT !== '1', 'Explicit live layout pilot.');
  test.setTimeout(90_000);
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-layout-')), false);
  const results: unknown[] = [];
  try {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate(
      (element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id,
    );
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded' });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 20_000 });
    await page.bringToFront();
    const opened = context.waitForEvent('page');
    await popup.locator('#creator-studio-open').evaluate((button: HTMLButtonElement) => button.click());
    const oldStudio = await opened;
    await oldStudio.setViewportSize({ width: 1366, height: 900 });
    await expect(oldStudio.locator('.connection-status')).toHaveAttribute('data-connected', 'true');
    await oldStudio.screenshot({ path: '.work/verification/studio-layout-baseline-1366.png' });
    await oldStudio.close();
    await page.bringToFront();
    const before = await page.locator('#movie_player').boundingBox();
    const player = await page.locator('#movie_player').elementHandle(),
      parent = await page.locator('#movie_player').evaluate((node) => node.parentElement?.id);
    const css = await readFile('src/sites/youtube-studio.css', 'utf8');
    await page.evaluate((css) => {
      const root = document.documentElement;
      root.dataset.wwInpageStudio = '';
      root.dataset.wwStudioLayout = 'reserved';
      root.dataset.wwStudioCompact = '';
      for (const [name, value] of Object.entries({ left: 160, right: 300, top: 56, bottom: 24 }))
        root.style.setProperty(`--ww-studio-${name}`, `${value}px`);
      const style = document.createElement('style');
      style.id = 'ww-layout-pilot';
      style.textContent = css;
      document.head.append(style);
    }, css);
    await expect.poll(async () => (await page.locator('ytd-app').boundingBox())!.width).toBeLessThan(920);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    for (const width of [1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((width) => {
        document.documentElement.toggleAttribute('data-ww-studio-compact', width < 1500);
      }, width);
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector(selector),
            r = node?.getBoundingClientRect();
          return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined;
        };
        return {
          width: innerWidth,
          app: box('ytd-app'),
          masthead: box('#masthead-container'),
          player: box('#movie_player'),
          video: box('#movie_player video'),
          primary: box('#primary'),
          columns: box('#columns'),
          guide: box('#guide'),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      results.push(metrics);
      await page.screenshot({ path: `.work/verification/studio-layout-pilot-${width}.png` });
      expect(metrics.app!.x).toBeCloseTo(160);
      expect(metrics.player!.x).toBeGreaterThanOrEqual(160);
      expect(metrics.player!.x + metrics.player!.width).toBeLessThanOrEqual(width - 295);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width + 2);
      expect(metrics.video!.width).toBeCloseTo(metrics.player!.width, 0);
      expect(metrics.video!.height).toBeCloseTo(metrics.player!.height, 0);
      expect(
        await player!.evaluate((node) => node === document.querySelector('#movie_player') && node.parentElement?.id),
      ).toBe(parent);
    }
    await page.evaluate(() => {
      document.querySelector('#ww-layout-pilot')!.remove();
      const root = document.documentElement;
      for (const key of ['data-ww-inpage-studio', 'data-ww-studio-layout', 'data-ww-studio-compact'])
        root.removeAttribute(key);
      for (const name of ['left', 'right', 'top', 'bottom']) root.style.removeProperty(`--ww-studio-${name}`);
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect
      .poll(async () => (await page.locator('#movie_player').boundingBox())!.width)
      .toBeCloseTo(before!.width, 0);
  } finally {
    await writeFile('.work/verification/studio-layout-pilot.json', JSON.stringify(results, null, 2));
    await context.close();
  }
});

test('production in-page Studio authors on the real signed-out YouTube, without a preview frame', async () => {
  test.skip(process.env.WW_LIVE_STUDIO_WORKSPACE !== '1', 'Explicit real YouTube workspace verification.');
  test.setTimeout(150_000);
  await mkdir('.work/verification', { recursive: true });
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-live-inpage-')), false);
  const report: {
    browser?: string;
    fixture: boolean;
    completed: boolean;
    checks: Record<string, unknown>;
    geometry: unknown[];
  } = { fixture: false, completed: false, checks: {}, geometry: [] };
  try {
    report.browser = context.browser()?.version() ?? 'unknown';
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate(
      (element) => (element as HTMLElement & { data?: { id: string } }).data?.id ?? element.id,
    );
    await manager.close();
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup/index.html');
    const page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('https://www.youtube.com/watch?v=AS4q9yaWJkI', { waitUntil: 'domcontentloaded' });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 20_000 });
    await page.bringToFront();
    const nativePlayer = await page.locator('#movie_player').elementHandle(),
      nativeVideo = await page.locator('#movie_player video').elementHandle();
    const appBefore = (await page.locator('ytd-app').boundingBox())!,
      parentBefore = await nativePlayer!.evaluate((node) => node.parentElement?.id);
    await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
    const panel = page.locator('#web-world-themes-creator');
    const presentation =
      ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)';
    await expect(panel).toHaveAttribute('data-inpage', '');
    await expect(page.locator('html')).toHaveAttribute('data-ww-studio-layout', 'reserved');
    await panel
      .getByLabel('画像素材を追加')
      .setInputFiles(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
    await expect(page.locator(presentation + ' [data-image-id]')).toHaveCount(3);
    await expect(panel.getByRole('button', { name: '画像を追加', exact: true })).toBeEnabled();
    for (const row of await panel.locator('.layer').all()) {
      await row.locator('[data-action="select"]').click();
      await panel.getByLabel('配置の基準', { exact: true }).selectOption('video-player');
    }
    await panel.getByRole('button', { name: 'すべて選択', exact: true }).click();
    await expect(panel.locator('.selected-count')).toHaveText('3個選択中');
    await panel.getByRole('button', { name: '選択をグループ化', exact: true }).click();
    await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
    const first = page.locator(presentation + ' [data-image-id]').first(),
      before = (await first.boundingBox())!;
    // Grouping briefly holds drawing; start only once the artwork is the real hit target.
    const start = await visiblePart(first);
    await beginCanvasGesture(first, start);
    await page.mouse.move(start.x - 30, start.y + 15, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before.x - 30, 1);
    report.checks.directGroupMovement = true;
    await panel.getByRole('button', { name: '光とマスクを設定', exact: true }).click();
    await panel.getByLabel('円形マスクを使う', { exact: true }).check();
    await panel.getByLabel('光の半径', { exact: true }).fill('220');
    const mask = page.locator(presentation + ' .group-content');
    await expect(mask).toHaveCSS('mask-image', /radial-gradient/);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    const maskBefore = await mask.evaluate((node: HTMLElement) => node.style.maskImage);
    await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 30);
    await expect.poll(() => mask.evaluate((node: HTMLElement) => node.style.maskImage)).not.toBe(maskBefore);
    report.checks.pointerMask = true;
    await panel.getByLabel('動画の一時停止で隠す', { exact: true }).check();
    await panel.getByLabel('マスクのフェード時間', { exact: true }).fill('120');
    const playback = await page.locator('#movie_player video').evaluate(async (node: HTMLVideoElement) => {
      node.muted = true;
      const result = await Promise.race([
        node.play().then(
          () => 'playing',
          (reason: unknown) => String(reason),
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('buffering timeout'), 4000)),
      ]);
      return { result, readyState: node.readyState, error: node.error?.message };
    });
    if (playback.result === 'playing' && playback.readyState >= 2) {
      await expect.poll(async () => Number(await mask.getAttribute('data-mask-intensity'))).toBeGreaterThan(0.95);
      await page.locator('#movie_player video').evaluate((node: HTMLVideoElement) => node.pause());
      await expect.poll(async () => Number(await mask.getAttribute('data-mask-intensity'))).toBeLessThan(0.01);
      await page.locator('#movie_player video').evaluate((node: HTMLVideoElement) => node.play());
      await expect.poll(async () => Number(await mask.getAttribute('data-mask-intensity'))).toBeGreaterThan(0.95);
      report.checks.videoPauseFade = true;
    } else report.checks.videoPauseFade = { unverified: playback };
    await panel.getByRole('button', { name: '保存', exact: true }).click();
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    report.checks.creationSaved = true;
    for (const width of [1366, 1920]) {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector(selector),
            r = node?.getBoundingClientRect();
          return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined;
        };
        return {
          width: innerWidth,
          app: box('ytd-app'),
          player: box('#movie_player'),
          video: box('#movie_player video'),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      report.geometry.push(metrics);
      expect(metrics.app!.x).toBe(180);
      expect(metrics.player!.x).toBeGreaterThanOrEqual(180);
      expect(metrics.player!.x + metrics.player!.width).toBeLessThanOrEqual(width - 320);
      expect(metrics.video!.width).toBeCloseTo(metrics.player!.width, 0);
      expect(metrics.video!.height).toBeCloseTo(metrics.player!.height, 0);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(width + 2);
      await page.screenshot({ path: '.work/verification/studio-live-inpage-' + width + '.png' });
    }
    await page.setViewportSize({ width: 430, height: 760 });
    await expect(panel).toHaveAttribute('data-right-closed', '');
    await expect(panel).toHaveAttribute('data-left-closed', '');
    await expect.poll(async () => (await page.locator('ytd-app').boundingBox())!.width).toBe(390);
    await page.screenshot({ path: '.work/verification/studio-live-inpage-narrow.png' });
    report.checks.narrowFold = true;
    expect(await nativePlayer!.evaluate((node) => node === document.querySelector('#movie_player'))).toBe(true);
    report.checks.nativePlayerParents = {
      before: parentBefore,
      after: await nativePlayer!.evaluate((node) => node.parentElement?.id),
      note: 'YouTube owns native responsive/hydration reparenting; the Studio adapter writes only its stylesheet/root insets.',
    };
    expect(await nativeVideo!.evaluate((node) => node === document.querySelector('#movie_player video'))).toBe(true);
    report.checks.nativeDomMediaPreserved = true;
    await page.setViewportSize({ width: 1366, height: 900 });
    await panel.getByRole('button', { name: 'サイト操作', exact: true }).click();
    const theater = page.locator('#movie_player .ytp-size-button');
    if (await theater.isVisible()) {
      await theater.click();
      await expect(page.locator('ytd-watch-flexy')).toHaveAttribute('theater', '');
      const box = (await page.locator('#movie_player').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(180);
      expect(box.x + box.width).toBeLessThanOrEqual(1046);
      await page.screenshot({ path: '.work/verification/studio-live-inpage-theater.png' });
      await theater.click();
      report.checks.theater = true;
    } else report.checks.theater = { unverified: 'Native theater control not exposed' };
    await page.locator('#movie_player').hover();
    const full = page.locator('#movie_player .ytp-fullscreen-button');
    if (await full.isVisible()) {
      await full.click();
      await expect(panel).toHaveAttribute('data-fullscreen', '');
      await expect(panel).not.toBeVisible();
      await page.screenshot({ path: '.work/verification/studio-live-inpage-fullscreen.png' });
      await page.evaluate(() => document.exitFullscreen());
      await expect(panel).toBeVisible();
      report.checks.fullscreen = true;
    } else report.checks.fullscreen = { unverified: 'Native fullscreen control not exposed' };
    const playerBeforeScroll = (await page.locator('#movie_player').boundingBox())!,
      layerBeforeScroll = (await first.boundingBox())!;
    await page.mouse.move(600, 450);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const playerAfterScroll = (await page.locator('#movie_player').boundingBox())!,
      layerAfterScroll = (await first.boundingBox())!;
    expect(layerAfterScroll.y - layerBeforeScroll.y).toBeCloseTo(playerAfterScroll.y - playerBeforeScroll.y, 0);
    report.checks.scrollPlayerAnchor = true;
    const search = page.locator('ytd-masthead input[name="search_query"], ytd-masthead input#search').first();
    if (await search.isVisible()) {
      await search.fill('Web World Themes');
      await search.press('Enter');
      await expect(page).toHaveURL(/results\?search_query=/);
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible();
      report.checks.searchSpa = true;
    } else report.checks.searchSpa = { unverified: 'Native search field not exposed' };
    await panel.getByRole('button', { name: '編集を終了', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await expect.poll(async () => (await page.locator('ytd-app').boundingBox())!.width).toBeCloseTo(appBefore.width, 0);
    report.checks.exitRestore = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(presentation + ' [data-image-id]')).toHaveCount(3);
    await popup.locator('#creator-studio-inpage').evaluate((button: HTMLButtonElement) => button.click());
    await expect(panel.locator('[data-kind="group"]')).toHaveCount(1);
    await expect(panel.locator('.dirty')).toHaveText('保存済み');
    report.checks.savedReload = true;
    await popup.locator('#effect-strength').fill('0');
    await expect(panel).toHaveCount(0);
    await expect(page.locator(presentation)).toHaveCount(0);
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-inpage-studio', '');
    report.checks.strengthZeroCleanup = true;
    report.completed = true;
  } finally {
    await writeFile('.work/verification/studio-live-inpage.json', JSON.stringify(report, null, 2) + '\n');
    await context.close();
  }
});
