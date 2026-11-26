// Re-execute the introducing commit, rather than derive v13 from v14.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ref = '3e18edcadf07fe04aa0195556bdb97149aeed017',
  file = 'tests/vrm-data.spec.ts',
  title = 'VRM1 preserves humanoid, expression, spring and MToon capabilities with v11 roundtrip';
let captured;
const done = Symbol('captured');
const context = vm.createContext({
  module: { exports: {} },
  require: createRequire(import.meta.url),
  Buffer,
  TextDecoder,
  TextEncoder,
  structuredClone,
  __title: title,
  __run: (fn) => {
    try {
      fn();
    } catch (e) {
      if (e !== done) throw e;
    }
  },
  __capture: (input, parsed) => {
    assert.equal(input.schemaVersion, 13);
    assert.equal(parsed.schemaVersion, 13);
    captured = JSON.parse(JSON.stringify(input));
    throw done;
  },
});
const output = await build({
  stdin: { contents: `import './${file}';`, resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  plugins: [
    {
      name: 'historical-capture',
      setup(b) {
        b.onResolve({ filter: /^(three(?:\/.*)?|@pixiv\/.*)$/ }, (a) => ({ path: a.path, external: true }));
        b.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: 'test', namespace: 'test-shim' }));
        b.onLoad({ filter: /.*/, namespace: 'test-shim' }, () => ({
          contents:
            'const f=(title,run)=>{if(title===globalThis.__title)globalThis.__run(run)};export const test=new Proxy(f,{get:()=>()=>{}});const any=new Proxy(()=>any,{get:()=>any});export const expect=any;',
          loader: 'js',
        }));
        b.onResolve({ filter: /^original-schema$/ }, () => ({ path: 'src/design/schema.ts', namespace: 'history' }));
        b.onResolve({ filter: /^\./ }, (a) => {
          const p =
            posix
              .normalize(posix.join(a.namespace === 'history' ? posix.dirname(a.importer) : '', a.path))
              .replace(/\.ts$/, '') + '.ts';
          return { path: p, namespace: p === 'src/design/schema.ts' ? 'schema-shim' : 'history' };
        });
        b.onLoad({ filter: /.*/, namespace: 'schema-shim' }, () => ({
          contents:
            'export * from "original-schema";import{parseDesign as original}from"original-schema";export function parseDesign(input){const value=original(input);globalThis.__capture(input,value);return value}',
          loader: 'js',
        }));
        b.onLoad({ filter: /.*/, namespace: 'history' }, (a) => ({
          contents: execFileSync('git', ['show', `${ref}:${a.path}`], { encoding: 'utf8' }),
          loader: 'ts',
        }));
      },
    },
  ],
  logLevel: 'silent',
});
vm.runInContext(output.outputFiles[0].text, context);
assert.ok(captured);
assert.deepEqual(captured, JSON.parse(await readFile('tests/fixtures/designs/history-v13.json', 'utf8')));
await writeFile(
  '.work/evidence/history-v13.json',
  JSON.stringify({ commit: ref, file, title, matched: true, document: captured }, null, 2),
);
console.log('Historical v13 exactly matches the original accepted parser input.');
