// Positive control on real YouTube. The 2ms workload is scheduled through the instrumented rAF.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditHost } from './host-audit.mjs';
import { installFrameClock, sampleFrameClock } from './frame-clock.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const inWork = (value) => {
  const full = path.resolve(value),
    relative = path.relative(path.join(root, '.work'), full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Calibration must stay inside .work.');
  return full;
};
const normal = inWork(process.env.UI1_AFTER ?? '.work/ui1-verify-target/.work/ui1-after');
const busy = inWork(process.env.UI1_BUSY ?? '.work/ui1-verify-target/.work/ui1-busy');
const output = inWork(process.env.UI1_CALIBRATION_OUT ?? '.work/ui1-verification/calibration.json');
const results = [];
const hostChecks = [];
for (const build of [normal, busy]) {
  const host = await auditHost();
  if (host) {
    hostChecks.push({ build, ...host });
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(path.join(path.dirname(output), 'calibration-hosts.json'), JSON.stringify(hostChecks, null, 2));
    console.log('HOST ' + JSON.stringify(host));
  }
  if (host && (!host.CodeQuiet || (!host.Quiet && process.env.UI1_ALLOW_BACKGROUND !== '1')))
    throw new Error('Host is busy before calibration.');
  const profile = await mkdtemp(path.join(root, '.work/ui1-calibration-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/index.html`);
    await popup.evaluate(() =>
      chrome.storage.local.set({
        'around.enabled': true,
        'around.strength': 100,
        'around.design.youtube': {
          schemaVersion: 12,
          id: 'probe-control',
          siteId: 'youtube',
          baseThemeId: null,
          rules: [],
          decorations: [],
        },
      }),
    );
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page),
      contexts = new Set(),
      worlds = new Map();
    await installFrameClock(page);
    cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
      if (c.auxData?.type === 'isolated') {
        contexts.add(c.id);
        worlds.set(c.id, c);
      }
    });
    await cdp.send('Runtime.enable');
    await page.goto('https://www.youtube.com/results?search_query=lofi+hip+hop', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    let id;
    for (const candidate of contexts) {
      const result = await cdp
        .send('Runtime.evaluate', {
          contextId: candidate,
          expression: 'Boolean(globalThis.__ui1Probe?.installed)',
          returnByValue: true,
        })
        .catch(() => null);
      if (result?.result.value) id = candidate;
    }
    if (!id) throw new Error('Missing isolated-world probe');
    const evaluate = async (expression) =>
      (await cdp.send('Runtime.evaluate', { contextId: id, expression, returnByValue: true })).result.value;
    await evaluate('__ui1Probe.begin()');
    await page.waitForTimeout(3000);
    const sample = await sampleFrameClock(
        page,
        await evaluate('__ui1Probe.end()'),
        await evaluate('performance.timeOrigin'),
      ),
      sums = new Array(sample.frames.length - 1).fill(0);
    for (let i = 0; i < sample.calls.length; i += 2) {
      const index = sample.frames.findIndex((v, j) => v <= sample.calls[i] && sample.frames[j + 1] > sample.calls[i]);
      if (index < 0) throw new Error('Unaccounted calibration callback');
      sums[index] += sample.calls[i + 1];
    }
    const sorted = [...sums].sort((a, b) => a - b);
    const result = {
      build,
      host,
      metadata: JSON.parse(await readFile(path.join(build, 'ui1-build.json'), 'utf8')),
      chrome: context.browser()?.version(),
      contextId: id,
      world: worlds.get(id),
      sample,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      frames: sorted.length,
    };
    results.push(result);
    console.log(JSON.stringify({ ...result, sample: undefined }));
  } finally {
    await context.close();
  }
}
const delta = { median: results[1].median - results[0].median, p95: results[1].p95 - results[0].p95 };
const pass = delta.median >= 1.7 && delta.median <= 2.5 && delta.p95 >= 1.7 && delta.p95 <= 3;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ results, delta, pass, allowBackground: process.env.UI1_ALLOW_BACKGROUND === '1' }, null, 2),
);
if (!pass) throw new Error(`2ms positive control failed: ${JSON.stringify(delta)}`);
