import { chromium } from 'playwright';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:4173/');
const count = Number(process.argv[3] ?? 5);
if (
  (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 10
)
  throw new Error('Usage: node scripts/playground/measure-start.mjs <Playground root URL> [runs, 1–10]');

const channel = process.env.WW_PLAYGROUND_BROWSER ?? 'chrome';
const browser = await chromium.launch({
  channel,
  headless: false,
  args: [
    '--window-position=-4000,0',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const viewport = { width: 1280, height: 800 };
const samples = [];
try {
  for (let i = 0; i < count; i++) {
    // Fresh contexts plus disabled HTTP cache keep the browser cold. The CDN may still be warm.
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const problems = [];
      page.on('pageerror', (error) => problems.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      await page.addInitScript(() => {
        window.addEventListener(
          'loadeddata',
          (event) => {
            if (event.target instanceof HTMLVideoElement && !performance.getEntriesByName('probe:video').length)
              performance.mark('probe:video');
          },
          true,
        );
      });
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () =>
          performance.getEntriesByName('playground:prepared').length &&
          performance.getEntriesByName('first-contentful-paint').length &&
          performance.getEntriesByName('probe:video').length,
      );
      const resources = () =>
        page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          return [nav, ...performance.getEntriesByType('resource')]
            .filter((entry) => entry?.name.startsWith(location.origin + '/'))
            .map((entry) => ({
              path: new URL(entry.name).pathname,
              transferBytes: entry.transferSize,
              encodedBytes: entry.encodedBodySize,
              decodedBytes: entry.decodedBodySize,
            }));
        });
      const beforeApply = await resources();
      await page.getByRole('button', { name: 'WWT を適用' }).click();
      await page.waitForFunction(
        () =>
          performance.getEntriesByName('playground:resident-frame').length ||
          (document.documentElement.hasAttribute('data-ww-basic') &&
            [...document.querySelectorAll('[id^="web-world-themes"]')].some(
              (host) => host.shadowRoot?.querySelector('.model-media[data-renderer="three"] canvas')?.width > 1,
            )),
      );
      const timings = await page.evaluate(() => {
        const time = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null;
        const click = time('playground:apply');
        const draw = time('playground:spatial-frame');
        const resident = time('playground:resident-frame');
        return {
          ttfbMs: performance.getEntriesByType('navigation')[0].responseStart,
          fcpMs: time('first-contentful-paint'),
          videoMs: time('probe:video'),
          preparedMs: time('playground:prepared'),
          mode: performance.getEntriesByName('playground:prepared')[0].detail,
          applyToSceneMs: draw === null ? null : draw - click,
          applyToResidentMs: (resident ?? performance.now()) - click,
        };
      });
      if (problems.length) throw new Error(problems.join('\n'));
      samples.push({ ...timings, beforeApply, afterApply: await resources() });
    } finally {
      await context.close();
    }
  }
  const summary = (values) => {
    const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return {
      median: (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2,
      p95: sorted[Math.ceil(0.95 * sorted.length) - 1],
    };
  };
  const metrics = ['ttfbMs', 'fcpMs', 'videoMs', 'preparedMs', 'applyToSceneMs', 'applyToResidentMs'];
  const results = Object.fromEntries(metrics.map((key) => [key, summary(samples.map((sample) => sample[key]))]));
  results.beforeApplyBytes = summary(
    samples.map((sample) => sample.beforeApply.reduce((total, resource) => total + resource.transferBytes, 0)),
  );
  console.log(
    JSON.stringify({ url: url.href, chromium: browser.version(), channel, viewport, results, samples }, null, 2),
  );
} finally {
  await browser.close();
}
