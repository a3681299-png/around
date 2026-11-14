// UI0-d: the real native side panel remains attached during steady state and a YouTube SPA.
// Reuse UI1's isolated-world callback probe, document-start frame clock and host CPU audit.
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFrameClock, sampleFrameClock } from '../ui1/frame-clock.mjs';
import { auditHost } from '../ui1/host-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
process.env.AROUND_TEST_WINDOW_OFFSCREEN = '1';
const inWork = (value) => {
  const full = path.resolve(value),
    relative = path.relative(path.join(root, '.work'), full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Output must stay in .work.');
  return full;
};
const work = inWork(process.env.UI0D_WORK ?? '.work/ui0d-performance');
await mkdir(work, { recursive: true });
const helper = path.join(work, 'helpers.mjs');
await build({
  stdin: {
    contents:
      'export { launchExtension } from "./tests/fixtures.ts"; export { sidePanelDriver } from "./tests/helpers/side-panel.ts"; export { declinePromotion } from "./tests/helpers/youtube-live.ts";',
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: helper,
});
const { launchExtension, sidePanelDriver, declinePromotion } = await import(pathToFileURL(helper).href);
const builds = {
  before: inWork(process.env.UI0D_BEFORE ?? '.work/ui0dv-base/.work/ui0dv-before'),
  after: inWork(process.env.UI0D_AFTER ?? '.work/ui0dv-after'),
};
const url = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const pairs = Number(process.env.UI0D_PAIRS ?? 4);
if (!Number.isInteger(pairs) || pairs < 1) throw Error('Invalid pair count.');
const phaseMs = 6000;
export function stats(values) {
  const s = [...values].sort((a, b) => a - b),
    n = s.length;
  return {
    count: n,
    median: n ? (s[Math.floor((n - 1) / 2)] + s[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? s[Math.ceil(n * 0.95) - 1] : null,
    max: s.at(-1) ?? null,
  };
}
function perFrame(sample) {
  const sums = new Array(sample.frames.length - 1).fill(0);
  for (let i = 0; i < sample.calls.length; i += 2) {
    const start = sample.calls[i];
    let lo = 0,
      hi = sums.length - 1,
      found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sample.frames[mid] <= start) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0 || start >= sample.frames.at(-1)) throw Error('Unaccounted extension callback.');
    sums[found] += sample.calls[i + 1];
  }
  return {
    frames: sums,
    stats: stats(sums),
    callbackKinds: sample.kinds,
    clock: sample.clock,
    totalMs: sums.reduce((a, b) => a + b, 0),
    longestCallbackMs: Math.max(0, ...sample.calls.filter((_, i) => i % 2 === 1)),
  };
}
function fullFrames(events) {
  const threads = new Map();
  for (const e of events)
    if (e.name === 'FireAnimationFrame') threads.set(`${e.pid}:${e.tid}`, (threads.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const main = [...threads].sort((a, b) => b[1] - a[1])[0]?.[0],
    open = new Map(),
    values = [];
  for (const e of events.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts)) {
    if (e.name !== 'AnimationFrame') continue;
    if (e.ph === 's') open.set(e.id, e.ts);
    else if (e.ph === 'f' && open.has(e.id)) {
      values.push((e.ts - open.get(e.id)) / 1000);
      open.delete(e.id);
    }
  }
  return stats(values);
}
const result = {
  measuredAt: new Date().toISOString(),
  url,
  scenario: 'Native S attached: 6s steady, then 6s from search submit (search to search SPA)',
  environment: {
    os: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    node: process.version,
    outerWindow: [1920, 1080],
    deviceScaleFactor: 1,
  },
  builds: {},
  pairs: [],
  allowBackground: process.env.UI1_ALLOW_BACKGROUND === '1',
  profiling: process.env.UI0D_CPUPROFILE === '1',
};
for (const [name, dir] of Object.entries(builds))
  result.builds[name] = JSON.parse(await readFile(path.join(dir, 'ui1-build.json'), 'utf8'));
const save = () => writeFile(path.join(work, 'result.json'), JSON.stringify(result, null, 2));
for (let pair = 0; pair < pairs; pair++) {
  const row = { pair: pair + 1, order: pair % 2 ? ['after', 'before'] : ['before', 'after'], blocks: {} };
  result.pairs.push(row);
  for (const name of row.order) {
    const block = {};
    row.blocks[name] = block;
    block.host = await auditHost();
    await save();
    if (block.host && (!block.host.CodeQuiet || (!block.host.Quiet && !result.allowBackground)))
      throw Error('Host not quiet; raw host audit retained.');
    const profile = await mkdtemp(path.join(work, `${pair + 1}-${name}-profile-`));
    const context = await launchExtension(profile, false, {
      headed: true,
      width: 1920,
      height: 1080,
      extensionPath: builds[name],
    });
    try {
      result.chrome = context.browser()?.version();
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')),
        id = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup/index.html`);
      await popup.evaluate(() =>
        chrome.storage.local.set({
          'around.enabled': true,
          'around.strength': 100,
          'around.safety.emergencyOff': false,
          'around.design.youtube': {
            schemaVersion: 13,
            id: 'ui0d-perf',
            siteId: 'youtube',
            baseThemeId: null,
            rules: [],
            decorations: [],
          },
        }),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await installFrameClock(page);
      const session = await context.newCDPSession(page),
        worlds = new Set();
      session.on('Runtime.executionContextCreated', ({ context: c }) => {
        if (c.auxData?.type === 'isolated') worlds.add(c.id);
      });
      session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
      session.on('Runtime.executionContextsCleared', () => worlds.clear());
      await session.send('Runtime.enable');
      const probe = async (expression) => {
        for (const contextId of worlds) {
          try {
            const r = await session.send('Runtime.evaluate', {
              contextId,
              expression: `globalThis.__ui1Probe?.installed ? (${expression}) : undefined`,
              returnByValue: true,
            });
            if (r.result.value !== undefined) return r.result.value;
          } catch {}
        }
        throw Error('Missing isolated-world probe.');
      };
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-around-surface~="video-card"]').first().waitFor();
      await declinePromotion(page);
      await page.bringToFront(); // The native panel must attach to this active tab.
      const tab = await popup.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
      );
      await popup.evaluate(async (tabId) => {
        const r = await chrome.runtime.sendMessage({ type: 'around:open-side-panel', tabId });
        if (!r?.ok) throw Error(r?.error);
      }, tab);
      const panel = await sidePanelDriver(context, page, id, tab);
      await panel.files([path.resolve('tests/fixtures/motion/petal.png')]);
      await panel.click('[data-tool="browse"]');
      await page.locator('[data-image-id]').waitFor();
      await page.waitForTimeout(8000);
      const origin = await probe('performance.timeOrigin');
      block.viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        visibility: document.visibilityState,
        dpr: devicePixelRatio,
      }));
      block.panel = await panel.evaluate(
        '({width:innerWidth,connected:document.querySelector(".connection-status")?.dataset.connected})',
      );
      if (block.panel.connected !== 'true' || block.viewport.width >= 1920)
        throw Error('Native S did not connect and narrow the target.');
      const measure = async (phase, run) => {
        const events = [],
          collect = ({ value }) => events.push(...value);
        session.on('Tracing.dataCollected', collect);
        await session.send('Tracing.start', {
          categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
          transferMode: 'ReportEvents',
        });
        if (result.profiling) {
          await session.send('Profiler.enable');
          await session.send('Profiler.setSamplingInterval', { interval: 100 });
          await session.send('Profiler.start');
        }
        await probe('(__ui1Probe.begin(),true)');
        await run();
        const sample = await probe('__ui1Probe.end()');
        if (result.profiling) {
          const { profile: cpu } = await session.send('Profiler.stop');
          await writeFile(path.join(work, `${pair + 1}-${name}-${phase}-cpuprofile.json`), JSON.stringify(cpu));
        }
        const done = new Promise((r) => session.once('Tracing.tracingComplete', r));
        await session.send('Tracing.end');
        await done;
        session.off('Tracing.dataCollected', collect);
        await writeFile(
          path.join(work, `${pair + 1}-${name}-${phase}-trace.json`),
          JSON.stringify({ traceEvents: events }),
        );
        return {
          ...perFrame(await sampleFrameClock(page, sample, origin)),
          fullFrame: fullFrames(events),
          panelConnected: await panel.evaluate('document.querySelector(".connection-status")?.dataset.connected'),
          url: page.url(),
        };
      };
      block.steady = await measure('steady', () => page.waitForTimeout(phaseMs));
      await save();
      await page.evaluate(() => {
        globalThis.__ui0dSameDocument = true;
      });
      const search = page.getByRole('combobox', { name: /search|検索/i }).first();
      await search.fill('ambient music');
      block.spa = await measure('spa', async () => {
        await search.press('Enter');
        await page.waitForTimeout(phaseMs);
      });
      block.sameDocument = await page.evaluate(() => globalThis.__ui0dSameDocument === true);
      if (!block.sameDocument || !page.url().includes('ambient') || block.spa.panelConnected !== 'true')
        throw Error('Invalid SPA capture.');
      console.log(
        JSON.stringify({
          pair: pair + 1,
          name,
          host: block.host?.BackgroundPercent,
          steady: block.steady.stats,
          spa: block.spa.stats,
        }),
      );
    } catch (error) {
      block.error = String(error);
      await save();
      throw error;
    } finally {
      await context.close();
    }
    await save();
  }
}
console.log(path.join(work, 'result.json'));
