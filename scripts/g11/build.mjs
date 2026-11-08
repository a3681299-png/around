// The G1 measurement build: the extension of a source tree, with the frame probe prepended to the
// content script and the tree's own measurement hooks (src/diagnostics/g11-hooks.ts) turned on by
// the build flag __WW_G11__. Product sources are never rewritten: a tree without the hooks module
// is refused instead of patched.
//   node scripts/g11/build.mjs                    → .work/g11-measurement-dist (this checkout)
//   node scripts/g11/build.mjs <source root>      → <source root>/.work/g11-measurement-dist
// The source root must be this checkout or a tree inside its .work (a worktree of the base commit
// with the hooks commit applied; docs/r3-plan.md 「塊2」 explains how to make one).
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { root, workPath } from './environment.mjs';

/** The hooks version this harness speaks (src/diagnostics/g11-hooks.ts, G11_HOOKS_VERSION). */
const HOOKS_VERSION = 1;
const source = path.resolve(process.argv[2] ?? root);
if (source !== path.resolve(root)) workPath(source); // throws unless inside this checkout's .work
const hooks = path.join(source, 'src/diagnostics/g11-hooks.ts');
if (!existsSync(hooks))
  throw new Error(
    `${source} has no src/diagnostics/g11-hooks.ts. Apply the measurement hooks commit to that tree first (docs/r3-plan.md).`,
  );
const version = /G11_HOOKS_VERSION = (\d+);/.exec(await readFile(hooks, 'utf8'))?.[1];
if (Number(version) !== HOOKS_VERSION)
  throw new Error(`Measurement hooks version ${version} in ${source}; this harness expects ${HOOKS_VERSION}.`);
// WW_LAYERING=0: the earlier cut-out way (docs/layering-plan.md, chunk 4), in its own folder so the
// two ways can be measured alternately. The tree's own default otherwise (layering from chunk 4).
const layering = process.env.WW_LAYERING !== '0';
const out = path.join(source, layering ? '.work/g11-measurement-dist' : '.work/g11-cutout-dist');
workPath(out);

const work = path.join(root, '.work/g11-handoff');
await mkdir(work, { recursive: true });
async function hashes(dir) {
  try {
    await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const rows = [];
  async function walk(at) {
    for (const item of await readdir(at, { withFileTypes: true })) {
      const file = path.join(at, item.name);
      if (item.isDirectory()) await walk(file);
      else
        rows.push([
          path.relative(dir, file).replaceAll('\\', '/'),
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ]);
    }
  }
  await walk(dir);
  return rows.sort(([a], [b]) => a.localeCompare(b));
}
const revision = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
})();
const distBefore = await hashes(path.join(source, 'dist'));
await writeFile(path.join(work, 'protected-before.json'), JSON.stringify({ revision, dist: distBefore }, null, 2));
// The tree's own build makes the complete extension; only content/index.js is rebuilt below.
execFileSync(process.execPath, ['scripts/build.mjs'], {
  cwd: source,
  stdio: 'inherit',
  env: {
    ...process.env,
    WW_BUILD_OUT: path.relative(source, out).replaceAll('\\', '/'),
    WW_ASSET_PROFILE: '0',
    WW_WORLD_MODE: 'runtime',
  },
});
// The frame probe: every extension rAF callback timed and grouped by its frame time. It wraps
// requestAnimationFrame before the content script runs; it reads nothing of the extension's own.
// In a block: run.mjs evaluates this same file again in the isolated world the manifest already
// ran it in (to start the content with or without the guard), and a top-level const would then be
// declared twice ("Identifier '__probe' has already been declared"). The probe itself is installed
// once (globalThis.__g11Probe.installed).
const banner = `{
const __probe = globalThis.__g11Probe ??= { recording: false, force: false, frames: [], captures: [], intervals: [] };
if (!__probe.installed) {
  __probe.installed = true;
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => request((time) => {
    const start = performance.now();
    try { return callback(time); }
    finally { if (__probe.recording) __probe.frames.push({ time, ms: performance.now() - start }); }
  });
  __probe.begin = (force = false) => {
    __probe.frames = []; __probe.captures = []; __probe.intervals = [];
    __probe.force = force; __probe.recording = true; __probe.last = undefined;
    const tick = (time) => {
      if (!__probe.recording) return;
      if (__probe.last !== undefined) __probe.intervals.push(time - __probe.last);
      __probe.last = time;
      if (__probe.force) __probe.refresh?.();
      __probe.pump = request(tick);
    };
    __probe.pump = request(tick);
  };
  __probe.end = () => {
    __probe.recording = false;
    if (__probe.pump !== undefined) cancel(__probe.pump);
    return { frames: __probe.frames, captures: __probe.captures, intervals: __probe.intervals };
  };
}
}
`;
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
  banner: { js: banner },
  // As the normal build: the test probe of the room (a JSON written to the page on every draw) and
  // the development log are not measured.
  dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE', 'WW_SPACE_PROBE', 'WW_DEV_LOG'],
  define: {
    __WW_PAGE_CHANGE_LEGACY__: 'false',
    __WW_WORLD_MODE__: '"runtime"',
    __WW_WORLD_DEVTOOLS__: 'false',
    __WW_ASSET_PROFILE__: 'false',
    __WW_G11__: 'true',
    __WW_LAYERING__: String(layering),
  },
});
// The hooks must have survived bundling: the registration is what run.mjs reads first.
const bundled = await readFile(path.join(out, 'content/index.js'), 'utf8');
if (!bundled.includes('__g11DisableGuard') || !bundled.includes('__g11Probe'))
  throw new Error('The measurement hooks were not bundled; check __WW_G11__ in src/diagnostics/g11-hooks.ts.');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const builtManifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(builtManifest)) throw new Error('Manifest changed');
if (JSON.stringify(await hashes(path.join(source, 'dist'))) !== JSON.stringify(distBefore))
  throw new Error('The normal dist changed during the measurement build.');
console.log(
  JSON.stringify({
    build: path.relative(root, out),
    source: path.relative(root, source) || '.',
    revision,
    hooksVersion: HOOKS_VERSION,
    originalManifestUnchanged: true,
    instrumentation: [
      'recapture timing (g11CaptureStart/End)',
      'all extension RAF callback CPU grouped by RAF time',
      'original RAF interval',
      'guard construction switch (g11GuardDisabled) in the measurement build only',
    ],
  }),
);
