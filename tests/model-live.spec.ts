import { modelPoseError } from './helpers/model-assertions';
import { showArtwork } from './helpers/artwork';
import { declinePromotion } from './helpers/youtube-live';
import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { nativeWindow, sidePanelDriver } from './helpers/side-panel';
import { enterNativeTheater } from './helpers/youtube-theater';
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
    await showArtwork(popup);
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    await openSidePanelFromIcon(popup, page);
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
      // Screen coordinates: style.left/top are exact CSS values relative to the paint container
      // holding the layer (the player for the player-local plane), so add that container's origin.
      point = () =>
        image.evaluate((e: HTMLElement) => {
          const origin = e.parentElement!.getBoundingClientRect();
          return { x: parseFloat(e.style.left) + origin.left, y: parseFloat(e.style.top) + origin.top };
        });
    stage('pursuit');
    const width = await page.evaluate(() => innerWidth),
      target = { x: width * 0.75, y: 400 };
    // Start from a known rest half a window away: earlier panel clicks already moved the
    // pointer, and a rig that walked there could reach a nearby target without running.
    const rest = { x: width * 0.25, y: 400 };
    // A promotion dialog stops painting; declining it moves the pointer, so aim again.
    const phaseAt = async (aim: { x: number; y: number }) => {
      if (await declinePromotion(page)) await page.mouse.move(aim.x, aim.y);
      return (await pose()).phase;
    };
    await page.mouse.move(rest.x, rest.y);
    await expect.poll(() => phaseAt(rest), { timeout: 15000 }).toBe('idle');
    await page.mouse.move(target.x, target.y);
    await expect
      .poll(() => phaseAt(target))
      .toBe('run')
      .catch(async (error: Error) => {
        // Keep the protection state and rig position for live failures that do not reproduce alone.
        const state = {
          rest,
          target,
          rig: await point(),
          pose: await pose(),
          safety: await page.locator('#web-world-themes-decorations').getAttribute('data-ww-safety'),
        };
        throw new Error(`${error.message}${String.fromCharCode(10)}Pursuit state: ${JSON.stringify(state)}`);
      });
    await expect.poll(() => phaseAt(target), { timeout: 10000 }).toBe('idle');
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
    // Same load allowance as the first placement; a promotion dialog would stop painting.
    await expect
      .poll(
        async () => {
          await declinePromotion(page);
          return media.getAttribute('data-renderer');
        },
        { timeout: 25000 },
      )
      .toBe('three');
    report.checks.savedReloadAndReconnect = true;
    // A take can only be chosen once the reconnected page has listed it again.
    await expect
      .poll(() =>
        panel.evaluate(
          `(() => { const s = ${ui}.querySelector('.take-library-select'); return !s.disabled && [...s.options].some((o) => o.value === ${JSON.stringify(take.id)}); })()`,
        ),
      )
      .toBe(true);
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
    const leaveTheater = await enterNativeTheater(page);
    await expect(media).toHaveAttribute('data-playback', /playing|paused/);
    await leaveTheater();
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
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      ),
    ).toHaveCount(0);
    report.checks.zeroCleanup = true;
    report.completed = true;
  } finally {
    if (!report.completed) {
      const yt = context.pages().find((p) => p.url().startsWith('https://www.youtube.com'));
      report.checks.diag = await yt
        ?.evaluate(() => ({
          safety: (document.querySelector('#web-world-themes-decorations') as HTMLElement | null)?.dataset.wwSafety,
          dialogs: [...document.querySelectorAll('tp-yt-paper-dialog, [role="dialog"]')]
            .filter((e) => e.getBoundingClientRect().height > 0)
            .map((e) => (e as HTMLElement).innerText.slice(0, 80)),
          media: [...document.querySelectorAll('*')]
            .flatMap((e) => (e.shadowRoot ? [...e.shadowRoot.querySelectorAll('.model-media')] : []))
            .map((m) => JSON.stringify((m as HTMLElement).dataset).slice(0, 300)),
          hidden: document.hidden,
          safetyRecord: (document.querySelector('#web-world-themes-decorations') as HTMLElement | null)?.dataset
            .wwSafety,
          menus: [
            ...document.querySelectorAll(
              '.ytp-popup, .ytp-settings-menu, ytd-menu-popup-renderer, tp-yt-paper-dialog, [role="menu"], [role="dialog"], [role="listbox"], select',
            ),
          ]
            .filter(
              (e) =>
                e.getBoundingClientRect().height > 0 &&
                getComputedStyle(e).visibility !== 'hidden' &&
                !e.closest('[id^="web-world-themes"]'),
            )
            .map(
              (e) =>
                e.tagName + '.' + String(e.className).slice(0, 40) + ' ' + JSON.stringify(e.getBoundingClientRect()),
            ),
          focus: document.hasFocus(),
        }))
        .catch((e) => String(e));
      await yt?.screenshot({ path: '.work/verification/3d-live-failure.png', timeout: 3000 }).catch(() => undefined);
    }
    await writeFile('.work/verification/3d-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
