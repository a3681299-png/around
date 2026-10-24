import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { root } from './environment.mjs';

const work = path.join(root, '.work/g11-handoff');
const out = '.work/g11-measurement-dist';
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
await writeFile(
  path.join(work, 'protected-before.json'),
  JSON.stringify(
    {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dist: await hashes(path.join(root, 'dist')),
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ['scripts/build.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, WW_BUILD_OUT: out, WW_ASSET_PROFILE: '0', WW_WORLD_MODE: 'runtime' },
});
function replaceOnce(text, before, after, label) {
  if (text.split(before).length !== 2) throw new Error('Unexpected G1 instrumentation point: ' + label);
  return text.replace(before, after);
}
const prefix = `
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
`;
await build({
  absWorkingDir: root,
  entryPoints: ['src/content/index.ts'],
  bundle: true,
  outfile: path.join(out, 'content/index.js'),
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  loader: { '.css': 'text' },
  define: { __WW_WORLD_MODE__: '"runtime"', __WW_WORLD_DEVTOOLS__: 'false', __WW_ASSET_PROFILE__: 'false' },
  plugins: [
    {
      name: 'g11-measurements-only',
      setup(builder) {
        builder.onLoad({ filter: /src[\\/]content[\\/]index\.ts$/ }, async ({ path: file }) => {
          let text = await readFile(file, 'utf8');
          text = replaceOnce(
            text,
            '  const disconnectStudio =',
            `  __probe.controller = controller;
  __probe.snapshot = () => {
    const snapshot = controller.safety?.source.capture();
    const pageSlot = snapshot && controller.safety.source.pageSlot();
    return snapshot ? { snapshot, regions: __g11SafePaintRegions(snapshot, false), pageRegions: pageSlot ? __g11PagePaintRegions(snapshot, false, { left: 0, top: 0, ...snapshot.viewport }) : [], pageSlot: Boolean(pageSlot), videoSlot: Boolean(controller.safety.source.videoSlot()), status: controller.safety.snapshot().stopped } : null;
  };
  const disconnectStudio =`,
            'controller access',
          );
          return {
            contents: `import { safePaintRegions as __g11SafePaintRegions, pagePaintRegions as __g11PagePaintRegions } from '../world/operations';\n${prefix}\n${text}`,
            loader: 'ts',
          };
        });
        builder.onLoad({ filter: /src[\\/]themes[\\/]controller\.ts$/ }, async ({ path: file }) => {
          let text = await readFile(file, 'utf8');
          text = replaceOnce(
            text,
            'const safety = site.operationSurfaces',
            'const safety = !globalThis.__g11DisableGuard && site.operationSurfaces',
            'comparison switch',
          );
          text = replaceOnce(
            text,
            '  let suspended = false;',
            '  globalThis.__g11Probe.refresh = () => images.refresh();\n  let suspended = false;',
            'full renderer redraw',
          );
          return { contents: text, loader: 'ts' };
        });
        builder.onLoad({ filter: /src[\\/]host[\\/]operation-source\.ts$/ }, async ({ path: file }) => {
          let text = await readFile(file, 'utf8');
          text = replaceOnce(
            text,
            '    dirty = false;',
            '    const __captureStart = performance.now();\n    dirty = false;',
            'recapture start',
          );
          text = replaceOnce(
            text,
            '    issued.add(cached);',
            `    issued.add(cached);
    if (globalThis.__g11Probe?.recording) globalThis.__g11Probe.captures.push({ time: __captureStart, ms: performance.now() - __captureStart, surfaces: surfaces.length });`,
            'recapture end',
          );
          return { contents: text, loader: 'ts' };
        });
      },
    },
  ],
});
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const builtManifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(builtManifest)) throw new Error('Manifest changed');
console.log(
  JSON.stringify({
    build: out,
    originalManifestUnchanged: true,
    instrumentation: [
      'recapture timing after cache check',
      'all extension RAF callback CPU grouped by RAF time',
      'original RAF interval',
      'guard construction switch in temporary build only',
    ],
  }),
);
