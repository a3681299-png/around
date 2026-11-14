// Verification-only dependency substitution. No product source text is rewritten.
import { build } from 'esbuild';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const flags = {
  __AROUND_PAGE_CHANGE_LEGACY__: 'false',
  __AROUND_WORLD_MODE__: '"runtime"',
  __AROUND_WORLD_DEVTOOLS__: 'false',
  __AROUND_ASSET_PROFILE__: 'false',
  __AROUND_PLAYGROUND_TEST__: 'true',
};
const faults = {
  parser: {
    target: 'src/design/schema.ts',
    body: `export * from 'original-module'; export const parseDesign = value => value;`,
  },
  clip: {
    target: 'src/world/operations.ts',
    body: `export * from 'original-module'; export function protectionClip(s) { const r={left:0,top:0,width:s.viewport.width,height:s.viewport.height}; return {regions:[r],path:'M0 0h'+r.width+'v'+r.height+'h'+(-r.width)+'Z'}; }`,
  },
  hysteresis: {
    target: 'src/world/operations.ts',
    body: `export * from 'original-module'; import { stepApproach as original } from 'original-module'; export function stepApproach(previous,snapshot,input,paints) { return original({...previous,near:new Map([...previous.near].map(([k,v])=>[k,{...v,clearSince:input.timeMs-1000}]))},snapshot,input,paints); }`,
  },
};
for (const [name, fault] of Object.entries(faults)) {
  const pg = name !== 'hysteresis';
  const out = path.resolve('.work/fault-' + name);
  await cp(pg ? '.work/playground' : '.work/extension', out, { recursive: true });
  const target = path.resolve(fault.target);
  let substitutions = 0;
  const plugin = {
    name: 'verification-' + name,
    setup(b) {
      b.onResolve({ filter: /^original-module$/ }, () => ({ path: target }));
      b.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith('.')) return;
        if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== target.slice(0, -3)) return;
        substitutions++;
        return { path: 'wrapper', namespace: 'verification' };
      });
      b.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
        contents: fault.body,
        loader: 'js',
        resolveDir: root,
      }));
    },
  };
  await build({
    entryPoints: [pg ? 'src/playground/index.ts' : 'src/content/index.ts'],
    outfile: path.join(out, pg ? 'app.js' : 'content/index.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    charset: 'utf8',
    loader: { '.css': 'text' },
    dropLabels: ['AROUND_TEST_PAGE_CHANGE', 'AROUND_GUARD_TRACE'],
    define: flags,
    plugins: [plugin],
  });
  if (!substitutions) throw Error('Fault not inserted: ' + name);
  await writeFile(path.join(out, 'fault.json'), JSON.stringify({ name, target: fault.target, substitutions }));
}
// An ordinary test-hook build, generated independently of the extension.
const { execFileSync } = await import('node:child_process');
execFileSync(process.execPath, ['scripts/build-playground.mjs'], {
  env: { ...process.env, AROUND_PLAYGROUND_OUT: '.work/playground-test', AROUND_PLAYGROUND_TEST: '1' },
  stdio: 'inherit',
});
await build({
  stdin: {
    contents: `import {createFetchAssets} from './src/playground/assets'; Object.assign(globalThis,{verificationAssets:createFetchAssets});`,
    resolveDir: root,
  },
  outfile: '.work/playground-test/asset-port.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  define: flags,
});
console.log('Created parser/clip/hysteresis fault builds, normal test build, asset-port entry.');
