// UI1 measurement builds: the extension at a given source tree, with a content script that
// records every extension callback. Product sources and the normal dist are never changed.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { disableInkPlugin, probeBuildOptions } from './probe-build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) throw new Error('Usage: node scripts/ui1/build.mjs <source root> <.work/output>');
const source = path.resolve(sourceArg);
const out = path.resolve(outArg);
const relative = path.relative(path.join(root, '.work'), out);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
  throw new Error('Measurement builds must stay inside this checkout’s .work directory.');

// The source tree's own build script produces the complete extension first.
const name = path.relative(source, out).replaceAll('\\', '/');
if (!/^\.work\/[a-zA-Z0-9_-]+$/.test(name))
  throw new Error('The output must be a direct .work child of the source root.');
execFileSync(process.execPath, ['scripts/build.mjs'], {
  cwd: source,
  stdio: 'inherit',
  env: { ...process.env, WW_BUILD_OUT: name, WW_ASSET_PROFILE: '0', WW_WORLD_MODE: 'runtime' },
});

// Isolated-world wrappers: only the extension's own callbacks pass through them.
const busyMs = Number(process.env.UI1_PROBE_BUSY_MS ?? 0);
const busyAfterAwait = process.env.UI1_PROBE_AFTER_AWAIT === '1';
const disableInk = process.env.UI1_DISABLE_INK === '1';
const instrumentation = await probeBuildOptions(busyMs, busyAfterAwait);
await build({
  absWorkingDir: source,
  entryPoints: ['src/content/index.ts'],
  bundle: true,
  outfile: path.join(out, 'content/index.js'),
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  loader: { '.css': 'text' },
  dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
  define: {
    __WW_WORLD_MODE__: '"runtime"',
    __WW_WORLD_DEVTOOLS__: 'false',
    __WW_ASSET_PROFILE__: 'false',
    __WW_G11__: 'false',
  },
  ...instrumentation,
  plugins: disableInk ? [disableInkPlugin(source)] : [],
});
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const built = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(built)) throw new Error('Manifest changed');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'manifest.json'], {
  cwd: source,
  encoding: 'utf8',
});
await writeFile(
  path.join(out, 'ui1-build.json'),
  JSON.stringify(
    {
      source,
      revision,
      dirtySource: dirty.length > 0,
      probe: 'isolated-world-v3',
      asyncContinuations: 'lowered-promises',
      busyMs,
      busyAfterAwait,
      disableInk,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ out, revision, dirtySource: dirty.length > 0 }));
