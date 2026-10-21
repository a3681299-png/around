import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

// Both sides run the unchanged D benchmark in separate Node processes, alternating B/A.
const before = process.argv[2] ?? 'd1a552e';
const rounds = Number(process.argv[3] ?? 5);
const world = process.argv[4] === 'world';
const entry = world ? 'tests/signal-evaluation-benchmark.spec.ts' : 'tests/editor-benchmark.spec.ts';
const prefix = world ? 'WORLD_SIGNAL_BENCHMARK ' : 'EDITOR_BENCHMARK ';
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('Invalid round count');
const output = '.work/e-benchmark';
await mkdir(output, { recursive: true });
for (const side of ['before', 'after']) {
  const result = await build({
    stdin: { contents: await readFile(entry, 'utf8'), resolveDir: resolve('tests'), sourcefile: entry },
    absWorkingDir: process.cwd(),
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [
      {
        name: 'fixed-benchmark',
        setup(builder) {
          builder.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: 'test', namespace: 'benchmark' }));
          builder.onLoad({ filter: /.*/, namespace: 'benchmark' }, () => ({
            contents:
              'export const test = (_,run) => run({}, {attach:async()=>{}}).catch(error => {console.error(error);process.exitCode=1;});',
            loader: 'js',
          }));
          if (side === 'before') {
            builder.onResolve({ filter: /^\.|^tests\// }, (args) => ({
              path:
                posix
                  .normalize(
                    posix.join(args.namespace === 'baseline' ? posix.dirname(args.importer) : 'tests', args.path),
                  )
                  .replace(/\.ts$/, '') + '.ts',
              namespace: 'baseline',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'baseline' }, (args) => ({
              contents: execFileSync('git', ['show', `${before}:${args.path}`], { encoding: 'utf8' }),
              loader: 'ts',
            }));
          }
        },
      },
    ],
    logLevel: 'silent',
  });
  await writeFile(`${output}/${world ? 'world-' : ''}${side}.cjs`, result.outputFiles[0].text);
}
const samples = [];
for (let round = 1; round <= rounds; round++)
  for (const side of ['before', 'after']) {
    const stdout = execFileSync(process.execPath, [resolve(output, `${world ? 'world-' : ''}${side}.cjs`)], {
      encoding: 'utf8',
    });
    const line = stdout.split('\n').find((line) => line.startsWith(prefix));
    if (!line) throw new Error('Benchmark did not produce data');
    const sample = { round, side, results: JSON.parse(line.slice(prefix.length)) };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
await writeFile(
  `${output}/${world ? 'world-' : ''}alternating.json`,
  JSON.stringify(
    { before, after: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), rounds, samples },
    null,
    2,
  ) + '\n',
);
