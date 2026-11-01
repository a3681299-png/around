// UI0-c short check on the real YouTube search results: the editor's marks on the page.
//   hover:  skin tool open, the pointer crosses video cards and plain controls for 6s.
//   scroll: a video card selected in the quick editor, the feed scrolled down and back for 10s.
// Builds come from scripts/ui1/build.mjs (isolated-world callback probe), before and after,
// alternated in fresh signed-out profiles. Extension CPU per frame is the measure; long tasks
// (over 50ms, the whole page) and the longest extension callback are recorded beside it.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installFrameClock, sampleFrameClock } from '../ui1/frame-clock.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const inWork = (value) => {
  const absolute = path.resolve(value),
    relative = path.relative(path.join(root, '.work'), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Measurement files must stay inside .work.');
  return absolute;
};
const work = inWork(process.env.UI0C_WORK ?? `.work/ui0c-results/marks-${Date.now()}`);
await mkdir(work, { recursive: true });
const pairs = Number(process.env.UI0C_PAIRS ?? 2);
const url = 'https://www.youtube.com/results?search_query=lofi+hip+hop';
const builds = {
  before: inWork(process.env.UI0C_BEFORE ?? '.work/ui0c-base/.work/ui0c-before'),
  after: inWork(process.env.UI0C_AFTER ?? '.work/ui0c-after'),
};
const plain = { schemaVersion: 13, id: 'ui0c-plain', siteId: 'youtube', baseThemeId: null, rules: [], decorations: [] };
// UI0C_FEATURES=off: every retro display option stored OFF as well (the baseline for the retro
// theme's removal). Builds without those options ignore the keys.
const RETRO_FEATURES = [
  'window-chrome',
  'palette',
  'glossy-titlebars',
  'focus-titlebars',
  'daily-details',
  'surface-noise',
  'bbs-comments',
  'transparent-background',
  'lcd-durations',
  'readable-votes',
];
const featureValues =
  process.env.UI0C_FEATURES === 'off'
    ? Object.fromEntries(RETRO_FEATURES.map((id) => [`webWorldThemes.features.${id}`, false]))
    : {};

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.max(0, Math.ceil(n * 0.95) - 1)] : null,
    max: sorted.at(-1) ?? null,
  };
}
function perFrame({ calls, frames }) {
  const sums = new Array(Math.max(0, frames.length - 1)).fill(0);
  let longest = 0;
  for (let i = 0; i < calls.length; i += 2) {
    const start = calls[i],
      ms = calls[i + 1];
    longest = Math.max(longest, ms);
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
  return { frames: sums, longestCallbackMs: longest };
}

async function launch(build) {
  await mkdir(path.join(root, '.work/ui0c-profiles'), { recursive: true });
  const profile = await mkdtemp(path.join(root, '.work/ui0c-profiles/run-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
  await popup.evaluate(
    ({ design, features }) =>
      chrome.storage.local.set({
        'webWorldThemes.enabled': true,
        'webWorldThemes.strength': 100,
        'webWorldThemes.safety.emergencyOff': false,
        'webWorldThemes.design.youtube': design,
        ...features,
      }),
    { design: plain, features: featureValues },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await installFrameClock(page);
  // Long tasks of the whole page, from document start.
  await page.addInitScript(() => {
    globalThis.__ui0cLong = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) globalThis.__ui0cLong.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
  });
  const session = await context.newCDPSession(page);
  const contexts = new Set();
  session.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.auxData?.type === 'isolated') contexts.add(c.id);
  });
  session.on('Runtime.executionContextDestroyed', ({ executionContextId: id }) => contexts.delete(id));
  session.on('Runtime.executionContextsCleared', () => contexts.clear());
  await session.send('Runtime.enable');
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
  return { context, popup, page, probe, version: context.browser()?.version() };
}

async function openEditor({ page, popup }) {
  await page.bringToFront();
  const editor = page.getByRole('dialog', { name: 'デザインエディター' });
  for (let attempt = 0; attempt < 10 && !(await editor.isVisible()); attempt++) {
    await popup.locator('#creator-editor-open').evaluate((button) => button.click());
    await page.waitForTimeout(1000);
  }
  return editor;
}

async function measure(browser, run) {
  const { page, probe } = browser;
  const origin = await probe('performance.timeOrigin');
  const from = await page.evaluate(() => performance.now());
  await probe('(__ui1Probe.begin(), true)');
  await run();
  const sample = await probe('__ui1Probe.end()');
  const to = await page.evaluate(() => performance.now());
  const framed = perFrame(await sampleFrameClock(page, sample, origin));
  const long = await page.evaluate(
    ([from, to]) => globalThis.__ui0cLong.filter(([start]) => start >= from && start <= to).map(([, d]) => d),
    [from, to],
  );
  return { ...stats(framed.frames), longestCallbackMs: framed.longestCallbackMs, longTasks: long };
}

async function scenarios(browser) {
  const { page } = browser;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const cards = page.locator('[data-ww-surface~="video-card"]');
  await cards.nth(3).waitFor();
  await page.waitForTimeout(8000);
  // The skin tool, the pointer crossing cards and controls.
  let editor = await openEditor(browser);
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await page.waitForTimeout(1500);
  const hover = await measure(browser, async () => {
    for (let i = 0; i < 12; i++) {
      const y = 200 + (i % 4) * 200;
      await page.mouse.move(80, y, { steps: 2 });
      await page.mouse.move(900, y + 60, { steps: 20 });
      await page.waitForTimeout(100);
    }
  });
  await editor.getByRole('button', { name: /編集を終了/ }).click();
  await page.waitForTimeout(1500);
  // A card selected in the quick editor, the feed scrolled for 10s.
  editor = await openEditor(browser);
  await page.mouse.move(1700, 300);
  await cards
    .nth(1)
    .locator('a')
    .first()
    .click({ position: { x: 20, y: 20 } });
  await page.locator('[data-ww-editor-selected]').waitFor();
  await page.waitForTimeout(1500);
  const scroll = await measure(browser, async () => {
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, i < 20 ? 90 : -90);
      await page.waitForTimeout(250);
    }
  });
  return { hover, scroll };
}

/** UI0-d: the Studio window as a tab, connected to the YouTube tab. */
async function openStudio({ context, popup, page }) {
  await page.bringToFront();
  const tab = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  const studio = await context.newPage();
  await studio.setViewportSize({ width: 1440, height: 900 });
  await studio.goto(`chrome-extension://${new URL(popup.url()).host}/studio/index.html?target=${tab}`);
  // The connection line may sit in the status bar's tooltip; its state is what matters.
  await studio
    .locator('.connection-status[data-connected="true"]')
    .waitFor({ state: 'attached' })
    .catch(async (error) => {
      const line = await studio.locator('.connection-status').textContent();
      throw new Error(`Editor window for tab ${tab} did not connect: ${line} (${String(error).slice(0, 80)})`);
    });
  await page.bringToFront();
  return studio.getByRole('dialog', { name: 'デザインエディター' });
}
/** UI0-d: the skin tool's page-side work, opened from the floating editor or from the Studio page. */
async function skinSurface(browser, surface) {
  const { page } = browser;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ww-surface~="video-card"]').nth(3).waitFor();
  await page.waitForTimeout(8000);
  const editor = surface === 'window' ? await openStudio(browser) : await openEditor(browser);
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await page.waitForTimeout(1500);
  const hover = await measure(browser, async () => {
    for (let i = 0; i < 12; i++) {
      const y = 200 + (i % 4) * 200;
      await page.mouse.move(80, y, { steps: 2 });
      await page.mouse.move(900, y + 60, { steps: 20 });
      await page.waitForTimeout(100);
    }
  });
  return { hover };
}
/**
 * UI0-d round 3: the page with the editor closed (startup: 6s from navigation; steady: 10s of pointer
 * movement), then edited from the editor window (skin tool hover; a card chosen with the card tool,
 * the feed scrolled). Both builds edit through the window, which both have.
 */
async function ui0d3(browser) {
  const { page } = browser;
  await page.goto(url, { waitUntil: 'commit' });
  const startup = await measure(browser, async () => {
    await page.waitForTimeout(6000);
  });
  await page.locator('[data-ww-surface~="video-card"]').nth(3).waitFor();
  await page.waitForTimeout(4000);
  const steady = await measure(browser, async () => {
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(100 + (i % 5) * 300, 200 + (i % 3) * 200, { steps: 10 });
      await page.waitForTimeout(400);
    }
  });
  let editor = await openStudio(browser);
  await editor.getByRole('button', { name: 'UIを着せ替え' }).click();
  await page.waitForTimeout(1500);
  const hover = await measure(browser, async () => {
    for (let i = 0; i < 12; i++) {
      const y = 200 + (i % 4) * 200;
      await page.mouse.move(80, y, { steps: 2 });
      await page.mouse.move(900, y + 60, { steps: 20 });
      await page.waitForTimeout(100);
    }
  });
  // One editor per tab: the first window is closed before the next opens.
  await editor.page().close();
  await page.waitForTimeout(500);
  editor = await openStudio(browser);
  await editor.getByRole('button', { name: '動画カードを編集' }).click();
  await page.mouse.move(1700, 300);
  await page
    .locator('[data-ww-surface~="video-card"]')
    .nth(1)
    .locator('a')
    .first()
    .click({ position: { x: 20, y: 20 } });
  await page.locator('[data-ww-editor-selected]').waitFor();
  await page.waitForTimeout(1500);
  const scroll = await measure(browser, async () => {
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, i < 20 ? 90 : -90);
      await page.waitForTimeout(250);
    }
  });
  return { startup, steady, hover, scroll };
}
const surfaceMode = process.env.UI0C_MODE === 'surface';
const ui0d3Mode = process.env.UI0C_MODE === 'ui0d3';

const result = {
  url,
  mode: surfaceMode
    ? 'surface (after build: floating vs window)'
    : ui0d3Mode
      ? 'ui0d3 (before vs after: closed startup/steady, window hover/scroll)'
      : 'build (before vs after)',
  measuredAt: new Date().toISOString(),
  features: process.env.UI0C_FEATURES === 'off' ? 'all retro display options stored OFF' : 'stored defaults',
  environment: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, node: process.version },
  builds: {},
  pairs: [],
};
for (const [name, dir] of Object.entries(builds))
  result.builds[name] = JSON.parse(await readFile(path.join(dir, 'ui1-build.json'), 'utf8'));
for (let pair = 0; pair < pairs; pair++) {
  const order = surfaceMode
    ? pair % 2
      ? ['window', 'floating']
      : ['floating', 'window']
    : pair % 2
      ? ['after', 'before']
      : ['before', 'after'];
  const row = { pair, order, blocks: {} };
  result.pairs.push(row);
  for (const condition of order) {
    const browser = await launch(surfaceMode ? builds.after : builds[condition]);
    result.browser = browser.version;
    try {
      row.blocks[condition] = surfaceMode
        ? await skinSurface(browser, condition)
        : ui0d3Mode
          ? await ui0d3(browser)
          : await scenarios(browser);
    } catch (error) {
      row.blocks[condition] = { error: String(error).slice(0, 600) };
    } finally {
      await browser.context.close();
    }
    await writeFile(path.join(work, 'result.json'), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({ pair, condition, ...row.blocks[condition] }, (key, value) =>
        key === 'longTasks' ? value.length : value,
      ),
    );
  }
}
console.log(path.join(work, 'result.json'));
