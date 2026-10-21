import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import vm from 'node:vm';

// Execute only the named historical test, and capture its first explicit accepted parseDesign input.
// emptyDesign's internal parse is deliberately not intercepted. No data is inferred from newer versions.
const cases = [
  [
    7,
    '71418b2',
    'tests/media2-data.spec.ts',
    'v7 modes and raster speed preserve old v6 defaults; legacy recordings remain replayable',
  ],
  [
    8,
    '281b59c',
    'tests/signal-rules.spec.ts',
    'validated rules roundtrip and reject unknown fields, targets, duplicates, modes, executable values and huge curves',
  ],
  [
    9,
    '37e34ad',
    'tests/signal-motion.spec.ts',
    'X/Y/rotation are offsets, opacity remains replacement; base data and prepared scene remain untouched',
  ],
  [
    10,
    '99a86b4',
    'tests/model-data.spec.ts',
    'bounded original GLB rig exposes arbitrary clips/bones; metadata and asset IDs roundtrip',
  ],
  [
    11,
    '856db47',
    'tests/vrm-data.spec.ts',
    'VRM1 preserves humanoid, expression, spring and MToon capabilities with v11 roundtrip',
  ],
];
const output = 'tests/fixtures/designs';
await mkdir(output, { recursive: true });
const provenance = [];
for (const [version, ref, file, title] of cases) {
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
    __run: (callback) => {
      try {
        callback();
      } catch (error) {
        if (error !== done) throw error;
      }
    },
    __capture: (input, parsed) => {
      if (input.schemaVersion !== version || parsed.schemaVersion !== version)
        throw new Error('Historical version mismatch');
      captured = JSON.parse(JSON.stringify(input));
      throw done;
    },
  });
  const result = await build({
    stdin: { contents: `import './${file}';`, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [
      {
        name: 'historical-test',
        setup(builder) {
          builder.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: 'test', namespace: 'capture-test' }));
          builder.onLoad({ filter: /.*/, namespace: 'capture-test' }, () => ({
            contents:
              'export const test=(title,run)=>{if(title===globalThis.__title)globalThis.__run(run)};const any=new Proxy(()=>any,{get:()=>any});export const expect=any;',
            loader: 'js',
          }));
          builder.onResolve({ filter: /^original-schema$/ }, () => ({
            path: 'src/design/schema.ts',
            namespace: 'historical',
          }));
          builder.onResolve({ filter: /^\./ }, (args) => {
            const path =
              posix
                .normalize(posix.join(args.namespace === 'historical' ? posix.dirname(args.importer) : '', args.path))
                .replace(/\.ts$/, '') + '.ts';
            return { path, namespace: path === 'src/design/schema.ts' ? 'capture-schema' : 'historical' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'capture-schema' }, () => ({
            contents:
              'export * from "original-schema";import {parseDesign as original} from "original-schema";export function parseDesign(input){const parsed=original(input);globalThis.__capture(input,parsed);return parsed;}',
            loader: 'js',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'historical' }, (args) => ({
            contents: execFileSync('git', ['show', `${ref}:${args.path}`], { encoding: 'utf8' }),
            loader: 'ts',
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  vm.runInContext(result.outputFiles[0].text, context);
  if (!captured) throw new Error(`Historical v${version} test did not supply a document`);
  await writeFile(`${output}/history-v${version}.json`, JSON.stringify(captured, null, 2) + '\n');
  provenance.push({
    version,
    commit: execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim(),
    file,
    test: title,
    extraction: 'first explicit parseDesign input accepted by the historical parser',
  });
}
await writeFile(`${output}/chain-provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
console.log('Historical v7-v11 documents captured and accepted by their original parsers.');
