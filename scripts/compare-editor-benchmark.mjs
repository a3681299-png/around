import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { cpus, platform, arch } from 'node:os';

// Both sides run the unchanged D benchmark in separate Node processes, alternating B/A.
const before = process.argv[2] ?? 'd1a552e';
const rounds = Number(process.argv[3] ?? 5);
const lookups = process.argv[4] === 'world-lookups';
const world = process.argv[4] === 'world' || lookups;
const order = process.argv[5] === 'after' ? ['after', 'before'] : ['before', 'after'];
const steady = process.argv[6] === 'steady';
if (world && steady) throw new Error('Steady mode is for the editor diagnostic only');
const entry = lookups
  ? 'tests/world-lookup-benchmark.spec.ts'
  : world
    ? 'tests/signal-evaluation-benchmark.spec.ts'
    : 'tests/editor-benchmark.spec.ts';
const prefix = world ? 'WORLD_SIGNAL_BENCHMARK ' : 'EDITOR_BENCHMARK ';
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('Invalid round count');
const output = '.work/e-benchmark';
const label = `${lookups ? 'world-lookups-' : world ? 'world-' : ''}${steady ? 'steady-' : ''}`;
let harness = await readFile(entry, 'utf8');
if (steady) {
  // An additional diagnostic, never a replacement for the unchanged D run.
  // Use 2,000 warm-up commands and then the same 100 timed samples. Cycling the
  // valid placements avoids exceeding the existing [0,1] command bounds.
  for (const [from, to] of [
    ['index < 110', 'index < 2100'],
    ['index >= 10', 'index >= 2000'],
    ['index === 109', 'index === 2099'],
    ['index / 1000', '(index % 110) / 1000'],
  ]) {
    if (!harness.includes(from)) throw new Error(`Benchmark source changed: ${from}`);
    harness = harness.replace(from, to);
  }
}
await mkdir(output, { recursive: true });
for (const side of ['before', 'after']) {
  const result = await build({
    stdin: {
      contents: harness,
      resolveDir: resolve('tests'),
      sourcefile: posix.basename(entry),
      loader: 'ts',
    },
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
          // Use the same virtual paths and loader on both sides.
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
            contents:
              side === 'before'
                ? execFileSync('git', ['show', `${before}:${args.path}`], { encoding: 'utf8' })
                : readFileSync(args.path, 'utf8'),
            loader: 'ts',
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  await writeFile(`${output}/${label}${side}.cjs`, result.outputFiles[0].text);
}
const samples = [];
for (let round = 1; round <= rounds; round++)
  for (const side of order) {
    const stdout = execFileSync(process.execPath, [resolve(output, `${label}${side}.cjs`)], {
      encoding: 'utf8',
    });
    const line = stdout.split('\n').find((line) => line.startsWith(prefix));
    if (!line) throw new Error('Benchmark did not produce data');
    const sample = { round, side, results: JSON.parse(line.slice(prefix.length)) };
    samples.push(sample);
    console.log(JSON.stringify(sample));
  }
await writeFile(
  `${output}/${label}alternating.json`,
  JSON.stringify(
    {
      before,
      after: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      rounds,
      order,
      warmup: steady ? 2000 : world ? 100 : 10,
      environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
      samples,
    },
    null,
    2,
  ) + '\n',
);
