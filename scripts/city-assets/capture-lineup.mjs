// Draw the asset lineup and save one PNG per review view (wwt-asset-review-loop).
//   node scripts/city-assets/capture-lineup.mjs <out-folder> [--views far,mid,near,sil,night,props]
// Development only: the page is bundled into .work/city-lineup and is not part of any build.
// Tsumu (private) is read from WW_TSUMU_GLB or C:/wwt-private/tsumu/work/tsumu-city.glb; without
// it the lineup still draws, without the height reference.
import { build } from 'esbuild';
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [outArg] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!outArg) throw new Error('capture-lineup.mjs <out-folder> [--views far,mid,...]');
const viewsArg = process.argv.find((arg) => arg.startsWith('--views='))?.slice(8);
const views = (viewsArg ?? 'far,mid,near,hero,sil,night,props,culture').split(',');
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const page = join(root, '.work/city-lineup');
mkdirSync(page, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { app: 'scripts/city-assets/lineup/lineup.ts' },
  outdir: page,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  logLevel: 'warning',
});
copyFileSync(join(root, 'scripts/city-assets/lineup/index.html'), join(page, 'index.html'));

const assets = join(root, 'src/playground/city-assets');
const tsumu = process.env.WW_TSUMU_GLB ?? 'C:/wwt-private/tsumu/work/tsumu-city.glb';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
};
const inside = (base, path) => {
  const full = resolve(base, '.' + path);
  return full.startsWith(base + sep) ? full : null;
};
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file =
    path === '/private/tsumu-city.glb'
      ? tsumu
      : path.startsWith('/assets/')
        ? inside(assets, path.slice(7))
        : inside(page, path === '/' ? '/index.html' : path);
  if (!file || !existsSync(file) || !statSync(file).isFile()) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(
  root,
  existsSync(join(root, '.work/browsers')) ? '.work/browsers' : '../browsers',
);
const { chromium } = await import('@playwright/test');
// Headed off screen with the real GPU, like tests/fixtures.ts launchExtension() (AGENTS.md).
const browser = await chromium.launch({
  headless: false,
  args: [
    '--window-position=-4000,0',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
try {
  const tab = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  tab.on('pageerror', (error) => errors.push(String(error)));
  tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const lineScale = process.argv.find((arg) => arg.startsWith('--line-scale='))?.slice(13) ?? '1';
  await tab.goto(url + `?w=1600&h=900&lineScale=${lineScale}`);
  await tab.waitForFunction(() => window.lineup?.ready, null, { timeout: 30_000 });
  await tab.evaluate(() => window.lineup.ready);
  for (const view of views) {
    await tab.evaluate((v) => window.lineup.show(v), view);
    await tab.locator('canvas').screenshot({ path: join(out, `${view}.png`) });
    console.log(`lineup ${view}: ${join(out, view + '.png')}`);
  }
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
