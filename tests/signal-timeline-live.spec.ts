import { test, expect } from '@playwright/test';
import { showArtwork } from './helpers/artwork';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchExtension } from './fixtures';
import { openSidePanelFromIcon } from './helpers/editor';
import { sidePanelDriver, nativeWindow } from './helpers/side-panel';
import { createTakeSampler, type SignalTake } from '../src/world/takes';
import type { DesignDocument } from '../src/design/types';

test('real YouTube: GIF scroll rule, explicit take recording, ghost projection, replay isolation and reload', async () => {
  test.skip(process.env.AROUND_LIVE_SIGNAL_TIMELINE !== '1', 'Explicit real YouTube Signal Timeline verification.');
  test.setTimeout(180_000);
  const context = await launchExtension(await mkdtemp(path.join(tmpdir(), 'around-signal-live-')), false, {
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
    const item = manager.locator('extensions-item').filter({ hasText: 'Around' });
    await item.waitFor();
    const id = await item.evaluate((node) => (node as HTMLElement & { data?: { id: string } }).data?.id ?? node.id);
    await manager.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    stage('YouTube');
    const page = await context.newPage();
    await page.goto('https://www.youtube.com/watch?v=LC1a-DwUhls', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 25_000 });
    await showArtwork(popup);
    await page.bringToFront();
    await expect(page.locator('html')).toHaveAttribute('data-around-site', 'youtube');
    stage('open Studio');
    await openSidePanelFromIcon(popup, page);
    const local = page.locator('#around-creator');
    stage('side panel');
    const panel = await sidePanelDriver(context, page, id),
      ui = 'document.querySelector("#around-creator").shadowRoot';
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
      ':is(#around-decorations, #around-video-decorations, #around-page-decorations, #around-atmosphere-decorations) .media',
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
    const gifId = await media.first().evaluate((node) => node.closest<HTMLElement>('[data-image-id]')?.dataset.imageId);
    const under: {
      progress: number;
      hit: string | null;
      control: string | null;
      approach?: { near: string[]; held: Record<string, string[]> } | null;
      nearGif?: unknown[];
      gifAt?: unknown;
    }[] = [];
    report.checks['pointer'] = { point: pointer, gif, gifId, under };
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
      // G1.3: the GIF follows the scroll and is shown at the same time. An opacity that follows
      // while the guard hides the layer (its frame's visibility, a stop in data-around-safety) is not a
      // pass. The media element itself is hidden at opacity 0 by the renderer, which is not a stop.
      await expect
        .poll(() =>
          media.evaluate((node: HTMLElement) => {
            const root = document.scrollingElement!,
              range = root.scrollHeight - root.clientHeight,
              value = range > 0 ? root.scrollTop / range : 0;
            const host = (node.getRootNode() as ShadowRoot).host,
              frame = node.closest<HTMLElement>('[data-image-id]');
            const stopped = JSON.parse(host?.getAttribute('data-around-safety') ?? '{}').stopped ?? '';
            if (frame?.style.visibility === 'hidden' || getComputedStyle(host).visibility === 'hidden' || stopped)
              return 1;
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
                .filter((e) => !e.closest('[id^="around"]'))
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
              frameVisibility: node.closest<HTMLElement>('[data-image-id]')?.style.visibility ?? null,
              safety: [...document.querySelectorAll('[id^="around-"][id$="decorations"]')].map((host) => [
                host.id,
                host.getAttribute('data-around-safety'),
              ]),
              active: document.activeElement?.tagName,
              // Only a AROUND_GUARD_TRACE build writes this: why the approach rule turned on or off.
              approach: JSON.parse(document.documentElement.getAttribute('data-around-guard-approach') ?? 'null'),
            };
          }, pointer);
          throw error;
        });
      // A AROUND_GUARD_TRACE build records the near controls and the roots they hold at this scroll.
      under.at(-1)!.approach = await page.evaluate(() => {
        const log = JSON.parse(document.documentElement.getAttribute('data-around-guard-approach') ?? 'null') as
          { change: string; near?: string[]; held?: Record<string, string[]> }[] | null;
        const last = log?.filter((entry) => entry.change === 'approach').at(-1);
        return last ? { near: last.near ?? [], held: last.held ?? {} } : null;
      });
      // Native controls within 72px of the resting pointer that also reach under the GIF (D11).
      under.at(-1)!.gifAt = await media.first().evaluate((node: HTMLElement) => {
        const g = node.getBoundingClientRect(),
          frame = node.closest<HTMLElement>('[data-image-id]');
        return {
          rect: [Math.round(g.left), Math.round(g.top), Math.round(g.width), Math.round(g.height)],
          visibility: frame?.style.visibility ?? null,
          // Why drawing is held at this moment (the guard's record), if it is.
          stopped:
            JSON.parse(
              (node.getRootNode() as ShadowRoot).host?.getAttribute('data-around-safety') ??
                document.querySelector('#around-decorations')?.getAttribute('data-around-safety') ??
                '{}',
            ).stopped ?? null,
          viewport: [innerWidth, innerHeight],
        };
      });
      under.at(-1)!.nearGif = await media.first().evaluate((node: HTMLElement, { x, y }) => {
        const g = node.getBoundingClientRect();
        return [
          ...document.querySelectorAll(
            'a[href], button, [role="button"], input, textarea, [contenteditable="true"], [role="slider"], ytd-searchbox, yt-searchbox',
          ),
        ]
          .filter((e) => !e.closest('[id^="around"]'))
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(
            ({ r }) =>
              r.width > 0 &&
              r.height > 0 &&
              Math.max(r.left - x, x - r.right, r.top - y, y - r.bottom) <= 72 &&
              r.right > g.left &&
              r.left < g.right &&
              r.bottom > g.top &&
              r.top < g.bottom,
          )
          .slice(0, 4)
          .map(({ e, r }) => ({
            element: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${[...e.classList]
              .slice(0, 2)
              .map((name) => '.' + name)
              .join('')}`,
            label: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40),
            within: e.parentElement?.closest('[id]')?.id ?? null,
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          }));
      }, pointer);
    };
    for (const progress of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) await verifyScroll(progress);
    for (const progress of [0, 0.5, 1, 0.5, 0]) {
      await page.waitForTimeout(100);
      await verifyScroll(progress);
    }
    // With the record (a AROUND_GUARD_TRACE build): whenever a control passed under the resting pointer,
    // the approach held only roots over it, never the GIF.
    for (const step of under.filter((entry) => entry.control && entry.approach))
      expect(Object.keys(step.approach!.held), JSON.stringify(step)).not.toContain(gifId);
    report.checks.scrollSpeedAndDirectionIndependent = true;
    stage('wheel scroll');
    // G1.3: real wheel input at about 90ms, as a person scrolls, with the pointer resting at the D9
    // point. Every presented frame between the first and the last wheel records whether the GIF is
    // shown. A AROUND_GUARD_TRACE build also records why the guard stopped; only a stop that follows a
    // read where the page's controls really changed (added, removed or moved in document
    // coordinates) is explained. Every other hidden frame fails the test (D5).
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(pointer.x, pointer.y);
    await expect
      .poll(() =>
        media.evaluate(
          (node: HTMLElement) =>
            JSON.parse((node.getRootNode() as ShadowRoot).host?.getAttribute('data-around-safety') ?? '{}').stopped ??
            '',
        ),
      )
      .toBe('');
    await page.waitForTimeout(250);
    await media.first().evaluate((node: HTMLElement) => {
      document.documentElement.removeAttribute('data-around-guard-geometry');
      const frames: unknown[] = ((window as any).aroundWheelFrames = []);
      (window as any).aroundWheelEvents = [];
      (window as any).aroundWheelRecording = true;
      document.addEventListener(
        'wheel',
        (event) => (window as any).aroundWheelEvents.push({ t: performance.now(), deltaY: event.deltaY }),
        { capture: true, passive: true },
      );
      const host = (node.getRootNode() as ShadowRoot).host,
        frame = node.closest<HTMLElement>('[data-image-id]');
      const sample = (t: number) => {
        const r = node.getBoundingClientRect();
        frames.push({
          t,
          scrollY,
          // The guard hides the layer's frame; the media alone is hidden at opacity 0 (not a stop).
          visible: frame?.style.visibility !== 'hidden' && getComputedStyle(host).visibility !== 'hidden',
          stopped: JSON.parse(host.getAttribute('data-around-safety') ?? '{}').stopped ?? '',
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        });
        if ((window as any).aroundWheelRecording) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const wheelNear: unknown[] = [];
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, i < 12 ? 90 : -90);
      await page.waitForTimeout(70);
      // Native controls within 72px of the resting pointer at this step (D9, D11).
      if (i % 4 === 3)
        wheelNear.push(
          await page.evaluate(
            ({ x, y }) =>
              [
                ...document.querySelectorAll(
                  'a[href], button, [role="button"], input, textarea, [contenteditable="true"], [role="slider"], ytd-searchbox, yt-searchbox',
                ),
              ]
                .filter((e) => !e.closest('[id^="around"]'))
                .map((e) => e.getBoundingClientRect())
                .filter(
                  (r) =>
                    r.width > 0 && r.height > 0 && Math.max(r.left - x, x - r.right, r.top - y, y - r.bottom) <= 72,
                )
                .slice(0, 4)
                .map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]),
            pointer,
          ),
        );
    }
    const wheel = await page.evaluate(() => {
      (window as any).aroundWheelRecording = false;
      return {
        frames: (window as any).aroundWheelFrames as { t: number; visible: boolean; stopped: string }[],
        events: (window as any).aroundWheelEvents as { t: number }[],
        geometry: JSON.parse(document.documentElement.getAttribute('data-around-guard-geometry') ?? 'null') as
          { at: number; change: string; added?: number; removed?: number; documentMoved?: number }[] | null,
      };
    });
    const first = wheel.events[0]!.t,
      last = wheel.events.at(-1)!.t;
    const during = wheel.frames.filter((f) => f.t >= first && f.t <= last);
    // With the trace: from a stop that follows a read with a real change of the controls, to its
    // release. The trace keeps earlier entries; only this wheel's (from one read window before) count.
    const explainedSpans: [number, number][] = [];
    const geometry = wheel.geometry?.filter((g) => g.at >= first - 250);
    if (geometry)
      for (const [i, entry] of geometry.entries()) {
        if (entry.change !== 'shifted' && entry.change !== 'hold') continue;
        const read = geometry
          .slice(0, i + 1)
          .reverse()
          .find((g) => g.change === 'read');
        if (!read || !(read.added || read.removed || read.documentMoved)) continue;
        const release = geometry.slice(i).find((g) => g.change === 'release');
        explainedSpans.push([entry.at, release?.at ?? Infinity]);
      }
    const hidden = during.filter((f) => !f.visible);
    const unexplained = hidden.filter((f) => !explainedSpans.some(([a, b]) => f.t >= a && f.t <= b));
    report.checks['wheel'] = {
      events: wheel.events.length,
      frames: during.length,
      hidden: hidden.length,
      unexplained: unexplained.length,
      explainedSpans,
      traced: Boolean(wheel.geometry),
      stops: [...new Set(hidden.map((f) => f.stopped))],
      near: wheelNear,
      samples: during.filter((_, i) => i % 10 === 0),
    };
    expect(during.length, 'frames sampled during the wheel').toBeGreaterThan(20);
    expect(unexplained.length, JSON.stringify(report.checks['wheel']).slice(0, 2000)).toBe(0);
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
      'chrome.runtime.sendMessage({type:"around:signal-takes",action:"list",siteId:"youtube"}).then(r=>r.value)',
    );
    const take = await panel.evaluate<SignalTake>(
      `chrome.runtime.sendMessage({type:"around:signal-takes",action:"get",siteId:"youtube",id:${JSON.stringify(library[0]!.id)}}).then(r=>r.value)`,
    );
    const design = await popup.evaluate(
      async () => (await chrome.storage.local.get('around.design.youtube'))['around.design.youtube'] as DesignDocument,
    );
    expect(design.schemaVersion).toBe(18);
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
        ':is(#around-decorations, #around-video-decorations, #around-page-decorations, #around-atmosphere-decorations)',
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
