// UI1 measurement builds: the extension at a given source tree, with a content script that
// records every extension callback. Product sources and the normal dist are never changed.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
const banner = `
const __ui1 = (globalThis.__ui1Probe ??= { calls: [], frames: [], recording: true, top: performance.now() });
if (!__ui1.installed) {
  __ui1.installed = true;
  const raf = window.requestAnimationFrame.bind(window);
  __ui1.raf = raf;
  const wrap = (fn) =>
    function (...args) {
      const start = performance.now();
      try {
        return fn.apply(this, args);
      } finally {
        if (__ui1.recording) __ui1.calls.push(start, performance.now() - start);
      }
    };
  window.requestAnimationFrame = (callback) => raf(wrap(callback));
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, ms, ...rest) => timeout(typeof callback === 'function' ? wrap(callback) : callback, ms, ...rest);
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const Base = window[name];
    if (Base) window[name] = class extends Base { constructor(callback, options) { super(wrap(callback), options); } };
  }
  const add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener,
    wrapped = new WeakMap();
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (typeof listener !== 'function') return add.call(this, type, listener, options);
    let value = wrapped.get(listener);
    if (!value) wrapped.set(listener, (value = wrap(listener)));
    return add.call(this, type, value, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    return remove.call(this, type, (typeof listener === 'function' && wrapped.get(listener)) || listener, options);
  };
  // Frame boundaries from an unwrapped loop; extension work is grouped into these frames.
  const pump = (time) => {
    if (__ui1.recording) __ui1.frames.push(performance.now());
    raf(pump);
  };
  raf(pump);
  __ui1.begin = () => {
    __ui1.calls = [];
    __ui1.frames = [];
    __ui1.recording = true;
  };
  __ui1.end = () => {
    __ui1.recording = false;
    return { calls: __ui1.calls, frames: __ui1.frames };
  };
}
`;
const footer = `if (__ui1.recording) __ui1.calls.push(__ui1.top, performance.now() - __ui1.top);`;
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
  define: { __WW_WORLD_MODE__: '"runtime"', __WW_WORLD_DEVTOOLS__: 'false', __WW_ASSET_PROFILE__: 'false' },
  banner: { js: banner },
  footer: { js: footer },
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
  JSON.stringify({ source, revision, dirtySource: dirty.length > 0 }, null, 2),
);
console.log(JSON.stringify({ out, revision, dirtySource: dirty.length > 0 }));
