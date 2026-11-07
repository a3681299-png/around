// UI1 performance on the real YouTube search results (a page with many parts).
//   build: before (29b8d5b) vs after, the same empty native design, separate browsers, alternated.
//   skin:  after build, plain vs all parts skinned (with compact fallbacks), one browser, alternated.
// Pass/fail: extension CPU per frame (all extension callbacks grouped by frame). Full-frame p95
// from the Chrome trace is recorded for reference only.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { auditHost } from './host-audit.mjs';
import { installFrameClock, sampleFrameClock } from './frame-clock.mjs';
import { resumeMeasurement } from './resume.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const mode = process.argv[2];
if (!['build', 'skin'].includes(mode)) throw new Error('Usage: node scripts/ui1/measure.mjs build|skin');
const inWork = (value) => {
  const absolute = path.resolve(value),
    relative = path.relative(path.join(root, '.work'), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Measurement files must stay inside .work.');
  return absolute;
};
const work = inWork(process.env.UI1_WORK ?? `.work/ui1-results/${mode}-${Date.now()}`);
await mkdir(work, { recursive: true });
const pairs = Number(process.env.UI1_PAIRS ?? 4);
const url = process.env.UI1_URL ?? 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const builds = {
  before: inWork(process.env.UI1_BEFORE ?? '.work/ui1-base/.work/ui1-before'),
  after: inWork(process.env.UI1_AFTER ?? '.work/ui1-after'),
};
const PHASE_MS = 6000,
  SETTLE_MS = 8000;
const plain = {
  schemaVersion: 12,
  id: 'ui1-plain',
  siteId: 'youtube',
  baseThemeId: null,
  rules: [],
  decorations: [],
};
const PARTS = [
  'video-card',
  'subscribe-button',
  'like-button',
  'dislike-button',
  'action-button',
  'search-box',
  'filter-chip',
  'description-panel',
  'comment-input',
];

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    mean: n ? values.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.max(0, Math.ceil(n * 0.95) - 1)] : null,
    max: sorted.at(-1) ?? null,
  };
}
/** Extension callback CPU grouped into the frames that contain each callback's start. */
function perFrame({ calls, frames }) {
  const sums = new Array(Math.max(0, frames.length - 1)).fill(0);
  let total = 0;
  for (let i = 0; i < calls.length; i += 2) {
    const start = calls[i],
      ms = calls[i + 1];
    total += ms;
    let low = 0,
      high = frames.length - 2,
      found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (frames[mid] <= start) ((found = mid), (low = mid + 1));
      else high = mid - 1;
    }
    if (found >= 0 && start < frames[frames.length - 1]) sums[found] += ms;
  }
  const span = frames.length > 1 ? frames.at(-1) - frames[0] : 0;
  const accountedMs = sums.reduce((a, b) => a + b, 0);
  if (Math.abs(accountedMs - total) > 0.001) throw new Error(`Dropped extension CPU: ${total - accountedMs}ms`);
  return { frames: sums, totalMs: total, spanMs: span, accountedMs };
}
function traceFrames(events) {
  const counts = new Map();
  for (const e of events)
    if (e.name === 'FireAnimationFrame') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const open = new Map(),
    full = [];
  for (const e of events.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts))
    if (e.name === 'AnimationFrame' && (e.ph === 's' || e.ph === 'f')) {
      if (e.ph === 's') open.set(e.id, e.ts);
      else if (open.has(e.id)) {
        full.push((e.ts - open.get(e.id)) / 1000);
        open.delete(e.id);
      }
    }
  return full;
}

async function launch(build) {
  await mkdir(path.join(root, '.work/ui1-profiles'), { recursive: true });
  const profile = await mkdtemp(path.join(root, '.work/ui1-profiles/run-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.UI1_HEADED !== '1',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${build}`,
      `--load-extension=${build}`,
      ...(process.env.UI1_HEADED === '1' ? ['--window-position=-20000,-20000'] : []),
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
  const page = await context.newPage();
  await installFrameClock(page);
  const session = await context.newCDPSession(page);
  const contexts = new Set();
  session.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.auxData?.type === 'isolated') contexts.add(c.id);
  });
  session.on('Runtime.executionContextDestroyed', ({ executionContextId: id }) => contexts.delete(id));
  session.on('Runtime.executionContextsCleared', () => contexts.clear());
  await session.send('Runtime.enable');
  const errors = [];
  const version = context.browser()?.version();
  page.on('pageerror', (error) => errors.push(error.message));
  const store = (values) => popup.evaluate((values) => chrome.storage.local.set(values), values);
  await store({
    'webWorldThemes.enabled': true,
    'webWorldThemes.strength': 100,
    'webWorldThemes.safety.emergencyOff': false,
    'webWorldThemes.design.youtube': plain,
  });
  async function probe(expression) {
    for (let attempt = 0; attempt < 60; attempt++) {
      for (const id of contexts)
        try {
          const value = await session.send('Runtime.evaluate', {
            expression: `globalThis.__ui1Probe?.installed ? (${expression}) : undefined`,
            contextId: id,
            returnByValue: true,
          });
          if (value.result.value !== undefined) return value.result.value;
        } catch {}
      await page.waitForTimeout(100);
    }
    throw new Error('No measurement content script.');
  }
  async function traced(phase, run) {
    const events = [];
    const collect = ({ value }) => events.push(...value);
    session.on('Tracing.dataCollected', collect);
    await session.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
      transferMode: 'ReportEvents',
    });
    const profiling = process.env.UI1_CPUPROFILE === '1';
    if (profiling) {
      await session.send('Profiler.enable');
      await session.send('Profiler.setSamplingInterval', { interval: 100 });
      await session.send('Profiler.start');
    }
    const value = await run();
    if (profiling) {
      const { profile } = await session.send('Profiler.stop');
      await writeFile(
        path.join(work, `${path.basename(build)}-${phase}-${Date.now()}-cpuprofile.json`),
        JSON.stringify(profile),
      );
    }
    const done = new Promise((resolve) => session.once('Tracing.tracingComplete', resolve));
    await session.send('Tracing.end');
    await done;
    session.off('Tracing.dataCollected', collect);
    return { value, full: traceFrames(events) };
  }
  return { context, popup, page, probe, traced, store, errors, version };
}

/** startup (navigation + first 6s), steady (scrolling the feed after settling), SPA (open a video). */
async function phases(browser) {
  const { page, probe, traced } = browser;
  const result = {};
  const startup = await traced('startup', async () => {
    await page.goto(url, { waitUntil: 'commit', timeout: 45000 });
    await page.waitForTimeout(PHASE_MS);
    return probe('__ui1Probe.end()');
  });
  const cards = await page.locator('ytd-video-renderer').count();
  if (cards < 8) throw new Error(`Too few result cards for a list page: ${cards}`);
  // Visible cards only: hidden cards of a previous page are 0×0 and correctly use the compact look.
  const dressed = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-ww-surface~="video-card"]')].filter(
        (node) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).borderImageSource.startsWith('url('),
      ).length,
  );
  const origin = await probe('performance.timeOrigin');
  const startupSample = await sampleFrameClock(page, startup.value, origin, true);
  result.startup = {
    ...perFrame(startupSample),
    clock: startupSample.clock,
    kinds: startup.value.kinds,
    full: startup.full,
    cards,
    dressed,
  };
  await page.waitForTimeout(SETTLE_MS);
  await page.mouse.move(960, 600);
  const steady = await traced('steady', async () => {
    await probe('(__ui1Probe.begin(), true)');
    for (let i = 0; i < PHASE_MS / 500; i++) {
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(500);
    }
    return probe('__ui1Probe.end()');
  });
  const steadySample = await sampleFrameClock(page, steady.value, origin);
  result.steady = {
    ...perFrame(steadySample),
    clock: steadySample.clock,
    kinds: steady.value.kinds,
    full: steady.full,
    cards: await page.locator('ytd-video-renderer').count(),
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  const spa = await traced('spa', async () => {
    await probe('(__ui1Probe.begin(), true)');
    const from = await page.evaluate(() => {
      globalThis.__ui1Same = true;
      const link = [...document.querySelectorAll('ytd-video-renderer a#thumbnail[href*="/watch?v="]')].find(
        (a) => a.getBoundingClientRect().height > 0,
      );
      link?.click();
      return link ? location.href : null;
    });
    if (!from) throw new Error('No video link for the SPA block.');
    await page.waitForTimeout(PHASE_MS);
    const arrived = await page.evaluate(() => ({ url: location.href, same: globalThis.__ui1Same === true }));
    if (!arrived.same || !arrived.url.includes('/watch?v=')) throw new Error('Invalid SPA block.');
    return probe('__ui1Probe.end()');
  });
  const spaSample = await sampleFrameClock(page, spa.value, origin);
  result.spa = { ...perFrame(spaSample), clock: spaSample.clock, kinds: spa.value.kinds, full: spa.full };
  return result;
}

/** Imports one image through the real skin editor, then dresses every part with it. */
async function skinned(browser) {
  const { page, popup } = browser;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('ytd-video-renderer').first().waitFor({ timeout: 30000 });
  await page.bringToFront();
  // The popup acts on the active tab; settings may still be loading right after navigation.
  const editor = page.getByRole('dialog', { name: 'デザインエディター' });
  for (let attempt = 0; attempt < 10 && !(await editor.isVisible()); attempt++) {
    await popup.locator('#creator-editor-open').evaluate((button) => button.click());
    await page.waitForTimeout(1000);
  }
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await editor.locator('.skin-part[data-target="video-card"]').click();
  const chooser = page.waitForEvent('filechooser');
  await editor.locator('.main-drop').click();
  await (await chooser).setFiles(path.resolve('tests/fixtures/motion/petal.png'));
  await editor.locator('.slice').waitFor();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('.status').filter({ hasText: '保存しました。' }).waitFor();
  await editor.getByRole('button', { name: /編集を終了/ }).click();
  // Closing releases the edit lease and prunes unreferenced assets; let that finish while the
  // saved design still references the image, before any design without it is stored.
  await page.waitForTimeout(3000);
  const saved = await popup.evaluate(
    async () => (await chrome.storage.local.get('webWorldThemes.design.youtube'))['webWorldThemes.design.youtube'],
  );
  const assetId = saved.rules[0].skin.states.normal.assetId;
  const frame = { assetId, slices: { top: 12, right: 16, bottom: 12, left: 16 }, center: 'stretch', scalePct: 100 };
  return {
    schemaVersion: 13,
    id: 'ui1-skinned',
    siteId: 'youtube',
    baseThemeId: null,
    rules: PARTS.map((target, index) => ({
      kind: 'surface-style',
      target,
      style: {},
      skin: {
        states: { normal: frame, hover: { ...frame, center: 'repeat' }, pressed: frame },
        // UI1_COMPACT=0 isolates the compact-size observer from the CSS itself.
        ...(index % 3 === 0 && process.env.UI1_COMPACT !== '0' ? { compact: { kind: 'color', color: '#3d3654' } } : {}),
      },
    })),
    decorations: [],
  };
}

let result = {
  mode,
  url,
  measuredAt: new Date().toISOString(),
  environment: {
    os: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    node: process.version,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    phaseMs: PHASE_MS,
    settleMs: SETTLE_MS,
    hostAudit: process.env.UI1_HOST_AUDIT === '1',
    allowBackground: process.env.UI1_ALLOW_BACKGROUND === '1',
    diagnosticOnly: process.env.UI1_CPUPROFILE === '1' || process.env.UI1_DIAGNOSTIC === '1',
    compact: process.env.UI1_COMPACT !== '0',
  },
  builds: {},
  pairs: [],
};
for (const [name, dir] of Object.entries(builds))
  result.builds[name] = JSON.parse(await readFile(path.join(dir, 'ui1-build.json'), 'utf8').catch(() => 'null'));
for (const name of mode === 'build' ? ['before', 'after'] : ['after']) {
  const metadata = result.builds[name];
  if (metadata?.probe !== 'isolated-world-v3' || metadata.asyncContinuations !== 'lowered-promises')
    throw new Error(`Rebuild ${name}: native async continuations are not captured by the old probe.`);
  if (metadata.busyMs !== 0) throw new Error('A calibration workload cannot be used for the performance gate.');
  if ((metadata.disableInk || !result.environment.compact) && !result.environment.diagnosticOnly)
    throw new Error('Disabled features require UI1_DIAGNOSTIC=1; they cannot determine the performance gate.');
}
if (process.env.UI1_RESUME === '1')
  result = resumeMeasurement(
    JSON.parse(await readFile(path.join(work, 'result.json'), 'utf8')),
    result,
    mode === 'build' ? ['before', 'after'] : ['plain', 'skinned'],
  );
const save = () => writeFile(path.join(work, 'result.json'), JSON.stringify(result));
let shared;
try {
  let skinDesign;
  if (mode === 'skin') {
    shared = await launch(builds.after);
    skinDesign = await skinned(shared);
    result.skinDesign = skinDesign;
  }
  for (let pair = result.pairs.length; pair < pairs; pair++) {
    const order =
      mode === 'build'
        ? pair % 2
          ? ['after', 'before']
          : ['before', 'after']
        : pair % 2
          ? ['skinned', 'plain']
          : ['plain', 'skinned'];
    const row = { pair, order, blocks: {} };
    result.pairs.push(row);
    for (const condition of order) {
      const browser = mode === 'build' ? await launch(builds[condition]) : shared;
      try {
        if (mode === 'skin')
          await browser.store({ 'webWorldThemes.design.youtube': condition === 'skinned' ? skinDesign : plain });
        await browser.page.goto('about:blank');
        let host = await auditHost();
        while (host && !host.CodeQuiet) {
          (row.waitingForCodeSession ??= []).push({ condition, ...host });
          await save();
          console.log(
            'WAIT_CODE ' +
              JSON.stringify({ pair, condition, background: host.BackgroundPercent, code: host.OtherCodeSessions }),
          );
          host = await auditHost();
        }
        if (host) {
          (row.host ??= {})[condition] = host;
          await save();
          console.log(
            'HOST ' +
              JSON.stringify({
                pair,
                condition,
                quiet: host.Quiet,
                backgroundPercent: host.BackgroundPercent,
                otherCode: host.OtherCodeSessions,
              }),
          );
          if (!host.Quiet && process.env.UI1_ALLOW_BACKGROUND !== '1')
            throw new Error('Host is busy; the unmeasured block is retained for diagnosis.');
        }
        const measured = await phases(browser);
        if (mode === 'skin') {
          const dressed = measured.startup.dressed;
          if ((condition === 'skinned') !== dressed > 0)
            throw new Error(`Skin state does not match the condition: ${condition} ${dressed}`);
          measured.dressedCards = dressed;
        }
        measured.errors = [...browser.errors];
        measured.chrome = browser.version;
        measured.native = await browser.page.evaluate(() => ({
          advert: Boolean(document.querySelector('.ad-showing')),
          dialogs: [...document.querySelectorAll('[role="dialog"]')]
            .filter((e) => e.getBoundingClientRect().height > 0)
            .map((e) => e.textContent?.slice(0, 200)),
        }));
        row.blocks[condition] = measured;
        await save();
        const brief = Object.fromEntries(
          ['startup', 'steady', 'spa'].map((phase) => [
            phase,
            {
              cpu: stats(measured[phase].frames),
              full95: stats(measured[phase].full).p95,
            },
          ]),
        );
        console.log('BLOCK ' + JSON.stringify({ pair, condition, brief }));
      } finally {
        if (mode === 'build') await browser.context.close();
      }
    }
    await save();
  }
  const conditions = mode === 'build' ? ['before', 'after'] : ['plain', 'skinned'];
  result.summary = Object.fromEntries(
    ['startup', 'steady', 'spa'].map((phase) => [
      phase,
      Object.fromEntries(
        conditions.map((condition) => {
          const blocks = result.pairs.map((row) => row.blocks[condition][phase]);
          return [
            condition,
            {
              extensionCpuPerFrameMs: stats(blocks.flatMap((block) => block.frames)),
              extensionCpuPerSecondMs: stats(blocks.map((block) => (1000 * block.totalMs) / block.spanMs)),
              fullFrameMs: stats(blocks.flatMap((block) => block.full)),
              pairMedians: blocks.map((block) => stats(block.frames).median),
              pairP95: blocks.map((block) => stats(block.frames).p95),
            },
          ];
        }),
      ),
    ]),
  );
  for (const phase of ['startup', 'steady', 'spa']) {
    const [a, b] = conditions.map((condition) => result.summary[phase][condition].extensionCpuPerFrameMs);
    result.summary[phase].delta = {
      median: b.median - a.median,
      p95: b.p95 - a.p95,
      limits: { median: 0.5, p95: 1 },
      pass: b.median - a.median <= 0.5 && b.p95 - a.p95 <= 1,
    };
  }
  await save();
  console.log('SUMMARY ' + JSON.stringify(result.summary, null, 2));
} catch (error) {
  result.failure = error.stack;
  await save();
  await shared?.page.screenshot({ path: path.join(work, 'failure.png'), caret: 'initial' }).catch(() => {});
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await shared?.context.close();
  console.log('SAVED ' + path.join(work, 'result.json'));
  // Over 20 GB, at most once a day: the oldest outputs go by the rules of scripts/clean-work.mjs.
  (await import('../clean-work.mjs')).autoClean(
    path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
  );
}
