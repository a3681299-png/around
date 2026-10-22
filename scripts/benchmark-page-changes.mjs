import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { pageChangeBundle } from '../tests/helpers/page-change-build.ts';

// Run in one browser, alternating old/current pages. No extension, private asset or network is needed.
const before = process.argv[2] ?? '28d594a',
  rounds = Number(process.argv[3] ?? 5),
  steps = 60;
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('Invalid round count');
const bundles = { before: await pageChangeBundle(before), after: await pageChangeBundle() },
  html = await readFile('tests/fixtures/youtube.html', 'utf8');
const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.route('https://www.youtube.com/**', (route) =>
  route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: html })
    : route.abort(),
);
const samples = [];
try {
  for (let round = 0; round < rounds; round++)
    for (const side of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const page = await context.newPage();
      await page.goto('https://www.youtube.com/watch?v=fixture');
      await page.addScriptTag({ content: bundles[side] });
      await page.evaluate(async () => {
        globalThis.__pageTest = PageChangeTest.mount();
        await globalThis.__pageTest.mutate(10);
        globalThis.__pageTest.reset();
      });
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      const scriptTime = async () =>
        (await session.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration').value * 1000;
      const start = await scriptTime();
      const counts = await page.evaluate((steps) => globalThis.__pageTest.mutate(steps), steps);
      const sample = { round: round + 1, side, scriptMs: (await scriptTime()) - start, counts };
      samples.push(sample);
      console.log(JSON.stringify(sample));
      await page.close();
    }
  const report = {
    before,
    node: process.version,
    chrome: browser.version(),
    cpu: cpus()[0]?.model,
    viewport: '1920x1080',
    rounds,
    steps,
    metric:
      'CDP Performance.ScriptDuration; includes page scripts and async DOM-following callbacks; excludes idle/paint',
    samples,
  };
  await mkdir('.work/verification', { recursive: true });
  await writeFile('.work/verification/page-changes-alternating.json', JSON.stringify(report, null, 2));
  for (const side of ['before', 'after']) {
    const times = samples
      .filter((s) => s.side === side)
      .map((s) => s.scriptMs)
      .sort((a, b) => a - b);
    console.log(JSON.stringify({ side, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) }));
  }
} finally {
  await browser.close();
}
