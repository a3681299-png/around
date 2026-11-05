import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver, nativeWindow } from './helpers/side-panel';

test('official side panel on real YouTube preserves controls, layout, authoring and resize anchors', async () => {
  test.skip(process.env.WW_LIVE_SIDE_PANEL !== '1', 'Explicit real YouTube + native Chrome UI verification.');
  test.setTimeout(240_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-panel-live-')), false, {
    headed: true,
    width: 1920,
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  const report: { browser?: string; completed: boolean; checks: Record<string, unknown>; geometry: unknown[] } = {
    completed: false,
    checks: {},
    geometry: [],
  };
  await mkdir('.work/verification', { recursive: true });
  try {
    report.browser = context.browser()?.version() ?? 'unknown';
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const page = await context.newPage();
    await page.goto(
      'https://www.youtube.com/watch?v=LC1a-DwUhls&list=RDGMEM0s70dY0afCwh3LqQ-Bx1vgMLC1a-DwUhls&start_radio=1',
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25_000 });
    await showArtwork(popup);
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    await page.bringToFront();
    await openSidePanelFromIcon(popup, page);
    const local = page.locator('#web-world-themes-creator');
    const panel = await sidePanelDriver(context, page, id);
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).wwResizeCount = 0;
      window.addEventListener('resize', () => {
        (window as any).wwResizeCount++;
      });
    });
    await expect
      .poll(() =>
        panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".add-image").disabled',
        ),
      )
      .toBe(false);
    await panel.files(Array(3).fill(path.resolve('tests/fixtures/motion/petal.png')));
    await expect
      .poll(
        async () => ({
          images: await page
            .locator(
              ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) [data-image-id]',
            )
            .count(),
          status: await panel.text('.status'),
          connection: await panel.evaluate('document.querySelector(".connection-status").textContent'),
        }),
        { timeout: 10_000 },
      )
      .toMatchObject({ images: 3 });
    await panel.fill('[data-image-prop="anchor"]', 'video-player');
    // Keep all children on the same anchor, using the existing property command.
    const rowIds = await panel.evaluate<string[]>(
      'Array.from(document.querySelector("#web-world-themes-creator").shadowRoot.querySelectorAll(".layer")).map(n=>n.dataset.layerId)',
    );
    for (const rowId of rowIds) {
      await panel.click(`.layer[data-layer-id="${rowId}"] [data-action="select"]`);
      await panel.fill('[data-image-prop="anchor"]', 'video-player');
    }
    await panel.click('.select-all');
    await expect.poll(() => panel.text('.selected-count')).toBe('3個選択中');
    await expect
      .poll(async () => ({
        disabled: await panel.evaluate(
          'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector(".group-layers").disabled',
        ),
        reason: await panel.text('.grouping-help'),
      }))
      .toMatchObject({ disabled: false });
    await panel.click('.group-layers');
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    await panel.click('[data-effect="enabled"]');
    await panel.fill('[data-effect="radiusPx"]', '220');
    if (
      !(await panel.evaluate(
        'document.querySelector("#web-world-themes-creator").shadowRoot.querySelector("[data-effect=pointer]").checked',
      ))
    )
      await panel.click('[data-effect="pointer"]');
    const mask = page.locator(
      ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .group-content',
    );
    await expect(mask).toHaveCSS('mask-image', /radial-gradient/);
    await page.mouse.move(300, 280);
    const beforeMask = await mask.evaluate((node: HTMLElement) => node.style.maskImage);
    await page.mouse.move(350, 300);
    await expect.poll(() => mask.evaluate((node: HTMLElement) => node.style.maskImage)).not.toBe(beforeMask);
    report.checks.pointerMask = true;
    await panel.click('[data-effect="video"]');
    await panel.fill('[data-effect="fadeMs"]', '120');
    await expect(local).not.toBeVisible();
    await panel.click('[data-tool="browse"]');
    report.checks.noDuplicateToolbar = true;
    async function measure(label: string) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('#movie_player').hover();
      await expect(page.locator('#movie_player .ytp-fullscreen-button')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const n = document.querySelector('#movie_player .ytp-fullscreen-button')!,
              r = n.getBoundingClientRect(),
              hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return hit === n || (!!hit && n.contains(hit));
          }),
        )
        .toBe(true);
      const metrics = await page.evaluate((label) => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : undefined;
        };
        const controls = ['.ytp-play-button', '.ytp-settings-button', '.ytp-size-button', '.ytp-fullscreen-button'].map(
          (selector) => {
            const n = document.querySelector('#movie_player ' + selector)!,
              r = n.getBoundingClientRect(),
              hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { selector, rect: rect('#movie_player ' + selector), hit: hit === n || (!!hit && n.contains(hit)) };
          },
        );
        return {
          label,
          innerWidth,
          outerWidth,
          innerHeight,
          resizeCount: (window as any).wwResizeCount,
          player: rect('#movie_player'),
          primary: rect('ytd-watch-flexy #primary'),
          secondary: rect('ytd-watch-flexy #secondary'),
          app: rect('ytd-app'),
          controls,
        };
      }, label);
      report.geometry.push(metrics);
      expect(metrics.controls.every((control) => control.hit)).toBe(true);
      const p = metrics.player!,
        s = metrics.secondary!;
      if (s.width > 0 && s.y < p.bottom - 1.1 && s.bottom > p.y + 1.1) expect(p.right).toBeLessThanOrEqual(s.x + 1);
      expect(p.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
      await page.screenshot({ path: `.work/verification/sidepanel-live-${label}.png` });
      await panel.screenshot(`.work/verification/sidepanel-live-inspector-${label}.png`);
      return metrics;
    }
    for (const width of [1366, 1920, 1000]) {
      await nativeWindow(panel.cdp, width);
      await measure(String(width));
    }
    report.checks.nativePanelResize =
      'not run: manual native panel divider drag; native window resize is tested automatically';
    await nativeWindow(panel.cdp, 1920);
    const beforeResize = await measure('before-resize');
    if (process.env.WW_NATIVE_RESIZE === '1') {
      await writeFile(
        '.work/verification/sidepanel-manual-ready.json',
        JSON.stringify({ title: await page.title(), metrics: beforeResize }),
      );
      await expect
        .poll(
          async () => {
            try {
              await access('.work/verification/sidepanel-resize.done');
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 120_000 },
        )
        .toBe(true);
      const after = await measure('after-resize');
      expect(after.innerWidth).not.toBe(beforeResize.innerWidth);
      report.checks.nativePanelResize = { before: beforeResize.innerWidth, after: after.innerWidth };
    }
    const player = page.locator('#movie_player'),
      video = player.locator('video').first();
    await video.evaluate((node: HTMLVideoElement) => {
      node.muted = true;
    });
    await player.locator('.ytp-play-button').click();
    const playing = await video.evaluate(async (node: HTMLVideoElement) => {
      try {
        await Promise.race([
          node.play(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('buffering')), 4000)),
        ]);
        return !node.paused && node.readyState >= 2;
      } catch {
        return false;
      }
    });
    if (playing) {
      await expect.poll(async () => Number(await mask.getAttribute('data-mask-intensity'))).toBeGreaterThan(0.95);
      await player.locator('.ytp-play-button').click();
      await expect.poll(async () => Number(await mask.getAttribute('data-mask-intensity'))).toBeLessThan(0.01);
      report.checks.nativePauseAndFade = true;
    } else report.checks.nativePauseAndFade = 'unverified: media not playable in this run';
    await player.hover();
    await player.locator('.ytp-settings-button').click();
    await expect(player.locator('.ytp-settings-menu')).toBeVisible();
    await player.locator('.ytp-settings-button').click();
    report.checks.settingsClick = true;
    await player.locator('.ytp-size-button').click();
    await expect(page.locator('ytd-watch-flexy')).toHaveAttribute('theater', '');
    await measure('theater');
    await player.locator('.ytp-size-button').click();
    report.checks.theater = true;
    await player.hover();
    await player.locator('.ytp-fullscreen-button').click();
    await expect(local).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    // UI0-d round 3: no page toolbar exists to step aside in fullscreen; nothing of the editor is
    // on the page.
    await expect(local).toHaveCount(0);
    report.checks.fullscreen = true;
    const first = page
        .locator(
          ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) [data-image-id]',
        )
        .first(),
      prior = (await first.boundingBox())!,
      playerPrior = (await player.boundingBox())!;
    await page.mouse.move(400, 350);
    await page.mouse.wheel(0, 220);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const next = (await first.boundingBox())!,
      playerNext = (await player.boundingBox())!;
    expect(next.y - prior.y).toBeCloseTo(playerNext.y - playerPrior.y, 0);
    report.checks.scrollAnchor = true;
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await page.reload();
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) [data-image-id]',
      ),
    ).toHaveCount(3);
    report.checks.savedReload = true;
    const search = page.locator('ytd-masthead input[name="search_query"], ytd-masthead input#search').first();
    await search.fill('Web World Themes');
    await search.press('Enter');
    await expect(page).toHaveURL(/results\?search_query=/);
    await expect.poll(() => panel.text('.layer-count')).toContain('グループ1');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(player).toBeVisible();
    report.checks.spa = true;
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(local).toHaveCount(0);
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      ),
    ).toHaveCount(0);
    await expect(page.locator('#web-world-themes-studio-layout')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ww-editing', '');
    report.checks.strengthZeroCleanup = true;
    report.completed = true;
  } finally {
    await writeFile('.work/verification/sidepanel-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
