import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { test, expect, type Page } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1920, height: 1080 } });

/** The marking logic alone, bundled for the page. No extension is involved. */
async function surfaceBundle() {
  const result = await build({
    stdin: {
      contents: `
        import { surfacesFor, YOUTUBE_SURFACE_TARGETS } from './src/sites/youtube-surfaces';
        import { createSelectorIndex } from './src/sites/surface-index';
        import { YOUTUBE_SKIN_MARKS } from './src/sites/youtube-targets';
        const rows = [...YOUTUBE_SURFACE_TARGETS, ...YOUTUBE_SKIN_MARKS];
        const index = createSelectorIndex(rows);
        // What the adapter did before UI1.2: test every row whole, in row order.
        const everyRow = rows.map((source) => ({ source, selector: source.selector }));
        globalThis.__surfaceCheck = () => {
          let elements = 0, marked = 0, candidates = 0;
          const differences = [];
          for (const element of document.getElementsByTagName('*')) {
            elements++;
            const indexed = index.candidates(element);
            candidates += indexed.length;
            const a = [...surfacesFor(element, everyRow)].join(' '), b = [...surfacesFor(element, indexed)].join(' ');
            if (a) marked++;
            if (a !== b && differences.length < 10) differences.push({ tag: element.localName, id: element.id, a, b });
          }
          return { elements, marked, entries: index.all.length, meanCandidates: candidates / elements, differences };
        };
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome120',
    loader: { '.css': 'text' },
  });
  return result.outputFiles[0]!.text;
}

async function open(page: Page, url: string) {
  const html = await readFile('tests/fixtures/youtube.html', 'utf8');
  await page.route('https://www.youtube.com/**', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.abort(),
  );
  await page.goto(url);
  await page.addScriptTag({ content: await surfaceBundle() });
}

for (const url of [
  'https://www.youtube.com/',
  'https://www.youtube.com/results?search_query=fixture',
  'https://www.youtube.com/watch?v=fixture',
])
  test(`the index marks exactly what testing every row marks (${new URL(url).pathname})`, async ({ page }) => {
    await open(page, url);
    // The fixture builds its page on click for SPA routes; make sure parts are present.
    const result = await page.evaluate(() => (globalThis as any).__surfaceCheck());
    expect(result.differences).toEqual([]);
    expect(result.marked).toBeGreaterThan(20);
    // The point of the index: far fewer selector tests per element than there are entries.
    expect(result.meanCandidates).toBeLessThan(result.entries / 4);
  });

test('optional real YouTube: the same equality on results, watch and home pages', async ({ page }) => {
  test.skip(process.env.AROUND_LIVE_SURFACES !== '1', 'Explicit signed-out real YouTube check.');
  test.setTimeout(240_000);
  const bundle = await surfaceBundle();
  for (const url of [
    'https://www.youtube.com/results?search_query=lofi+hip+hop',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://www.youtube.com/',
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    if (url.includes('/watch')) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(4000);
    }
    // Real YouTube enforces Trusted Types: evaluate the bundle instead of injecting a script tag.
    await page.evaluate(bundle);
    const result = await page.evaluate(() => (globalThis as any).__surfaceCheck());
    console.log('SURFACES ' + JSON.stringify({ url, ...result, differences: result.differences.length }));
    expect(result.differences, url).toEqual([]);
    expect(result.marked, url).toBeGreaterThan(50);
  }
});
