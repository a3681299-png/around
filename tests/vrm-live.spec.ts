import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { nativeWindow, sidePanelDriver } from './helpers/side-panel';
import type { DesignDocument } from '../src/design/types';

test('real YouTube: private local VRM import, MToon, pointer gaze, Studio transforms, save/reload and OFF', async () => {
  test.skip(
    !process.env.WW_VRM_FILE || process.env.WW_LIVE_VRM !== '1',
    'Explicit local-avatar and real YouTube verification; no avatar is bundled.',
  );
  test.setTimeout(240000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-vrm-live-')), false, {
    headed: true,
    width: 1920,
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const report: { completed: boolean; checks: Record<string, unknown> } = { completed: false, checks: {} };
  const stage = (name: string) => {
    report.checks.stage = name;
    console.log('VRM live: ' + name);
  };
  await mkdir('.work/verification', { recursive: true });
  try {
    stage('open');
    report.checks.browser = context.browser()?.version();
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((e) => (e as HTMLElement & { data?: { id: string } }).data?.id ?? e.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25000 });
    await popup.getByRole('switch', { name: 'Theme ON / OFF' }).check();
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-ww-theme', 'retro');
    await popup.locator('#creator-studio-inpage').evaluate((b: HTMLButtonElement) => b.click());
    const local = page.locator('#web-world-themes-creator');
    await local.getByRole('button', { name: 'Chromeサイドパネルを開く', exact: true }).click();
    const panel = await sidePanelDriver(context, page, id);
    stage('import private avatar');
    const started = Date.now();
    await panel.files([path.resolve(process.env.WW_VRM_FILE!)], '.model-file');
    const media = page.locator('#web-world-themes-decorations .model-media'),
      image = page.locator('#web-world-themes-decorations [data-image-id]');
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 100000 });
    report.checks.importAndFirstPaintMs = Date.now() - started;
    await expect(media).toHaveAttribute('data-format', 'vrm');
    const pose = () => media.evaluate((e: HTMLElement) => JSON.parse(e.dataset.vrmPose!)),
      frame = () => media.evaluate((e: HTMLElement) => JSON.parse(e.dataset.modelFrame!));
    stage('transform and gaze');
    await panel.fill('[data-image-prop="widthPx"]', '440');
    await panel.fill('[data-image-prop="heightPx"]', '520');
    await panel.fill('[data-model="rotationY"]', '15');
    await panel.fill('[data-image-prop="anchor"]', 'video-player');
    const width = await page.evaluate(() => innerWidth);
    await page.mouse.move(80, 400);
    await expect.poll(async () => (await frame()).lookYaw).toBeLessThan(-5);
    const left = await pose();
    await page.mouse.move(width - 80, 300);
    await expect.poll(async () => (await frame()).lookYaw).toBeGreaterThan(5);
    const right = await pose();
    expect(right.head).not.toEqual(left.head);
    expect(right.eyes).not.toEqual(left.eyes);
    report.checks.actualHumanoidHeadAndEyesRespond = true;
    const alpha = await media.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let n = 3; n < d.length; n += 4) if (d[n]) painted++;
      return { corner: d[3], painted };
    });
    expect(alpha.corner).toBe(0);
    expect(alpha.painted).toBeGreaterThan(1000);
    report.checks.alpha = alpha;
    stage('expression and save');
    const ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    const expression = await panel.evaluate<string>(
      `${ui}.querySelector('.vrm-expression option[value="happy"]')?.value || ${ui}.querySelector('.vrm-expression option')?.value`,
    );
    if (expression) {
      await panel.fill('.vrm-expression', expression);
      await panel.fill('.vrm-weight', '.5');
      await expect.poll(async () => (await pose()).expressions[expression]).toBe(0.5);
    }
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    const saved = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
    expect(saved.decorations[0]).toMatchObject({
      kind: 'model3d',
      source: { format: 'vrm' },
      model: { rotationY: 15, look: { enabled: true } },
    });
    report.checks.source =
      saved.decorations[0]?.kind === 'model3d'
        ? {
            format: saved.decorations[0].source.format,
            version: saved.decorations[0].source.vrm?.version,
            bones: saved.decorations[0].source.bones.length,
            humanoid: saved.decorations[0].source.vrm?.humanoid.length,
            expressions: saved.decorations[0].source.vrm?.expressions.length,
            mtoon: saved.decorations[0].source.vrm?.mtoon,
            springBone: saved.decorations[0].source.vrm?.springBone,
          }
        : null;
    // Private-avatar screenshots stay in ignored local verification output.
    await page.screenshot({ path: '.work/verification/vrm-live-youtube.png' });
    await panel.screenshot('.work/verification/vrm-live-sidepanel.png');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]),
      );
    const before = await metrics(),
      measureStart = Date.now();
    await page.waitForTimeout(5000);
    const after = await metrics();
    report.checks.performanceSample = {
      durationMs: Date.now() - measureStart,
      pageTaskCpuPercentOfOneCore:
        ((after.TaskDuration! - before.TaskDuration!) / (after.Timestamp! - before.Timestamp!)) * 100,
      jsHeapUsedBytes: after.JSHeapUsedSize,
      nativeBase64: await page.evaluate(
        () => typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 === 'function',
      ),
    };
    report.checks.renderStats = await page
      .locator('#web-world-themes-decorations')
      .evaluate((e: HTMLElement) => JSON.parse(e.dataset.wwModelStats!));
    report.checks.youtubePlayback = await playerState();
    async function playerState() {
      return page.locator('#movie_player').evaluate((p) => {
        const video = p.querySelector('video');
        return {
          readyState: video?.readyState,
          paused: video?.paused,
          error: video?.error?.code ?? null,
          message: p.querySelector('.ytp-error-content-wrap')?.textContent?.trim().slice(0, 200) ?? '',
        };
      });
    }
    stage('reload');
    await page.reload();
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status").dataset.connected'), { timeout: 30000 })
      .toBe('true');
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 60000 });
    report.checks.savedReloadAndReconnect = true;
    await panel.click('[data-tool="browse"]');
    expect(await image.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    stage('native controls and layout');
    for (const size of [1366, 1920, 1000]) {
      await nativeWindow(panel.cdp, size);
      await page.waitForTimeout(150);
      const player = page.locator('#movie_player');
      await player.hover();
      await player.locator('.ytp-settings-button').click();
      await expect(player.locator('.ytp-settings-menu')).toBeVisible();
      await player.locator('.ytp-settings-button').click();
    }
    report.checks.widthsAndNativeSettingsClicks = [1366, 1920, 1000];
    await nativeWindow(panel.cdp, 1920);
    const player = page.locator('#movie_player');
    await player.hover();
    await player.locator('.ytp-size-button').click();
    await expect(page.locator('ytd-watch-flexy')).toHaveAttribute('theater', '');
    await expect(media).toBeVisible();
    await player.locator('.ytp-size-button').click();
    report.checks.theater = true;
    await player.hover();
    await player.locator('.ytp-fullscreen-button').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(media).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
    report.checks.fullscreen = true;
    await page.evaluate(() => scrollBy(0, 300));
    await expect(media).toHaveAttribute('data-renderer', 'three');
    report.checks.scroll = true;
    stage('SPA');
    await page.evaluate(() => {
      (globalThis as { vrmDocumentToken?: number }).vrmDocumentToken = 31;
    });
    await page.locator('a#logo').first().click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(player).toBeVisible();
    await expect(media).toBeVisible();
    expect(await page.evaluate(() => (globalThis as { vrmDocumentToken?: number }).vrmDocumentToken)).toBe(31);
    report.checks.spaDocumentPreserved = true;
    await popup.locator('#effect-strength').fill('0');
    await expect(page.locator('#web-world-themes-decorations')).toHaveCount(0);
    report.checks.zeroCleanup = true;
    report.completed = true;
  } finally {
    await writeFile('.work/verification/vrm-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
