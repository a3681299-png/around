import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProfile, browserPath, workPath, revision } from './environment.mjs';
import { mkdir } from 'node:fs/promises';
const bundles = [];
for (const original of [true, false]) {
  const built = await build({
    stdin: {
      contents:
        "export {youtubeOperations} from './src/sites/youtube-operations'; export {safePaintRegions} from './src/world/operations';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: original ? 'OriginalG1' : 'CandidateG11',
    plugins: original
      ? [
          {
            name: 'historical-source',
            setup(b) {
              b.onLoad(
                {
                  filter:
                    /src[\\/](host[\\/](operation-source|operation-composition)|sites[\\/]youtube-operations)\.ts$/,
                },
                ({ path: file }) => ({
                  contents: execFileSync(
                    'git',
                    [
                      'show',
                      'ded8815103e935460528a332762403f24d9f27b4:' +
                        path.relative(process.cwd(), file).replaceAll('\\', '/'),
                    ],
                    { encoding: 'utf8' },
                  ),
                  loader: 'ts',
                }),
              );
            },
          },
        ]
      : [],
  });
  bundles.push(built.outputFiles[0].text);
}
const work = workPath(process.env.G11_WORK ?? `.work/g11-results/source-${Date.now()}`);
await mkdir(work, { recursive: true });
const context = await chromium.launchPersistentContext(await createProfile(), {
  executablePath: browserPath,
  headless: true,
  viewport: { width: 1920, height: 1080 },
});
try {
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=M7lc1UVf-VE', { waitUntil: 'domcontentloaded' });
  await page.locator('#movie_player').waitFor();
  await page.waitForTimeout(5000);
  const session = await context.newCDPSession(page);
  for (const expression of bundles) await session.send('Runtime.evaluate', { expression });
  const result = await page.evaluate(() => {
    const sources = [OriginalG1.youtubeOperations(document), CandidateG11.youtubeOperations(document)];
    sources.forEach((s) => s.capture());
    const getStyle = window.getComputedStyle.bind(window),
      getRect = Element.prototype.getBoundingClientRect;
    let styles = 0,
      rects = 0;
    window.getComputedStyle = (...args) => {
      styles++;
      return getStyle(...args);
    };
    Element.prototype.getBoundingClientRect = function () {
      rects++;
      return getRect.call(this);
    };
    const batches = [];
    let reference, regionsReference;
    for (let pair = 0; pair < 4; pair++)
      for (const index of pair % 2 ? [1, 0] : [0, 1]) {
        styles = rects = 0;
        const source = sources[index],
          start = performance.now();
        source.validate(source.capture(), new KeyboardEvent('keydown'));
        const value = source.capture(),
          ms = performance.now() - start;
        const visible = JSON.stringify(
          value.surfaces.filter((s) => s.availability.visible).map(({ generation, ...s }) => s),
        );
        const regions = JSON.stringify(OriginalG1.safePaintRegions(value, false));
        reference ??= visible;
        regionsReference ??= regions;
        batches.push({
          pair,
          original: index === 0,
          ms,
          styleCalls: styles,
          rectCalls: rects,
          surfaces: value.surfaces.length,
          visible: value.surfaces.filter((s) => s.availability.visible).length,
          visibleEquivalent: visible === reference,
          regionsEquivalent: regions === regionsReference,
        });
      }
    window.getComputedStyle = getStyle;
    Element.prototype.getBoundingClientRect = getRect;
    sources.forEach((s) => s.destroy());
    const video = document.querySelector('video');
    return { batches, video: { currentTime: video?.currentTime, readyState: video?.readyState } };
  });
  if (result.batches.some((b) => !b.visibleEquivalent || !b.regionsEquivalent))
    throw new Error('Historical source safety mismatch');
  await writeFile(path.join(work, 'source-same-dom.json'), JSON.stringify({ revision, ...result }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await context.close();
}
