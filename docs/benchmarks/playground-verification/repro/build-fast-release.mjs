// Shorten this guard's hysteresis and its wake-up together; do not edit any product source.
import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import path from 'node:path';
const target = path.resolve('src/world/operations.ts');
await cp('.work/extension', '.work/fault-fast-release', { recursive: true });
let injected = 0;
await build({
  entryPoints: ['src/content/index.ts'],
  outfile: '.work/fault-fast-release/content/index.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  loader: { '.css': 'text' },
  dropLabels: ['AROUND_TEST_PAGE_CHANGE', 'AROUND_GUARD_TRACE'],
  define: {
    __AROUND_PAGE_CHANGE_LEGACY__: 'false',
    __AROUND_WORLD_MODE__: '"runtime"',
    __AROUND_WORLD_DEVTOOLS__: 'false',
    __AROUND_ASSET_PROFILE__: 'false',
  },
  banner: {
    js: `{ const native=window.setTimeout.bind(window); window.setTimeout=(fn,ms,...args)=>native(fn,ms===360?60:ms,...args); }`,
  },
  plugins: [
    {
      name: 'shorten-approach-release',
      setup(b) {
        b.onResolve({ filter: /^original-operations$/ }, () => ({ path: target }));
        b.onResolve({ filter: /.*/ }, (args) => {
          if (
            !args.path.startsWith('.') ||
            path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== target.slice(0, -3)
          )
            return;
          injected++;
          return { path: 'short-release', namespace: 'verification' };
        });
        b.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
          contents: `export * from 'original-operations'; import {stepApproach as original} from 'original-operations'; export function stepApproach(previous,snapshot,input,paints){const near=new Map([...previous.near].map(([k,v])=>[k,{...v,clearSince:v.clearSince===null?input.timeMs-300:v.clearSince}]));return original({...previous,near},snapshot,input,paints);}`,
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
if (!injected) throw Error('Fault not inserted');
console.log('Fast-release fault:', injected, 'substitutions; effective 50ms hysteresis, 60ms wake-up.');
