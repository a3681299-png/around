import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { workPath, extensionPath, browserPath, createProfile, revision } from './environment.mjs';

const mode = process.argv[2];
if (!['startup', 'steady', 'minute', 'areas', 'smoke'].includes(mode))
  throw new Error('Usage: node scripts/g11/run.mjs startup|steady|minute|areas|smoke');
process.env.G11_STARTUP = mode === 'startup' ? '1' : '0';
process.env.G11_FRAMES_ONLY = mode === 'minute' ? '0' : '1';
process.env.G11_PERF_ONLY = mode === 'areas' ? '0' : '1';
process.env.G11_SMOKE = mode === 'smoke' ? '1' : '0';
if (mode === 'steady') process.env.G11_SETTLE_MS ??= '15000';
if (['minute', 'areas', 'smoke'].includes(mode)) process.env.G11_PAIR_COUNT = '0';
const work = workPath(process.env.G11_WORK ?? `.work/g11-results/${mode}-${Date.now()}`);
await mkdir(work, { recursive: true });
const startup = process.env.G11_STARTUP === '1';
const settleMs = Number(process.env.G11_SETTLE_MS ?? 2000);
const pairCount = Number(process.env.G11_PAIR_COUNT ?? 4);
const profile = await createProfile();
const videoUrl = process.env.G11_VIDEO_URL ?? 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
const context = await chromium.launchPersistentContext(profile, {
  executablePath: browserPath,
  headless: process.env.G11_HEADED !== '1',
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    ...(process.env.G11_HEADED === '1' ? ['--window-position=-20000,-20000'] : []),
  ],
});
const result = {
  measuredAt: new Date().toISOString(),
  revision,
  candidate: process.env.G11_LABEL ?? 'performance fix',
  phase: startup ? 'controller startup, first 6s' : `settle ${settleMs}ms + 3s forced redraw, next 6s`,
  profile: `task-owned signed-out, ${process.env.G11_HEADED === '1' ? 'offscreen headed' : 'headless'}`,
  browserPath,
  videoUrl,
  browser: context.browser()?.version(),
  viewport: { width: 1920, height: 1080 },
  areas: [],
  playback: null,
  pairs: [],
  errors: [],
  networkErrors: [],
};
const output = path.join(work, 'baseline.json');
if (process.env.G11_RESUME === '1') {
  const prior = JSON.parse(await readFile(process.env.G11_AREAS_INPUT ?? output, 'utf8'));
  result.areas = prior.areas;
  if (process.env.G11_RESUME_FRAMES === '1') result.pairs = prior.pairs;
  result.earlierAttempt = { measuredAt: prior.measuredAt, failure: prior.failure };
  await writeFile(path.join(work, 'area-attempt1.json'), JSON.stringify(prior, null, 2));
}
const save = () => writeFile(output, JSON.stringify(result, null, 2));
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    sum: values.reduce((a, b) => a + b, 0),
    min: sorted[0] ?? null,
    median: sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
      : null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    max: sorted.at(-1) ?? null,
  };
}
function summarize(raw) {
  const frames = new Map();
  for (const r of raw.frames) frames.set(r.time, (frames.get(r.time) ?? 0) + r.ms);
  return {
    recaptures: stats(raw.captures.map((r) => r.ms)),
    extensionFrameCpuMs: stats([...frames.values()]),
    rafIntervalMs: stats(raw.intervals),
    callbackCount: raw.frames.length,
  };
}
let session,
  page,
  contexts = new Map();
let isolated;
async function evaluate(expression) {
  const value = await session.send('Runtime.evaluate', {
    expression,
    contextId: isolated,
    returnByValue: true,
    awaitPromise: true,
  });
  if (value.exceptionDetails)
    throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
async function selectContext() {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const id of contexts.keys()) {
      try {
        const value = await session.send('Runtime.evaluate', {
          expression: 'Boolean(globalThis.__g11Probe?.controller)',
          contextId: id,
          returnByValue: true,
        });
        if (value.result.value === true) {
          isolated = id;
          return;
        }
      } catch {}
    }
    await page.waitForTimeout(250);
  }
  throw new Error('No diagnostic content-script context: ' + JSON.stringify([...contexts.values()]));
}
async function videoState() {
  return page.evaluate(() => {
    const v = document.querySelector('video.html5-main-video');
    const q = v?.getVideoPlaybackQuality();
    return v
      ? {
          currentTime: v.currentTime,
          duration: v.duration,
          paused: v.paused,
          readyState: v.readyState,
          error: v.error?.code ?? null,
          totalFrames: q.totalVideoFrames,
          droppedFrames: q.droppedVideoFrames,
          ad: document.querySelector('#movie_player')?.classList.contains('ad-showing'),
          hidden: document.hidden,
        }
      : null;
  });
}
async function area(name) {
  await page.waitForTimeout(1700);
  await selectContext();
  const value = await evaluate('__g11Probe.controller.safety.sample(performance.now()); __g11Probe.snapshot()');
  if (!value) throw new Error('No guarded snapshot for ' + name);
  const { snapshot, regions, status, videoSlot } = value;
  const total = snapshot.viewport.width * snapshot.viewport.height;
  const safe = regions.reduce((a, r) => a + r.width * r.height, 0);
  if (safe < 0 || safe > total + 1e-6) throw new Error('Invalid disjoint region area');
  const state = await page.evaluate(() => ({
    url: location.href,
    scrollY,
    fullscreen: Boolean(document.fullscreenElement),
    theater: document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? false,
    cards: document.querySelectorAll('ytd-rich-item-renderer,ytd-rich-grid-media').length,
    commentThreads: document.querySelectorAll('ytd-comment-thread-renderer').length,
  }));
  const row = {
    name,
    ...state,
    viewport: snapshot.viewport,
    supported: snapshot.supported,
    hostStopped: status,
    videoSlot,
    safePixels: safe,
    totalPixels: total,
    drawablePercent: (100 * safe) / total,
    regionCount: regions.length,
    surfaceCount: snapshot.surfaces.length,
    visibleSurfaceCount: snapshot.surfaces.filter((s) => s.availability.visible).length,
    snapshot,
    regions,
  };
  result.areas.push(row);
  await page.screenshot({ path: path.join(work, name + '.png') });
  await save();
  console.log(
    'AREA ' +
      JSON.stringify({
        name,
        percent: row.drawablePercent,
        surfaces: row.surfaceCount,
        stopped: status,
        cards: state.cards,
        comments: state.commentThreads,
      }),
  );
}
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await popup.evaluate(
    async (reuse) =>
      chrome.storage.local.set({
        'webWorldThemes.enabled': true,
        'webWorldThemes.strength': 100,
        'webWorldThemes.safety.emergencyOff': false,
        ...(reuse
          ? {}
          : {
              'webWorldThemes.design.youtube': {
                schemaVersion: 11,
                id: 'g11-baseline',
                siteId: 'youtube',
                baseThemeId: null,
                rules: [],
                decorations: [],
              },
            }),
      }),
    process.env.G11_REUSE_SCENE === '1',
  );
  page = await context.newPage();
  page.on('pageerror', (error) => {
    result.errors.push(error.message);
  });
  page.on('response', (response) => {
    const u = new URL(response.url());
    if (response.status() >= 400 && /videoplayback|youtubei\/v1\/player/.test(u.pathname))
      result.networkErrors.push({ time: Date.now(), host: u.host, path: u.pathname, status: response.status() });
  });
  page.on('requestfailed', (request) => {
    const u = new URL(request.url());
    if (/videoplayback|youtubei\/v1\/player/.test(u.pathname))
      result.networkErrors.push({
        time: Date.now(),
        host: u.host,
        path: u.pathname,
        error: request.failure()?.errorText,
      });
  });
  session = await context.newCDPSession(page);
  session.on('Runtime.executionContextCreated', ({ context: c }) =>
    contexts.set(c.id, { name: c.name, origin: c.origin, auxData: c.auxData }),
  );
  session.on('Runtime.executionContextDestroyed', ({ executionContextId: id }) => contexts.delete(id));
  session.on('Runtime.executionContextsCleared', () => contexts.clear());
  await session.send('Runtime.enable');
  await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#movie_player').waitFor({ state: 'visible', timeout: 30000 });
  await page.bringToFront();
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video.html5-main-video');
      return v && v.duration > 65 && v.readyState >= 2;
    },
    {},
    { timeout: 45000 },
  );
  await selectContext();
  console.log('READY ' + JSON.stringify(await videoState()));
  if (process.env.G11_SMOKE === '1') {
    await area('watch-top');
    console.log(
      'SMOKE_CONTEXT ' +
        JSON.stringify(
          await evaluate(
            '({guard:Boolean(__g11Probe.controller.safety),snapshot:__g11Probe.snapshot().snapshot.surfaces.length})',
          ),
        ),
    );
  } else {
    await page.evaluate(async () => {
      const v = document.querySelector('video.html5-main-video');
      v.muted = true;
      await v.play();
    });
    if (process.env.G11_PERF_ONLY !== '1') {
      if (!result.areas.some((a) => a.name === 'watch-top')) await area('watch-top');
      if (!result.areas.some((a) => a.name === 'fullscreen')) {
        await page.locator('#movie_player').hover();
        await page.locator('.ytp-size-button').click();
        await page.mouse.move(1915, 1075);
        await page.waitForFunction(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'));
        await area('theater');
        await page.locator('#movie_player').hover();
        await page.locator('.ytp-fullscreen-button').click();
        await page.mouse.move(1915, 1075);
        await page.waitForFunction(() => Boolean(document.fullscreenElement));
        await area('fullscreen');
        await page.locator('#movie_player').hover();
        await page.locator('.ytp-fullscreen-button').click();
        await page.waitForFunction(() => !document.fullscreenElement);
        await page.locator('#movie_player').hover();
        await page.locator('.ytp-size-button').click();
        await page.waitForFunction(() => !document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'));
      }
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(4000);
      const comments = page.locator('ytd-comments').filter({ visible: true }).first();
      await comments.scrollIntoViewIfNeeded();
      await area('watch-comments');
      await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      await area('home-list');
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => {
          const v = document.querySelector('video.html5-main-video');
          return v && v.readyState >= 2 && v.duration > 65;
        },
        {},
        { timeout: 45000 },
      );
      await selectContext();
    }
    if (process.env.G11_REUSE_SCENE !== '1') {
      await popup.locator('#creator-editor-open').evaluate((b) => b.click());
      const editor = page.locator('#web-world-themes-creator');
      const split = editor.locator('.split');
      if ((await split.getAttribute('aria-pressed')) !== 'true') await split.click();
      await editor.getByRole('tab', { name: 'レイヤー', exact: true }).click();
      const guide = editor.getByRole('button', { name: '操作ガイドを閉じる', exact: true });
      if (await guide.isVisible()) await guide.click();
      await editor.getByLabel('画像素材を追加').setInputFiles(path.resolve('tests/fixtures/motion/petal.png'));
      await editor.locator('.save').click();
      await editor.locator('.dirty').filter({ hasText: '保存済み' }).waitFor();
      await editor.getByRole('button', { name: '編集を終了', exact: true }).click();
      const imported = await popup.evaluate(
        async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
      );
      const sample = imported.decorations[0];
      if (!sample?.assetId) throw new Error('Validated import was not saved');
      const design = {
        ...imported,
        baseThemeId: null,
        decorations: Array.from({ length: 32 }, (_, i) => ({
          ...sample,
          id: `g11-layer-${i}`,
          name: `G1.1 measurement ${i}`,
          opacity: 0.8,
          visible: true,
          locked: false,
          zIndex: i % 3,
          placement: {
            anchor: { kind: 'viewport' },
            x: 0.08 + (i % 8) * 0.12,
            y: 0.2 + Math.floor(i / 8) * 0.2,
            widthPx: 70,
            heightPx: 70,
            rotationDeg: 0,
          },
        })),
        groups: Array.from({ length: 16 }, (_, i) => ({
          kind: 'group',
          id: `g11-group-${i}`,
          name: `G1.1 group ${i}`,
          opacity: 0.7,
          zIndex: i % 3,
          visible: true,
          locked: false,
          children: [`g11-layer-${2 * i}`, `g11-layer-${2 * i + 1}`],
        })),
      };
      await popup.evaluate(
        async (design) => chrome.storage.local.set({ 'webWorldThemes.design.youtube': design }),
        design,
      );
    }
    await page.locator('[data-image-id]').first().waitFor({ state: 'attached' });
    const sceneCount = await popup.evaluate(async () => {
      const s = (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'];
      return { layers: s.decorations.length, groups: s.groups?.length ?? 0 };
    });
    if (sceneCount.layers !== 32 || sceneCount.groups !== 16)
      throw new Error('The comparison scene must have 32 layers and 16 groups.');
    result.scene = { ...sceneCount, asset: 'tests/fixtures/motion/petal.png', baseThemeId: null };
    await page.bringToFront();
    await page.mouse.move(1915, 1075);
    await page.evaluate(async () => {
      const v = document.querySelector('video.html5-main-video');
      v.muted = true;
      await v.play();
    });
    if (process.env.G11_FRAMES_ONLY !== '1') {
      // Asset import can take time on a fresh profile. Begin the uninterrupted
      // minute in a new document; never reload inside the measured window.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => {
          const v = document.querySelector('video.html5-main-video');
          return v && v.readyState >= 2;
        },
        {},
        { timeout: 45000 },
      );
      await selectContext();
      await page.evaluate(async () => {
        const v = document.querySelector('video.html5-main-video');
        v.muted = true;
        await v.play();
      });
      await page.waitForTimeout(5000);
      await page.evaluate(() => {
        const v = document.querySelector('video.html5-main-video');
        globalThis.__g11Video = { element: v, events: [], samples: [], metadata: 0 };
        for (const type of ['loadedmetadata', 'waiting', 'stalled', 'pause', 'seeking', 'emptied', 'error'])
          v.addEventListener(type, () =>
            __g11Video.events.push({ type, at: performance.now(), mediaTime: v.currentTime }),
          );
        __g11Video.timer = setInterval(
          () =>
            __g11Video.samples.push({
              at: performance.now(),
              mediaTime: v.currentTime,
              paused: v.paused,
              readyState: v.readyState,
              sameElement: document.querySelector('video.html5-main-video') === v,
              ad: document.querySelector('#movie_player')?.classList.contains('ad-showing'),
            }),
          1000,
        );
      });
      const start = await videoState();
      await evaluate('__g11Probe.begin(false)');
      console.log('PLAYBACK_STARTED ' + JSON.stringify(start));
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(10000);
        console.log('PLAYBACK ' + JSON.stringify({ seconds: (i + 1) * 10, ...(await videoState()) }));
      }
      const raw = await evaluate('__g11Probe.end()');
      const end = await videoState();
      const validation = await page.evaluate(() => {
        clearInterval(__g11Video.timer);
        return {
          events: __g11Video.events,
          samples: __g11Video.samples,
          sameElement: __g11Video.element === document.querySelector('video.html5-main-video'),
        };
      });
      result.playback = { start, end, validation, summary: summarize(raw) };
      await writeFile(path.join(work, 'playback-raw.json'), JSON.stringify(raw));
      await save();
      console.log('PLAYBACK_RESULT ' + JSON.stringify(result.playback.summary));
      if (
        !start ||
        !end ||
        !validation.sameElement ||
        end.currentTime - start.currentTime < 59 ||
        validation.samples.length < 58 ||
        validation.samples.some((s) => !s.sameElement || s.ad || s.paused || s.readyState < 2) ||
        validation.events.some((e) =>
          ['loadedmetadata', 'emptied', 'error', 'seeking', 'pause', 'waiting'].includes(e.type),
        )
      )
        throw new Error('Invalid 60 second playback sample; excluded from accepted measurements.');
    }
    const content = await readFile(
      process.env.G11_CONTENT_FILE ?? path.join(extensionPath, 'content/index.js'),
      'utf8',
    );
    for (let pair = result.pairs.length; pair < pairCount; pair++) {
      const order = pair % 2 ? [true, false] : [false, true];
      const row = { pair, order: order.map((v) => (v ? 'guarded' : 'unguarded')), blocks: [] };
      for (const guarded of order) {
        if (process.env.G11_FRAMES_ONLY === '1') {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForFunction(
            () => {
              const v = document.querySelector('video.html5-main-video');
              return v && v.readyState >= 2;
            },
            {},
            { timeout: 45000 },
          );
          await selectContext();
          await page.evaluate(async () => {
            const v = document.querySelector('video.html5-main-video');
            v.muted = true;
            await v.play();
          });
        }
        if (!startup) {
          await evaluate(`globalThis.__g11DisableGuard=${!guarded};\n${content}`);
          await page.waitForTimeout(settleMs);
          await evaluate('__g11Probe.begin(true)');
          await page.waitForTimeout(3000);
          await evaluate('__g11Probe.end()');
        }
        const before = await videoState();
        await page.evaluate(() => {
          const element = document.querySelector('video.html5-main-video');
          globalThis.__g11FrameVideo = { element, events: [] };
          for (const type of ['loadedmetadata', 'emptied', 'error', 'seeking', 'pause', 'waiting'])
            element.addEventListener(type, () => __g11FrameVideo.events.push(type));
        });
        const trace = [];
        const collect = ({ value }) => trace.push(...value);
        session.on('Tracing.dataCollected', collect);
        await session.send('Tracing.start', {
          categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
          transferMode: 'ReportEvents',
        });
        await evaluate('__g11Probe.begin(true)');
        if (startup) await evaluate(`globalThis.__g11DisableGuard=${!guarded};\n${content}`);
        await page.waitForTimeout(6000);
        const data = await evaluate('__g11Probe.end()');
        const traceDone = new Promise((resolve) => session.once('Tracing.tracingComplete', resolve));
        await session.send('Tracing.end');
        await traceDone;
        session.off('Tracing.dataCollected', collect);
        await writeFile(
          path.join(work, `pair-${pair}-${guarded ? 'guarded' : 'unguarded'}-trace.json`),
          JSON.stringify({ traceEvents: trace }),
        );
        const after = await videoState();
        const validation = await page.evaluate(() => ({
          sameElement: __g11FrameVideo.element === document.querySelector('video.html5-main-video'),
          events: __g11FrameVideo.events,
        }));
        if (
          !before ||
          !after ||
          before.paused ||
          after.paused ||
          before.readyState < 2 ||
          after.readyState < 2 ||
          after.currentTime - before.currentTime < 5 ||
          before.ad ||
          after.ad ||
          !validation.sameElement ||
          validation.events.length
        )
          throw new Error('Invalid playback state in comparison block.');
        const summary = summarize(data);
        const state = await evaluate(
          '({guard:Boolean(__g11Probe.controller.safety),nodes:document.querySelectorAll("#web-world-themes-decorations").length})',
        );
        if (state.guard !== guarded || summary.extensionFrameCpuMs.count < 1)
          throw new Error('Invalid comparison block: ' + JSON.stringify({ state, summary }));
        row.blocks.push({ guarded, before, after, validation, summary });
        await writeFile(
          path.join(work, `pair-${pair}-${guarded ? 'guarded' : 'unguarded'}-raw.json`),
          JSON.stringify(data),
        );
        console.log('FRAME_BLOCK ' + JSON.stringify({ pair, guarded, summary }));
      }
      result.pairs.push(row);
      await save();
    }
    await evaluate(`globalThis.__g11DisableGuard=false;\n${content}`);
  }
} catch (error) {
  result.failure = error.stack;
  if (page) {
    console.log(
      'FAILURE_PAGE ' +
        JSON.stringify({
          url: page.url(),
          video: await videoState().catch(() => null),
          text: (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 1800),
        }),
    );
    await page.screenshot({ path: path.join(work, 'failure.png') }).catch(() => {});
  }
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await save();
  const closeRequestedAt = Date.now();
  const timer =
    process.platform === 'win32' && process.env.G11_HEADED !== '1'
      ? setTimeout(
          () =>
            execFile(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-File',
                path.resolve('scripts/close-test-browser.ps1'),
                '-OwnedProfile',
                profile,
                '-ExtensionPath',
                extensionPath,
                '-CloseRequestedAtUnixMs',
                String(closeRequestedAt),
              ],
              { windowsHide: true },
              () => {},
            ),
          10000,
        )
      : undefined;
  timer?.unref();
  try {
    await context.close();
  } finally {
    clearTimeout(timer);
  }
  console.log('SAVED ' + output);
}
