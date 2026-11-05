import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { nativeWindow, sidePanelDriver } from './helpers/side-panel';
import { declinePromotion } from './helpers/youtube-live';
import { createTakeSampler, type SignalTake } from '../src/world/takes';
import type { DesignDocument } from '../src/design/types';

test('real YouTube: official Studio configures GIF pursuit, records/replays/loads motion and preserves native controls', async () => {
  test.skip(process.env.WW_LIVE_SIGNAL_MOTION !== '1', 'Explicit real YouTube v2 verification.');
  test.setTimeout(180_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-motion-live-')), false, {
    headed: true,
    width: 1920,
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  const report: { completed: boolean; browser?: string; checks: Record<string, unknown> } = {
    completed: false,
    checks: {},
  };
  const stage = (name: string) => {
    report.checks.stage = name;
    console.log('Signal Motion live: ' + name);
  };
  await mkdir('.work/verification', { recursive: true });
  try {
    report.browser = context.browser()?.version() ?? 'unknown';
    stage('launch');
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25_000 });
    await showArtwork(popup);
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    await openSidePanelFromIcon(popup, page);
    const local = page.locator('#web-world-themes-creator');
    const panel = await sidePanelDriver(context, page, id),
      ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    stage('GIF pursuit');
    await panel.files([path.resolve('tests/fixtures/motion/petal.gif')], '.animation-file');
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.fill('[data-image-prop="anchor"]', 'video-player');
    await panel.click('[data-motion="enabled"]');
    await panel.fill('[data-motion="maxSpeed"]', '360');
    await panel.fill('[data-motion="lagMs"]', '150');
    await panel.fill('[data-motion="stopRadius"]', '36');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    const design = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
    expect(design.decorations[0]!.motion).toMatchObject({
      maxSpeed: 360,
      lagMs: 150,
      stopRadius: 36,
      orientToMovement: true,
    });
    const image = page.locator(
      ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .image',
    );
    // Screen coordinates: style.left/top are exact CSS values relative to the paint container
    // holding the layer (the player for the player-local plane), so add that container's origin.
    const point = () =>
      image.evaluate((node: HTMLElement) => {
        const origin = node.parentElement!.getBoundingClientRect();
        return {
          x: Number.parseFloat(node.style.left) + origin.left,
          y: Number.parseFloat(node.style.top) + origin.top,
          transform: node.style.transform,
        };
      });
    const width = await page.evaluate(() => innerWidth),
      target = { x: Math.round(width * 0.65), y: 300 },
      initial = await point();
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(80);
    const delayed = await point();
    expect(Math.hypot(delayed.x - initial.x, delayed.y - initial.y)).toBeLessThan(150);
    await expect
      .poll(
        async () => {
          const p = await point();
          return Math.abs(Math.hypot(p.x - target.x, p.y - target.y) - 36);
        },
        { timeout: 9000 },
      )
      .toBeLessThan(0.2);
    expect((await point()).transform).not.toContain('rotate(0deg)');
    report.checks.delayedPursuitStopAndHeading = true;
    stage('record');
    await panel.click('.timeline-toggle');
    await panel.click('.take-record');
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.signal-timeline').hasAttribute('data-recording')`))
      .toBe(true);
    for (const point of [
      [0.35, 350],
      [0.6, 470],
      [0.4, 550],
      [0.65, 320],
      [0.45, 400],
    ]) {
      await page.mouse.move(width * point[0]!, point[1]!, { steps: 10 });
      await page.waitForTimeout(130);
    }
    await panel.click('.take-stop');
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.click('.take-store');
    await expect.poll(() => panel.text('.take-saved')).toBe('テイク保存済み');
    const library = await panel.evaluate<{ id: string }[]>(
      'chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"list",siteId:"youtube"}).then(r=>r.value)',
    );
    const take = await panel.evaluate<SignalTake>(
      `chrome.runtime.sendMessage({type:"web-world-themes:signal-takes",action:"get",siteId:"youtube",id:${JSON.stringify(library[0]!.id)}}).then(r=>r.value)`,
    );
    expect(take.inputs.length).toBeGreaterThan(20);
    expect(JSON.stringify(take)).not.toMatch(/https?:|cookie|authorization|asset-|decorations|signalRules/);
    const sample = take.inputs[Math.floor(take.inputs.length / 2)]!,
      at = sample.timeMs - take.inputs[0]!.timeMs,
      expected = createTakeSampler(design, take).at(at).frame.layout.layers[0]!;
    await panel.fill('.take-position', String(at / 1000));
    await expect.poll(async () => Math.abs((await point()).x - expected.localPosition!.x)).toBeLessThan(0.01);
    await expect.poll(async () => Math.abs((await point()).y - expected.localPosition!.y)).toBeLessThan(0.01);
    report.checks.cssNumericErrorPx = Math.max(
      Math.abs((await point()).x - expected.localPosition!.x),
      Math.abs((await point()).y - expected.localPosition!.y),
    );
    const paused = await point();
    await page.mouse.move(width * 0.8, 650);
    await page.waitForTimeout(100);
    expect(await point()).toEqual(paused);
    report.checks.takeReplayAndLiveIsolation = true;
    expect(await panel.evaluate(`${ui}.querySelectorAll('.take-pointer-x,.take-pointer-y').length`)).toBe(2);
    await panel.screenshot('.work/verification/signal-motion-live-take.png');
    await page.screenshot({ path: '.work/verification/signal-motion-live-youtube.png' });
    stage('reload');
    await page.reload();
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status").dataset.connected'))
      .toBe('true')
      .catch(async (error: Error) => {
        // Observe after a failure without turning a late connection into a passing assertion.
        const start = Date.now();
        const samples: { ms: number; connected: string; message: string }[] = [];
        try {
          while (Date.now() - start < 20_000) {
            const status = await panel.evaluate<{ connected: string; message: string }>(
              `(() => { const n = document.querySelector('.connection-status'); return { connected: n.dataset.connected, message: n.textContent }; })()`,
            );
            samples.push({ ms: Date.now() - start, ...status });
            if (status.connected === 'true') break;
            await page.waitForTimeout(500);
          }
        } catch (diagnosticError) {
          report.checks.reconnectDiagnosticError = String(diagnosticError);
        }
        report.checks.reconnectAfterFailure = samples;
        throw error;
      });
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
    await expect.poll(point).toEqual(paused);
    report.checks.savedReload = true;
    await panel.click('.take-live');
    await panel.click('[data-tool="browse"]');
    stage('resize and native controls');
    for (const size of [1366, 1920, 1000]) {
      await nativeWindow(panel.cdp, size);
      await page.waitForTimeout(100);
      // Aim inside the coverable video centre, as far as possible from the control bands and
      // any visible native control (e.g. the large play button of a paused video). Near those
      // the G1 approach rule correctly holds the layer, so a fixed point is not a fair target.
      // The aim is also well beyond the stop radius from where the layer rests now; a layer
      // already inside the radius correctly stays where it is.
      const from = await point();
      const aim = await page.locator('#movie_player').evaluate((player, from) => {
        const r = player.getBoundingClientRect();
        const controls = [...document.querySelectorAll('button, a[href], [role="button"], [role="slider"], input')]
          .filter((e) => !e.closest('[id^="web-world-themes"]') && getComputedStyle(e).visibility !== 'hidden')
          .map((e) => e.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.height > 0);
        const gap = (x: number, y: number) =>
          Math.min(
            y - (r.top + 64),
            r.bottom - 112 - y,
            ...controls.map((b) => Math.max(b.left - x, x - b.right, b.top - y, y - b.bottom)),
          );
        let best = { x: r.left + r.width / 2, y: r.top + 64 + (r.height - 176) / 2 };
        for (let i = 1; i < 10; i++)
          for (let j = 1; j < 10; j++) {
            const x = r.left + (r.width * i) / 10,
              y = r.top + 64 + ((r.height - 176) * j) / 10;
            if (Math.hypot(x - from.x, y - from.y) < 120) continue;
            if (gap(x, y) > gap(best.x, best.y) || Math.hypot(best.x - from.x, best.y - from.y) < 120) best = { x, y };
          }
        return best;
      }, from);
      await page.mouse.move(aim.x, aim.y);
      await expect
        .poll(
          async () => {
            // Declining clicks the dialog, which moves the pointer; aim again afterwards.
            if (await declinePromotion(page)) await page.mouse.move(aim.x, aim.y);
            const p = await point();
            return Math.abs(Math.hypot(p.x - aim.x, p.y - aim.y) - 36);
          },
          { timeout: 9000 },
        )
        .toBeLessThan(0.2);
      const player = page.locator('#movie_player');
      await player.hover();
      await player.locator('.ytp-settings-button').click();
      await expect(player.locator('.ytp-settings-menu')).toBeVisible();
      await player.locator('.ytp-settings-button').click();
    }
    report.checks.windowWidthsAndSettingsClicks = [1366, 1920, 1000];
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      ),
    ).toHaveCount(0);
    await expect(local).toHaveCount(0);
    report.checks.zeroCleanup = true;
    report.completed = true;
  } finally {
    if (!report.completed)
      await context
        .pages()
        .find((page) => page.url().startsWith('https://www.youtube.com'))
        ?.screenshot({ path: '.work/verification/signal-motion-live-failure.png', timeout: 3000 })
        .catch(() => undefined);
    await writeFile('.work/verification/signal-motion-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
