import { modelPoseError } from './helpers/model-assertions';
import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { nativeWindow, sidePanelDriver } from './helpers/side-panel';
import { modelFixture } from './helpers/model-fixture';
import { createTakeSampler, type SignalTake } from '../src/world/takes';
import type { DesignDocument } from '../src/design/types';
import type { ModelEvaluation } from '../src/world/models';

test('real YouTube: official Studio places a rig, switches run/idle, replays model poses and preserves native video modes', async () => {
  test.skip(process.env.WW_LIVE_3D !== '1', 'Explicit real YouTube 3D verification.');
  test.setTimeout(180000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-3d-live-')), false, {
    headed: true,
    width: 1920,
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const report: { completed: boolean; checks: Record<string, unknown> } = { completed: false, checks: {} };
  const stage = (name: string) => {
    report.checks.stage = name;
    console.log('3D live: ' + name);
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
    await writeFile('.work/verification/live-rig.glb', modelFixture());
    await panel.files([path.resolve('.work/verification/live-rig.glb')], '.model-file');
    const media = page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .model-media',
      ),
      image = page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .image',
      );
    await expect(media).toHaveAttribute('data-renderer', 'three', { timeout: 25000 });
    stage('settings');
    await panel.fill('[data-image-prop="anchor"]', 'video-player');
    for (const [key, value] of [
      ['idle', '0'],
      ['walk', '1'],
      ['run', '2'],
    ])
      await panel.fill(`[data-model="locomotion.${key}"]`, value!);
    await panel.click('[data-model="locomotion.enabled"]');
    await panel.click('[data-motion="enabled"]');
    await panel.fill('[data-motion="maxSpeed"]', '500');
    await panel.fill('[data-motion="lagMs"]', '100');
    await panel.fill('[data-motion="stopRadius"]', '40');
    await panel.click('.model-look > summary');
    await panel.fill('[data-model="look.bone"]', '3');
    await panel.click('[data-model="look.enabled"]');
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
      model: { locomotion: { idle: 0, walk: 1, run: 2 }, look: { enabled: true, bone: 3 } },
    });
    const pose = () => media.evaluate((m: HTMLElement) => JSON.parse(m.dataset.modelFrame!) as ModelEvaluation),
      point = () => image.evaluate((e: HTMLElement) => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
    stage('pursuit');
    const width = await page.evaluate(() => innerWidth),
      target = { x: width * 0.75, y: 400 };
    await page.mouse.move(target.x, target.y);
    await expect.poll(async () => (await pose()).phase).toBe('run');
    await expect.poll(async () => (await pose()).phase, { timeout: 10000 }).toBe('idle');
    expect(Math.abs(Math.hypot((await point()).x - target.x, (await point()).y - target.y) - 40)).toBeLessThan(0.2);
    report.checks.runStopIdle = true;
    stage('take');
    await panel.click('.timeline-toggle');
    await panel.click('.take-record');
    const ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.signal-timeline').hasAttribute('data-recording')`))
      .toBe(true);
    for (const [x, y] of [
      [width * 0.3, 300],
      [width * 0.7, 500],
      [width * 0.4, 400],
    ]) {
      await page.mouse.move(x!, y!, { steps: 10 });
      await page.waitForTimeout(150);
    }
    await panel.click('.take-stop');
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.click('.take-store');
    await expect.poll(() => panel.text('.take-saved')).toBe('テイク保存済み');
    const take = await panel.evaluate<SignalTake>(
      'chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"list",siteId:"youtube"}).then(r=>chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"get",siteId:"youtube",id:r.value[0].id})).then(r=>r.value)',
    );
    const at = take.inputs[Math.floor(take.inputs.length / 2)]!.timeMs - take.inputs[0]!.timeMs,
      expected = createTakeSampler(saved, take).at(at).frame.models![0]!;
    await panel.fill('.take-position', String(at / 1000));
    await expect.poll(async () => modelPoseError(await pose(), expected)).toBeLessThan(1e-9);
    const held = await pose();
    await page.mouse.move(width * 0.9, 600);
    await page.waitForTimeout(100);
    expect(await pose()).toEqual(held);
    report.checks.exactModelPoseSeekAndLiveIsolation = true;
    await page.screenshot({ path: '.work/verification/3d-live-youtube.png' });
    await panel.screenshot('.work/verification/3d-live-sidepanel.png');
    stage('reload');
    await page.reload();
    await expect
      .poll(
        async () => {
          const status = await panel.evaluate<{ connected: string; text: string }>(
            '({connected:document.querySelector(".connection-status").dataset.connected,text:document.querySelector(".connection-status").textContent})',
          );
          report.checks.reconnectStatus = status;
          return status.connected;
        },
        { timeout: 30000 },
      )
      .toBe('true');
    await expect(media).toHaveAttribute('data-renderer', 'three');
    report.checks.savedReloadAndReconnect = true;
    await panel.fill('.take-library-select', take.id);
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.fill('.take-position', String(at / 1000));
    await expect.poll(async () => modelPoseError(await pose(), expected)).toBeLessThan(1e-9);
    await panel.click('.take-live');
    await panel.click('[data-tool="browse"]');
    stage('native controls');
    for (const size of [1366, 1920, 1000]) {
      await nativeWindow(panel.cdp, size);
      await page.waitForTimeout(100);
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
    await expect(media).toHaveAttribute('data-playback', /playing|paused/);
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
      (globalThis as { testDocumentToken?: number }).testDocumentToken = 73;
    });
    await page.locator('a#logo').first().click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(player).toBeVisible();
    await expect(media).toBeVisible();
    expect(await page.evaluate(() => (globalThis as { testDocumentToken?: number }).testDocumentToken)).toBe(73);
    report.checks.spaDocumentPreserved = true;
    report.checks.modelStats = await page
      .locator('#web-world-themes-decorations')
      .evaluate((e: HTMLElement) => JSON.parse(e.dataset.wwModelStats!));
    await popup.locator('#effect-strength').fill('0');
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      ),
    ).toHaveCount(0);
    report.checks.zeroCleanup = true;
    report.completed = true;
  } finally {
    await writeFile('.work/verification/3d-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
