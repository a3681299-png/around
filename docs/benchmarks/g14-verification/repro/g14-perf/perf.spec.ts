// G1.3 measurement scenes (docs/g13-plan.md, d). Real YouTube, one build per run, extension CPU per
// frame from the scripts/ui1 isolated-world wrappers (no product source is rewritten). Adapted from
// the G1.2 verification probe (docs/benchmarks/g12-verification/repro/perf.spec.ts).
//
// Build:   node scripts/ui1/build.mjs <source root> <source root>/.work/g13-perf
// Run:     G13_PERF=1 G13_BUILDS="before=<path>,after=<path>" G13_PAIRS=2 \
//            npm run test:e2e -- --config=scripts/g13/config.ts
// Options: G13_CALIBRATE="<build>,<busy build>" (+2ms check only), G13_3D=1 (adds the 3D reference
//          run per build, not for the verdict), G13_OUT (a .work child, default .work/g13-perf).
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cpus } from 'node:os';
import { launchExtension } from '../../tests/fixtures';
import { openEditor } from '../../tests/helpers/editor';
import { modelFixture } from '../../tests/helpers/model-fixture';
import { defaultSignalRule, defaultScrollOpacityRule } from '../../src/signals/keyframes';
import { declinePromotion, waitForAdvertToEnd, clearestPoint } from '../../tests/helpers/youtube-live';

const URL_ = 'https://www.youtube.com/watch?v=LC1a-DwUhls';
const out = path.resolve(process.env.G13_OUT ?? '.work/g13-perf');
if (path.relative(path.resolve('.work'), out).startsWith('..')) throw new Error('G13_OUT must be inside .work');

const stats = (data: number[]) => {
  const a = data.toSorted((x, y) => x - y);
  return {
    n: a.length,
    median: a.length ? (a[Math.floor((a.length - 1) / 2)]! + a[Math.ceil((a.length - 1) / 2)]!) / 2 : null,
    p95: a.length ? a[Math.ceil(a.length * 0.95) - 1]! : null,
    max: a.at(-1) ?? null,
  };
};
/** Extension callback time summed per presented frame (frames with no callback count as 0). */
function summarize(raw: { frames: number[]; calls: number[]; kinds: unknown }) {
  const values = Array(Math.max(0, raw.frames.length - 1)).fill(0);
  for (let i = 0; i < raw.calls.length; i += 2) {
    const t = raw.calls[i]!;
    let low = 0,
      high = raw.frames.length - 2,
      found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (raw.frames[mid]! <= t) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (found >= 0 && t < raw.frames.at(-1)!) values[found] += raw.calls[i + 1]!;
  }
  return {
    raw,
    cpuMs: stats(values),
    cpuTotalMs: values.reduce((sum: number, value: number) => sum + value, 0),
    cpuMeanMs: values.length ? values.reduce((sum: number, value: number) => sum + value, 0) / values.length : 0,
    intervalMs: stats(raw.frames.slice(1).map((t, i) => t - raw.frames[i]!)),
    frameIntervalsMs: raw.frames.slice(1).map((t, i) => t - raw.frames[i]!),
    callbacks: raw.calls.length / 2,
    kinds: raw.kinds,
  };
}

/** Records, per rAF, whether the always-moving layer is shown (its frame's inline visibility and
 * the guard's stop), and whether the approach rule held anything. Reads attributes only, so the
 * sampler forces no style or layout work of its own. */
const startVisibility = (page: Page) =>
  page.evaluate(() => {
    const rows: { t: number; shown: boolean; approach: boolean }[] = ((window as any).g13Shown = []);
    (window as any).g13Recording = true;
    const host = document.querySelector('#web-world-themes-decorations');
    const frame = host?.shadowRoot?.querySelector<HTMLElement>('[data-image-id="g13-perf-0"]');
    const sample = (t: number) => {
      const safety = host?.getAttribute('data-ww-safety') ?? '';
      rows.push({
        t,
        shown: Boolean(frame) && frame!.style.visibility !== 'hidden' && !/"stopped":"[^"]/.test(safety),
        approach: safety.includes('native.approach'),
      });
      if ((window as any).g13Recording) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
const endVisibility = (page: Page) =>
  page.evaluate(() => {
    (window as any).g13Recording = false;
    const rows = (window as any).g13Shown as { shown: boolean; approach: boolean }[];
    return {
      frames: rows.length,
      shown: rows.filter((r) => r.shown).length,
      approachFrames: rows.filter((r) => r.approach).length,
    };
  });

async function run(label: string, extensionPath: string, options: { calibration?: boolean; model?: boolean } = {}) {
  const hostStart = cpus().map((c) => c.times);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const hostEnd = cpus().map((c) => c.times);
  const total = hostEnd.reduce(
    (sum, t, i) =>
      sum + Object.values(t).reduce((a, b) => a + b, 0) - Object.values(hostStart[i]!).reduce((a, b) => a + b, 0),
    0,
  );
  const idle = hostEnd.reduce((sum, t, i) => sum + t.idle - hostStart[i]!.idle, 0);
  const hostCpuBefore = total ? (total - idle) / total : null;
  const context = await launchExtension(await mkdtemp(path.resolve('.work/g13-perf-profile-')), false, {
    extensionPath,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    const backup = await context.newPage();
    await backup.goto(`chrome-extension://${id}/backup/index.html`);
    await backup.locator('#backup-file').setInputFiles(path.resolve('tests/fixtures/backups/pre-removal.wwbackup'));
    await backup.locator('#backup-inspect').click();
    await expect(backup.locator('#backup-restore')).toBeEnabled();
    await backup.locator('#backup-restore').click();
    await expect(backup.locator('.backup-status')).toContainText('読み込みが完了');
    await backup.close();
    const read = () =>
      popup.evaluate(
        async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
      );
    let model: unknown;
    if (options.model) {
      // The public authored test rig (tests/helpers/model-fixture.ts); its clip plays by default.
      const prep = await context.newPage();
      await prep.setViewportSize({ width: 1920, height: 1080 });
      await prep.goto(URL_, { waitUntil: 'domcontentloaded' });
      await expect(prep.locator('html')).toHaveAttribute('data-ww-site', 'youtube', { timeout: 30000 });
      const { studio, panel } = await openEditor(popup, prep);
      const before = ((await read()) as any).decorations.length;
      await panel
        .locator('.model-file')
        .setInputFiles({ name: 'Rig.glb', mimeType: 'model/gltf-binary', buffer: modelFixture() });
      await expect(panel.locator('.layer')).toHaveCount(before + 1, { timeout: 20000 });
      await panel.locator('.save').click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      model = ((await read()) as any).decorations.find((d: any) => d.kind === 'model3d');
      if (!model) throw new Error('The 3D fixture was not saved');
      await studio.close();
      await prep.close();
      console.log('STEP', label, '3D fixture saved');
    }
    // Codex's 32 layers: the first moves all the time (X follows the idle time), the other 31 fade
    // with the page scroll. The 3D reference replaces the last one with a playing model at the right
    // edge (an artwork holds at most 32 layers).
    const saved: any = await read();
    const image = saved.decorations.find((d: any) => d.kind !== 'model3d');
    const decorations: any[] = Array.from({ length: model ? 31 : 32 }, (_, i) => ({
      ...image,
      id: `g13-perf-${i}`,
      placement: {
        anchor: { kind: 'viewport' },
        x: 0.14 + (i % 8) * 0.1,
        y: 0.14 + Math.floor(i / 8) * 0.18,
        widthPx: 48,
        heightPx: 36,
        rotationDeg: 0,
      },
    }));
    if (model)
      decorations.push({
        ...(model as object),
        id: 'g13-perf-model',
        placement: {
          ...(model as any).placement,
          anchor: { kind: 'viewport' },
          x: 0.9,
          y: 0.75,
          widthPx: 200,
          heightPx: 200,
        },
      });
    const signalRules: unknown[] = decorations
      .slice(1)
      .filter((d) => d.kind !== 'model3d')
      .map((d) => defaultScrollOpacityRule(d.id));
    signalRules.push(
      defaultSignalRule(decorations[0].id, 'position.x', {
        signal: 'user.idle.duration',
        axis: 'y',
        space: 'page',
        inputRange: [0, 30],
      }),
    );
    await popup.evaluate(
      (design) =>
        chrome.storage.local.set({ 'webWorldThemes.design.youtube': design, 'webWorldThemes.creatorMode': false }),
      { ...saved, id: 'g13-perf-scene', decorations, signalRules },
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const activeTabs = () =>
      worker.evaluate(async () =>
        (await chrome.tabs.query({ active: true })).map((t) => ({ id: t.id, windowId: t.windowId })),
      );
    const focusBefore = await activeTabs();
    // A startup frame clock needs the real tab in front as well as Playwright's focus emulation.
    await page.bringToFront();
    const navigationFocus = { before: focusBefore, after: await activeTabs() };
    if (process.env.G14_STARTUP_ONLY === '1')
      await page.addInitScript(() => {
        if (window.top !== window) return;
        const frames: number[] = ((window as any).__g14StartupFrames = []);
        const sample = () => {
          frames.push(performance.now());
          if (performance.now() < 6500) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    const cdp = await context.newCDPSession(page);
    const worlds = new Set<number>();
    const contextRefreshes: any[] = [];
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => worlds.add(c.id));
    cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
    await cdp.send('Runtime.enable');
    const evaluate = async (expression: string) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const contextId of worlds) {
          try {
            const probe = await cdp.send('Runtime.evaluate', {
              contextId,
              expression: 'Boolean(globalThis.__ui1Probe)',
              returnByValue: true,
            });
            if (!probe.result.value) continue;
            const r = await cdp.send('Runtime.evaluate', {
              contextId,
              expression,
              returnByValue: true,
              awaitPromise: true,
            });
            if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
            return r.result.value;
          } catch (e) {
            if (String(e).includes('Cannot find context')) continue;
            throw e;
          }
        }
        // A navigation can clear the cached context inventory after a new context was announced.
        // Ask CDP to announce its live contexts once; do not inject or manufacture a probe.
        if (!attempt) {
          contextRefreshes.push({ at: Date.now(), url: page.url(), expression, previousContexts: [...worlds] });
          await cdp.send('Runtime.disable');
          worlds.clear();
          await cdp.send('Runtime.enable');
        }
      }
      await writeFile(
        path.join(out, `${label}-missing-probe-${Date.now()}.json`),
        JSON.stringify({
          url: page.url(),
          worlds: [...worlds],
          contextRefreshes,
          page: await page
            .evaluate(() => ({
              ready: document.readyState,
              site: document.documentElement.getAttribute('data-ww-site'),
              title: document.title,
            }))
            .catch(() => null),
        }),
      );
      throw Error('Missing extension CPU probe');
    };
    const start = Date.now();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Math.max(0, 6000 - (Date.now() - start)));
    // document_idle can start the content script near the six-second edge. Read its real probe
    // later, then retain only callbacks inside 0..6000; the frame clock above began at navigation.
    if (process.env.G14_STARTUP_ONLY === '1') await page.waitForTimeout(2000);
    const first = await evaluate('__ui1Probe.end()');
    let startupWindow: any;
    if (process.env.G14_STARTUP_ONLY === '1') {
      const sampled: number[] = await page.evaluate(() => (window as any).__g14StartupFrames);
      startupWindow = {
        start: 0,
        end: 6000,
        contentProbeStarted: first.frames[0],
        mainWorldFrameSamples: sampled.length,
      };
      await writeFile(
        path.join(out, `${label}-startup-clock-${Date.now()}.json`),
        JSON.stringify({ startupWindow, navigationFocus, sampled }),
      );
      expect(
        sampled.filter((t) => t > 0 && t < 6000).length,
        'enough real foreground startup frames to estimate a percentile',
      ).toBeGreaterThanOrEqual(120);
      first.frames = [0, ...sampled.filter((t) => t > 0 && t < 6000), 6000];
      const calls: number[] = [];
      for (let i = 0; i < first.calls.length; i += 2) {
        const t = first.calls[i];
        if (t >= 0 && t < 6000) calls.push(t, Math.min(first.calls[i + 1], 6000 - t));
      }
      first.calls = calls;
    }
    const output: any = {
      label,
      build: JSON.parse(await readFile(path.join(extensionPath, 'ui1-build.json'), 'utf8')),
      browser: context.browser()?.version(),
      url: URL_,
      viewport: { width: 1920, height: 1080 },
      model: Boolean(model),
      hostCpuBefore,
      phases: {},
      networkErrors: [],
      contextRefreshes,
      navigationFocus,
      ...(startupWindow ? { startupWindow } : {}),
    };
    if (!options.calibration && !model) output.phases.startup = { ...summarize(first) };
    if (process.env.G14_STARTUP_ONLY === '1') {
      await cdp.detach();
      return output;
    }
    page.on('requestfailed', (r) =>
      output.networkErrors.push({ url: r.url().split('?')[0], error: r.failure()?.errorText }),
    );
    await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
    console.log('STEP', label, 'startup measured');
    await waitForAdvertToEnd(page);
    await declinePromotion(page);
    // A rejected artwork never creates the host; fail here instead of waiting on it forever.
    await expect(page.locator('#web-world-themes-decorations')).toBeAttached({ timeout: 15000 });
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const player = (await page.locator('#movie_player').boundingBox())!;
    const rest = await clearestPoint(page, {
      left: player.x + 100,
      top: player.y + 120,
      right: player.x + player.width - 100,
      bottom: player.y + player.height - 150,
    });
    await page.mouse.move(rest.x, rest.y);
    await page.waitForTimeout(1000);
    output.rest = rest;
    // G13_CPUPROFILE=1: a V8 profile of each scroll and SPA block. It adds overhead; such runs are
    // for finding the heavy functions only, never for the verdict.
    const measure = async (body: () => Promise<void>, name?: string) => {
      const profiling = Boolean(name) && process.env.G13_CPUPROFILE === '1';
      if (profiling) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
      }
      await evaluate('__ui1Probe.begin()');
      await body();
      const summary = summarize(await evaluate('__ui1Probe.end()'));
      if (profiling) {
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(path.join(out, `${label}-${name}.cpuprofile`), JSON.stringify(profile));
      }
      return summary;
    };
    if (options.calibration) {
      output.phases.calibration = await measure(() => page.waitForTimeout(6000));
      return output;
    }
    const safetyState = () => page.locator('#web-world-themes-decorations').getAttribute('data-ww-safety');
    const approachIssues = async () =>
      JSON.parse((await safetyState()) ?? '{}').issues?.filter((i: any) => i.surfaceId === 'native.approach').length ??
      0;
    // The 3D reference only records whether the approach rule held anything (approachFrames below).
    if (!model) await expect.poll(approachIssues).toBe(0);
    else output.approachAtRest = await approachIssues();
    if (!model && process.env.G14_STATIC_SMOKE !== '1')
      output.phases.steady = { ...(await measure(() => page.waitForTimeout(6000))) };
    // Scroll: real wheel input, 32 steps of 90px about 90ms apart (16 down, 16 up).
    const wheel = async () => {
      for (let i = 0; i < 32; i++) {
        await page.mouse.wheel(0, i < 16 ? 90 : -90);
        await page.waitForTimeout(70);
      }
    };
    const scroll = async (name: string, point: { x: number; y: number }) => {
      await page.evaluate(() => scrollTo(0, 0));
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(1000);
      const videoBefore = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v
          ? {
              ...v.getVideoPlaybackQuality(),
              paused: v.paused,
              currentTime: v.currentTime,
              total: v.getVideoPlaybackQuality().totalVideoFrames,
              dropped: v.getVideoPlaybackQuality().droppedVideoFrames,
            }
          : null;
      });
      await startVisibility(page);
      const summary = await measure(wheel, name);
      const videoAfter = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v
          ? {
              paused: v.paused,
              currentTime: v.currentTime,
              total: v.getVideoPlaybackQuality().totalVideoFrames,
              dropped: v.getVideoPlaybackQuality().droppedVideoFrames,
            }
          : null;
      });
      output.phases[name] = { ...summary, point, visibility: await endVisibility(page), videoBefore, videoAfter };
    };
    // Far: a free spot of the fixed masthead, clear of its controls. Nothing scrolls under it, so
    // neither the G1 rule (557b978) nor G1.2's holds any layer there (D1). Page content does not
    // qualify: the G1 rule held everything at the right edge, where inner scroll and sticky
    // columns reach under the pointer (round 0). The block is marked invalid if anything was held.
    console.log('STEP', label, 'scroll blocks');
    const far =
      process.env.G13_FAR === 'edge'
        ? await clearestPoint(page, { left: 1880, top: 300, right: 1916, bottom: 1000 }, 0)
        : await clearestPoint(page, { left: 240, top: 10, right: 1600, bottom: 46 }, 0);
    if (process.env.G14_STATIC_SMOKE !== '1') await scroll(model ? 'scroll3d' : 'scrollFar', far);
    if (output.phases[model ? 'scroll3d' : 'scrollFar']?.visibility.approachFrames)
      output.phases[model ? 'scroll3d' : 'scrollFar'].invalid = 'the approach rule held a layer at the far point';
    if (!model) {
      if (process.env.G14_STATIC_SMOKE !== '1') {
        // Near: where the page's links scroll under the pointer (signal-timeline-live's D9 point).
        const near = await page.evaluate(() => {
          const below = document.querySelector('ytd-watch-flexy #below')!.getBoundingClientRect();
          return { x: below.left + 20, y: innerHeight / 2 };
        });
        await scroll('scrollNear', near);
        await page.evaluate(() => scrollTo(0, 0));
        await page.mouse.move(rest.x, rest.y);
        await page.waitForTimeout(1000);
        const search = page.getByRole('combobox', { name: /Search|検索/ });
        output.phases.spa = await measure(async () => {
          await search.fill('lofi hip hop');
          await search.press('Enter');
          await expect(page).toHaveURL(/results\?search_query=/);
          await page.waitForTimeout(6000);
        }, 'spa');
      }
      await writeFile(path.join(out, `${label}-before-static-${Date.now()}.json`), JSON.stringify(output));
      if (process.env.G14_USUAL_ONLY === '1') {
        await cdp.detach();
        return output;
      }
      // G1.4: a genuinely opaque, visible image with no rule or animation. Pick a rectangle in
      // the compositor's permitted region, so a clipped-out image cannot count as this scene.
      await page.goto(URL_, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveAttribute('data-ww-site', 'youtube', { timeout: 30000 });
      await expect(page.locator('#web-world-themes-decorations')).toBeAttached({ timeout: 30000 });
      await waitForAdvertToEnd(page);
      await declinePromotion(page);
      const video = page.locator('video.html5-main-video');
      if (!(await video.evaluate((v: HTMLVideoElement) => v.paused))) {
        await page.locator('#movie_player').hover();
        await page.locator('.ytp-play-button').click();
      }
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
      const current: any = await read();
      await popup.evaluate((design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': design }), {
        ...current,
        decorations: [current.decorations[0]],
        signalRules: [],
        groups: [],
      });
      const { studio, panel } = await openEditor(popup, page);
      const solid = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d')!;
        g.fillStyle = '#00dfff';
        g.fillRect(0, 0, 64, 64);
        return c.toDataURL().split(',')[1]!;
      });
      await panel
        .getByLabel('画像素材を追加')
        .setInputFiles({ name: 'g14-solid.png', mimeType: 'image/png', buffer: Buffer.from(solid, 'base64') });
      await expect(panel.locator('.layer')).toHaveCount(2);
      await panel.locator('.save').click();
      await expect(panel.locator('.dirty')).toHaveText('保存済み');
      const staticSaved: any = await read();
      await studio.close();
      // All pages share the physical headless window. Restore this page after Studio resized it,
      // including a real viewport change so the renderer refreshes its placement frame.
      await page.setViewportSize({ width: 1921, height: 1081 });
      await page.setViewportSize({ width: 1920, height: 1080 });
      const settled = () =>
        page
          .locator('#web-world-themes-decorations')
          .evaluate((node) => JSON.parse((node as HTMLElement).dataset.wwSafety ?? '{}').stopped ?? '');
      await expect.poll(settled, { timeout: 45000 }).toBe('');
      const area = await page.evaluate(() => {
        const player = document.querySelector('#movie_player')!.getBoundingClientRect();
        const secondary = document.querySelector('#secondary')!.getBoundingClientRect();
        const clip = document
          .querySelector<HTMLElement>('#web-world-themes-decorations')!
          .style.getPropertyValue('--ww-decoration-clip');
        const regions = [...clip.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)]
          .map((m) => m.slice(1).map(Number))
          .filter(([x, y, w, h]) => w! >= 20 && h! >= 20)
          .sort((a, b) => b[2]! * b[3]! - a[2]! * a[3]!);
        // A permitted region can still be under an opaque native-above card. The actual gap
        // between the player and the recommendation column exposes the artwork plane itself.
        const left = player.right + 4,
          right = secondary.left - 4,
          width = Math.min(8, 2 * Math.floor((right - left) / 2));
        const x = Math.round((left + right) / 2),
          y = Math.round(Math.min(innerHeight - 40, player.top + player.height / 2));
        if (
          width < 4 ||
          !regions.some(
            ([l, t, w, h]) => x - width / 2 >= l! && x + width / 2 <= l! + w! && y - 32 >= t! && y + 32 <= t! + h!,
          )
        )
          throw new Error('No exposed safe gap for the static opaque scene');
        return { x, y, width, height: 64, kind: 'exposed gap between player and secondary' };
      });
      const staticDesign = {
        ...staticSaved,
        decorations: [
          {
            ...staticSaved.decorations.at(-1),
            id: 'g14-static',
            opacity: 1,
            placement: {
              anchor: { kind: 'viewport' },
              x: area.x / 1920,
              y: area.y / 1080,
              widthPx: area.width,
              heightPx: area.height,
              rotationDeg: 0,
            },
          },
        ],
        signalRules: [],
        groups: [],
      };
      await popup.evaluate(
        (design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': design }),
        staticDesign,
      );
      await page.mouse.move(rest.x, rest.y);
      await page.waitForTimeout(2000);
      await expect.poll(settled, { timeout: 45000 }).toBe('');
      const image = page.locator('[data-image-id="g14-static"]');
      await expect(image).toBeVisible();
      const bounds = await image.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        host: document.querySelector('#web-world-themes-decorations')!.getBoundingClientRect().toJSON(),
      }));
      await writeFile(
        path.join(out, `${label}-static-geometry-${Date.now()}.json`),
        JSON.stringify({ area, bounds, viewport }),
      );
      expect(viewport.width).toBe(1920);
      expect(viewport.height).toBe(1080);
      expect(bounds!.x + bounds!.width / 2).toBeCloseTo(area.x, 1);
      expect(bounds!.y + bounds!.height / 2).toBeCloseTo(area.y, 1);
      // Studio changes the physical headless window size. An unclipped surface screenshot can
      // then stop at 1422px although this page's layout viewport is 1920px, yielding transparent
      // out-of-bitmap reads at a valid artwork coordinate. Capture the full layout viewport.
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      });
      const picture = `${label}-static-${Date.now()}.png`;
      await writeFile(path.join(out, picture), Buffer.from(screenshot.data, 'base64'));
      const sample = await page.evaluate(
        async ({ png, point }) => {
          const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))]));
          const canvas = document.createElement('canvas');
          canvas.width = point.width;
          canvas.height = point.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(
            bitmap,
            point.x - point.width / 2,
            point.y - point.height / 2,
            point.width,
            point.height,
            0,
            0,
            point.width,
            point.height,
          );
          const data = ctx.getImageData(0, 0, point.width, point.height).data;
          let differentPixels = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] !== 0 || data[i + 1] !== 223 || data[i + 2] !== 255 || data[i + 3] !== 255) differentPixels++;
          const dimensions = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return { dimensions, color: [...data.slice(0, 4)], pixels: data.length / 4, differentPixels };
        },
        { png: screenshot.data, point: area },
      );
      const { color, dimensions } = sample;
      const paintState = await image.evaluate((node) => {
        const host = document.querySelector<HTMLElement>('#web-world-themes-decorations')!;
        return {
          name: node.getAttribute('aria-label'),
          visibility: getComputedStyle(node).visibility,
          opacity: getComputedStyle(node).opacity,
          clip: host.style.getPropertyValue('--ww-decoration-clip'),
          safety: host.dataset.wwSafety,
          media: host.dataset.wwMediaStats,
        };
      });
      await writeFile(
        path.join(out, `${label}-static-check-${Date.now()}.json`),
        JSON.stringify({ area, color, dimensions, picture, bounds: await image.boundingBox(), paintState }),
      );
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
      expect(color, 'the static opaque scene really paints its solid pixel').toEqual([0, 223, 255, 255]);
      expect(sample.differentPixels, 'every pixel of the exposed opaque artwork').toBe(0);
      const staticSummary = await measure(() => page.waitForTimeout(6000), 'staticOpaque');
      const endState = await image.evaluate((node) => ({
        visibility: getComputedStyle(node).visibility,
        opacity: getComputedStyle(node).opacity,
        stopped:
          JSON.parse(document.querySelector<HTMLElement>('#web-world-themes-decorations')!.dataset.wwSafety ?? '{}')
            .stopped ?? '',
      }));
      expect(endState).toEqual({ visibility: 'visible', opacity: '1', stopped: '' });
      output.phases.staticOpaque = {
        ...staticSummary,
        area,
        color,
        dimensions,
        pixels: sample.pixels,
        differentPixels: sample.differentPixels,
        screenshot: picture,
        videoPaused: true,
        endState,
      };
    }
    await cdp.detach();
    return output;
  } finally {
    await context.close();
  }
}

const builds = Object.fromEntries(
  (process.env.G13_BUILDS ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [name, dir] = entry.split('=');
      return [name!, path.resolve(dir!)];
    }),
);

test('G1.3 calibration: a +2ms busy build reads about +2ms', async () => {
  test.skip(!process.env.G13_CALIBRATE, 'G13_CALIBRATE="<build>,<busy build>"');
  test.setTimeout(300000);
  await mkdir(out, { recursive: true });
  const [plain, busy] = process.env.G13_CALIBRATE!.split(',').map((p) => path.resolve(p));
  const rows = [await run('plain', plain!, { calibration: true }), await run('busy', busy!, { calibration: true })];
  await writeFile(path.join(out, 'calibration.json'), JSON.stringify(rows, null, 2));
  const delta = rows[1].phases.calibration.cpuMs.median - rows[0].phases.calibration.cpuMs.median;
  console.log('CALIBRATION delta median', delta);
  expect(delta).toBeGreaterThan(1.5);
  expect(delta).toBeLessThan(3);
});

test('G1.3 alternating pairs on the formal scenes', async () => {
  test.skip(process.env.G13_PERF !== '1', 'G13_PERF=1 with G13_BUILDS');
  test.setTimeout(3600000);
  await mkdir(out, { recursive: true });
  const names = Object.keys(builds);
  // Two builds alternate; one build alone is for a profile of that build only.
  if (names.length < 1 || names.length > 2) throw new Error('G13_BUILDS needs one or two builds: a=<path>,b=<path>');
  const result: any = { date: new Date().toISOString(), builds, pairs: [], reference3d: [] };
  const save = () => writeFile(path.join(out, 'performance.json'), JSON.stringify(result, null, 2));
  for (let pair = 0; pair < Number(process.env.G13_PAIRS ?? 2); pair++) {
    const order = pair % 2 ? names.toReversed() : names;
    const row: any = { pair, order };
    result.pairs.push(row);
    for (const name of order) {
      row[name] = await run(name, builds[name]!);
      console.log(
        'PERF',
        pair,
        name,
        JSON.stringify(Object.fromEntries(Object.entries(row[name].phases).map(([k, v]: any) => [k, v.cpuMs]))),
      );
      await save();
    }
    await save();
  }
  if (process.env.G13_3D === '1')
    for (const name of names) {
      const row = await run(name, builds[name]!, { model: true });
      result.reference3d.push(row);
      console.log(
        'PERF3D',
        name,
        JSON.stringify(row.phases.scroll3d.cpuMs),
        JSON.stringify(row.phases.scroll3d.visibility),
      );
      await save();
    }
});
