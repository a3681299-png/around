import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver, nativeWindow } from './helpers/side-panel';
import { createTakeSampler, type SignalTake } from '../src/world/takes';
import type { DesignDocument } from '../src/design/types';

test('real YouTube: GIF scroll rule, explicit take recording, ghost projection, replay isolation and reload', async () => {
  test.skip(process.env.WW_LIVE_SIGNAL_TIMELINE !== '1', 'Explicit real YouTube Signal Timeline verification.');
  test.setTimeout(180_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'ww-signal-live-')), false, {
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
    report.checks['stage'] = name;
    console.log('Signal Timeline live: ' + name);
  };
  await mkdir('.work/verification', { recursive: true });
  try {
    report.browser = context.browser()?.version() ?? 'unknown';
    stage('extension');
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const item = manager.locator('extensions-item').filter({ hasText: 'Web World Themes' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    stage('YouTube');
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25_000 });
    await popup.getByRole('switch', { name: '作品を表示する' }).check();
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube');
    stage('open Studio');
    await openSidePanelFromIcon(popup, page);
    const local = page.locator('#web-world-themes-creator');
    stage('side panel');
    const panel = await sidePanelDriver(context, page, id),
      ui = 'document.querySelector("#web-world-themes-creator").shadowRoot';
    stage('import GIF');
    await panel.files([path.resolve('tests/fixtures/motion/petal.gif')], '.animation-file');
    await expect.poll(() => panel.text('.selected-count')).toBe('1個選択中');
    stage('edit rule');
    await panel.click('.timeline-toggle');
    await panel.click('.timeline-connect');
    await expect.poll(() => panel.evaluate(`${ui}.querySelectorAll('.timeline-key').length`)).toBe(3);
    await panel.click('.timeline-delete-key');
    await expect.poll(() => panel.evaluate(`${ui}.querySelectorAll('.timeline-key').length`)).toBe(2);
    const head = await panel.evaluate<{ x: number; y: number }>(
      `(()=>{const r=${ui}.querySelector('.timeline-canvas').getBoundingClientRect();return {x:r.left+28+(r.width-44)*.5,y:r.top+55}})()`,
    );
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: head.x,
      y: head.y,
      button: 'left',
      clickCount: 1,
    });
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: head.x,
      y: head.y,
      button: 'left',
      clickCount: 1,
    });
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.click('.timeline-add-key');
    await expect.poll(() => panel.evaluate(`${ui}.querySelectorAll('.timeline-key').length`)).toBe(3);
    await panel.fill('.timeline-key-value', '100');
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.timeline-key-input').valueAsNumber`))
      .toBeCloseTo(50, 1);
    await panel.click('.take-live');
    await expect.poll(() => panel.text('.take-source')).toBe('LIVE');
    await panel.click('.save');
    await expect.poll(() => panel.text('.dirty')).toBe('保存済み');
    await expect(local).not.toBeVisible();
    report.checks.gifRuleEditedAndSaved = true;
    stage('live scroll');
    const media = page.locator(
      ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations) .media',
    );
    // G1.2 (D9): the pointer rests where the page's links scroll under it, as a person's does while
    // scrolling with the wheel: the left edge of the column below the player (descriptions, comment
    // avatars and links), clear of the GIF. Only a layer over the approached link may yield there;
    // the GIF keeps following the scroll. The record shows which controls passed under the pointer.
    const gif = (await media.first().boundingBox())!;
    const pointer = await page.evaluate((gif) => {
      const below = document.querySelector('ytd-watch-flexy #below')!.getBoundingClientRect(),
        x = below.left + 20,
        clear = (y: number) =>
          x < gif.x - 40 || x > gif.x + gif.width + 40 || y < gif.y - 40 || y > gif.y + gif.height + 40;
      const y = [innerHeight / 2, innerHeight * 0.75, innerHeight * 0.25].find(clear);
      if (y === undefined) throw new Error(`No point clear of the GIF at x=${x}: ${JSON.stringify(gif)}`);
      return { x, y };
    }, gif);
    await page.mouse.move(pointer.x, pointer.y, { steps: 4 });
    const under: unknown[] = [];
    report.checks['pointer'] = { point: pointer, gif, under };
    const verifyScroll = async (progress: number) => {
      await page.evaluate((value) => {
        const root = document.scrollingElement!;
        scrollTo(0, Math.round((root.scrollHeight - root.clientHeight) * value));
      }, progress);
      under.push({
        progress,
        ...(await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y),
            control = hit?.closest('a[href], button, [role="button"], input, [role="slider"]');
          return {
            hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}` : null,
            control: control ? `${control.tagName.toLowerCase()}${control.id ? '#' + control.id : ''}` : null,
          };
        }, pointer)),
      });
      await expect
        .poll(() =>
          media.evaluate((node: HTMLElement) => {
            const root = document.scrollingElement!,
              range = root.scrollHeight - root.clientHeight,
              value = range > 0 ? root.scrollTop / range : 0;
            return Math.abs(Number(node.style.opacity) - (1 - Math.abs(value * 2 - 1)));
          }),
        )
        .toBeLessThan(0.0001)
        .catch(async (error: Error) => {
          // Keep why the opacity did not follow: the guard's record and the scroll it was drawn for.
          report.checks['scrollFailure'] = await media.evaluate((node: HTMLElement, { x, y }) => {
            const root = document.scrollingElement!;
            return {
              // Native controls within the approach rule's 72px of the resting pointer.
              near: [
                ...document.querySelectorAll(
                  'a[href], button, [role="button"], input, textarea, [contenteditable="true"], [role="slider"], [role="dialog"], [role="menu"], tp-yt-paper-dialog, ytd-searchbox, yt-searchbox',
                ),
              ]
                .filter((e) => !e.closest('[id^="web-world-themes"]'))
                .map((e) => ({ e, r: e.getBoundingClientRect() }))
                .filter(
                  ({ r }) =>
                    r.width > 0 && r.height > 0 && Math.max(r.left - x, x - r.right, r.top - y, y - r.bottom) <= 72,
                )
                .slice(0, 8)
                .map(({ e, r }) => ({
                  element: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} ${e.closest('ytd-guide-renderer, ytd-mini-guide-renderer, ytd-masthead, #secondary, #below')?.tagName.toLowerCase() ?? ''}`,
                  rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                })),
              opacity: node.style.opacity,
              scrollTop: root.scrollTop,
              range: root.scrollHeight - root.clientHeight,
              visibility: (node.closest('[data-frame-id]') as HTMLElement | null)?.style.visibility,
              safety: [...document.querySelectorAll('[id^="web-world-themes-"][id$="decorations"]')].map((host) => [
                host.id,
                host.getAttribute('data-ww-safety'),
              ]),
              active: document.activeElement?.tagName,
              // Only a WW_GUARD_TRACE build writes this: why the approach rule turned on or off.
              approach: JSON.parse(document.documentElement.getAttribute('data-ww-guard-approach') ?? 'null'),
            };
          }, pointer);
          throw error;
        });
    };
    for (const progress of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) await verifyScroll(progress);
    for (const progress of [0, 0.5, 1, 0.5, 0]) {
      await page.waitForTimeout(100);
      await verifyScroll(progress);
    }
    report.checks.scrollSpeedAndDirectionIndependent = true;
    stage('record');
    await panel.click('.take-record');
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.signal-timeline').hasAttribute('data-recording')`))
      .toBe(true);
    for (const progress of [0, 0.5, 1, 0.5, 0]) {
      await verifyScroll(progress);
      await page.waitForTimeout(100);
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
    const design = await popup.evaluate(
      async () =>
        (await chrome.storage.local.get('webWorldThemes.design.youtube'))[
          'webWorldThemes.design.youtube'
        ] as DesignDocument,
    );
    expect(design.schemaVersion).toBe(13);
    expect(design).not.toHaveProperty('takes');
    expect(JSON.stringify(take)).not.toMatch(/https?:|cookie|asset-|signalRules|decorations/);
    const middle = take.inputs.find(
      (input) =>
        input.signals.scroll &&
        input.signals.scroll.maxY > 0 &&
        input.signals.scroll.y / input.signals.scroll.maxY > 0.4 &&
        input.signals.scroll.y / input.signals.scroll.maxY < 0.6,
    )!;
    expect(middle).toBeDefined();
    const time = middle.timeMs - take.inputs[0]!.timeMs,
      expected = createTakeSampler(design, take).at(time).frame.layout.layers[0]!.layer.opacity;
    await panel.fill('.take-position', String(time / 1000));
    await expect.poll(() => media.evaluate((node: HTMLElement) => Number(node.style.opacity))).toBeCloseTo(expected, 5);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    await expect.poll(() => media.evaluate((node: HTMLElement) => Number(node.style.opacity))).toBeCloseTo(expected, 5);
    report.checks.liveInputIsolated = true;
    await expect.poll(() => panel.evaluate(`${ui}.querySelectorAll('.take-ghost').length`)).toBeGreaterThan(3);
    report.checks.ghostProjection = true;
    await page.evaluate(() => {
      (window as any).signalPlaybackScrolls = 0;
      addEventListener('scroll', () => {
        (window as any).signalPlaybackScrolls++;
      });
    });
    await panel.fill('.take-rate', '-1');
    await panel.click('.take-play');
    await expect
      .poll(() => panel.evaluate(`${ui}.querySelector('.take-position').valueAsNumber`))
      .toBeLessThan(time / 1000);
    await panel.click('.take-live');
    expect(await page.evaluate(() => (window as any).signalPlaybackScrolls)).toBe(0);
    report.checks.reverseWithoutPageActions = true;
    for (const width of [1366, 1920, 1000]) {
      await nativeWindow(panel.cdp, width);
      await verifyScroll(0.5);
      await page.screenshot({ path: `.work/verification/signal-live-${width}.png` });
    }
    await panel.screenshot('.work/verification/signal-live-take.png');
    await page.reload();
    await expect
      .poll(() => panel.evaluate('document.querySelector(".connection-status").dataset.connected'))
      .toBe('true');
    await expect.poll(() => panel.evaluate(`${ui}.querySelector('.take-library-select').options.length`)).toBe(2);
    await panel.fill('.take-library-select', take.id);
    await expect.poll(() => panel.text('.take-source')).toBe('PREVIEW');
    await panel.fill('.take-position', String(time / 1000));
    await expect.poll(() => media.evaluate((node: HTMLElement) => Number(node.style.opacity))).toBeCloseTo(expected, 5);
    report.checks.savedRuleAndTakeReload = true;
    await panel.click('.take-live');
    await popup.getByRole('switch', { name: '作品を表示する' }).uncheck();
    await expect(
      page.locator(
        ':is(#web-world-themes-decorations, #web-world-themes-video-decorations, #web-world-themes-page-decorations, #web-world-themes-atmosphere-decorations)',
      ),
    ).toHaveCount(0);
    await expect(local).toHaveCount(0);
    report.checks.offCleanup = true;
    report.completed = true;
  } finally {
    if (!report.completed)
      await context
        .pages()
        .find((page) => page.url().startsWith('https://www.youtube.com'))
        ?.screenshot({ path: '.work/verification/signal-live-failure.png', timeout: 3000 })
        .catch(() => undefined);
    await writeFile('.work/verification/signal-live.json', JSON.stringify(report, null, 2));
    await context.close();
  }
});
