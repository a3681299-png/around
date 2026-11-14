import { readFile, writeFile, mkdir, copyFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = process.cwd(),
  work = path.resolve('.work/r31-fix-evidence'),
  out = path.resolve('docs/benchmarks/r31-fix'),
  perfRoot = path.join(work, 'performance'),
  target = '447b2bf31e319051e327f9ada2b83954276b8ff8',
  before = '8e63f0d451eeaf7811b7e0b5b60070d10b5233a9';
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = async (file, value) => writeFile(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
  };
}
function failureNames(report) {
  const failures = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        if (test.status === 'unexpected')
          failures.push({
            file: spec.file,
            line: spec.line,
            title: spec.title,
            errors: test.results.flatMap((r) => r.errors ?? []),
          });
    for (const child of suite.suites ?? []) walk(child);
  };
  report.suites.forEach(walk);
  return failures;
}
function publicRun(input) {
  const run = structuredClone(input);
  // CPU timestamps and model counters are evidence; private pose/source data and traces are not.
  for (const block of [...Object.values(run.phases), ...Object.values(run.attempts).flat()]) {
    for (const key of ['start', 'finish']) if (block[key]?.media) delete block[key].media.frame;
  }
  if (run.character)
    run.character = {
      placement: run.character.placement,
      embeddedClipCount: run.character.embeddedClips.length,
      motionCount: run.character.motions?.length ?? 0,
    };
  return run;
}

await mkdir(path.join(out, 'repro'), { recursive: true });
const checks = {};
for (const name of [
  'unit-all',
  'targeted',
  'windows-first',
  'windows-all',
  'character-live',
  'repeat-before',
  'repeat-after',
  'repeat2-before',
  'repeat2-after',
]) {
  const report = await json(path.join(work, name + '.json'));
  checks[name] = { ...report.stats, failures: failureNames(report), errors: report.errors };
}
for (const [key, file] of [
  ['typecheck-build', 'build.txt'],
  ['lint', 'lint.txt'],
])
  checks[key] = { log: file };
const ci = await json(path.join(work, 'ci.json'));
if (ci.headSha !== target || ci.status !== 'completed' || ci.conclusion !== 'success')
  throw Error('Expected completed CI for the exact product commit');
await save('ci.json', ci);
const ciLog = await readFile(path.join(work, 'ci.log'), 'utf8');
const ciLines = ciLog.split('\n').filter((line) => /\d+ (passed|skipped)\s*(\(|$)/.test(line));
const ciCounts = {
  unit: { passed: 0, skipped: 0 },
  e2e: { passed: 0, skipped: 0 },
  nativeEntry: { passed: 0, skipped: 0 },
};
for (const line of ciLines) {
  const [, count, result] = line.match(/(\d+) (passed|skipped)\b/);
  const group = line.startsWith('unit\t') ? 'unit' : line.includes('--grep "OFF opens') ? 'nativeEntry' : 'e2e';
  ciCounts[group][result] += Number(count);
}
await save('ci-counts.json', {
  run: ci.databaseId,
  headSha: ci.headSha,
  ...ciCounts,
  sourceLines: ciLines,
});
await save('checks.json', checks);
for (const file of ['independent-data.json', 'compat-before-captured.json'])
  await copyFile(path.join(work, 'original-repro', file), path.join(out, file));
await save('capture-control.json', await json(path.join(work, 'capture-control.json')));
for (const file of [
  'build.txt',
  'lint.txt',
  'r31-1-red-unit.txt',
  'r31-1-red-e2e.txt',
  'r31-2-red.txt',
  'r31-3-red-unit.txt',
  'r31-3-red-e2e.txt',
  'r31-1-refresh-red-unit.txt',
  'r31-1-refresh-red-e2e.txt',
]) {
  const raw = await readFile(path.join(work, file), 'utf8');
  await writeFile(
    path.join(out, file),
    // Keep original logs locally; terminal line endings and padding carry no assertion evidence.
    raw
      .replaceAll(root, 'WORKTREE')
      .replaceAll(root.replaceAll('\\', '/'), 'WORKTREE')
      .replaceAll('\r\n', '\n')
      .replace(/[ \t]+$/gm, ''),
  );
}
for (const file of [
  'windows-sidepanel-failure.jpg',
  'windows-motion-failure.jpg',
  'windows-g12-failure.png',
  'windows-toggle-failure.png',
  'windows-g12-timing.json',
])
  await copyFile(path.join(work, file), path.join(out, file));
const fixture = await readFile('tests/fixtures/backups/legacy-v13-vrm.aroundbackup');
if (!fixture.equals(await readFile('docs/benchmarks/r31-verification/legacy-v13-vrm.aroundbackup')))
  throw Error('The historical fixture changed');

const campaign = await json(path.join(perfRoot, 'runs.json')),
  control = await json(path.join(work, 'capture-control.json')),
  deadline = Math.min(...campaign.runs.map((r) => Date.parse(r.started))) + 3_600_000;
if (control.backgroundPolicy !== 'reference only') throw Error('Missing user-approved background policy');
const phases = [
  'no-character:startup',
  'no-character:steady',
  'no-character:spa',
  'character:startup',
  'character:steady',
  'character:spa',
];
const reviewed = campaign.runs.map((input) => {
  const run = publicRun(input),
    reasons = [];
  if (run.error) reasons.push({ reason: 'run error', error: run.error });
  if (!run.finished) reasons.push({ reason: 'profile interrupted before completion' });
  if (!run.hostBefore || !run.hostAfter) reasons.push({ reason: 'missing background CPU record' });
  for (const phase of phases) {
    const block = run.phases[phase];
    if (!block) {
      reasons.push({ phase, reason: 'missing capture' });
      continue;
    }
    const span = block.clock.end - block.clock.start;
    if (!block.valid || span < 5800 || span > 6500 || block.clock.timeOrigin + block.clock.end > deadline)
      reasons.push({ phase, reason: 'invalid capture window', span });
  }
  run.review = reasons;
  run.usable = !reasons.length;
  return run;
});
const grouped = new Map();
for (const run of reviewed) {
  const pair = grouped.get(run.pair) ?? {};
  pair[run.label] = run;
  grouped.set(run.pair, pair);
}
const available = [...grouped].sort(([a], [b]) => a - b).filter(([, p]) => p.before?.usable && p.after?.usable),
  complete = available.slice(0, 4);
if (complete.length !== 4) throw Error(`Expected four complete pairs, got ${complete.length}`);
const summary = {
  target,
  before,
  environment: campaign.environment,
  completePairs: complete.map(([pair]) => pair),
  availableCompletePairs: available.map(([pair]) => pair),
  oldStrictCompletePairs: [...grouped].filter(([, p]) => p.before?.eligible && p.after?.eligible).map(([pair]) => pair),
  captureControl: control,
  retriedBlocks: reviewed.flatMap((r) =>
    Object.entries(r.attempts)
      .filter(([, blocks]) => blocks.length > 1)
      .map(([phase, blocks]) => ({
        pair: r.pair,
        label: r.label,
        phase,
        attempts: blocks.map((b, index) => ({
          index,
          valid: b.valid,
          adSamples: b.adSamples,
          hiddenSamples: b.hiddenSamples,
          frames: b.cpu.count,
          spanMs: b.clock.end - b.clock.start,
        })),
      })),
  ),
  exclusions: reviewed.filter((r) => !r.usable).map((r) => ({ pair: r.pair, label: r.label, reasons: r.review })),
  criteria: {
    cpuMedianDeltaMs: 0.5,
    cpuP95DeltaMs: 1,
    requiredPairs: 4,
    captureMs: 6000,
    validSpanMs: [5800, 6500],
    backgroundCpu: 'reference only, per user decision',
  },
  calibration: (await json(path.join(work, 'calibration', 'calibration.json'))).delta,
  phases: {},
  pairs: [],
};
for (const phase of phases) {
  const values = {};
  for (const side of ['before', 'after']) {
    const blocks = complete.map(([, pair]) => pair[side].phases[phase]);
    values[side] = {
      cpu: stats(blocks.flatMap((b) => b.raw.cpuPerFrame)),
      frame: stats(blocks.flatMap((b) => b.raw.fullFrameMs)),
      // Last GPU query polled every 250ms; never a per-draw percentile. SPA's stale values are excluded.
      gpu: stats(phase.endsWith(':spa') ? [] : blocks.flatMap((b) => b.raw.gpuMs)),
      video: blocks.reduce(
        (sum, b) => ({ total: sum.total + (b.video?.total ?? 0), dropped: sum.dropped + (b.video?.dropped ?? 0) }),
        { total: 0, dropped: 0 },
      ),
    };
  }
  summary.phases[phase] = {
    ...values,
    cpuDelta: {
      median: values.after.cpu.median - values.before.cpu.median,
      p95: values.after.cpu.p95 - values.before.cpu.p95,
    },
  };
}
summary.pairs = [...grouped].map(([pair, data]) => ({
  pair,
  selected: complete.some(([n]) => n === pair),
  captureComplete: available.some(([n]) => n === pair),
  runs: Object.fromEntries(
    Object.entries(data).map(([label, run]) => [
      label,
      {
        usable: run.usable,
        hostBefore: run.hostBefore,
        hostAfter: run.hostAfter,
        review: run.review,
        artworkOffVideo: run.artworkOffVideo,
        browser: run.browser,
        viewport: run.viewport,
        phases: Object.fromEntries(
          Object.entries(run.phases).map(([phase, b]) => [
            phase,
            {
              cpu: b.cpu,
              frame: b.frame,
              gpu: phase.endsWith(':spa') ? null : b.gpu,
              video: b.video,
              clock: b.clock,
              committedClock: b.committedClock,
              hiddenSamples: b.hiddenSamples,
              adSamples: b.adSamples,
              modelSamples: b.modelSamples,
              trace: b.trace,
            },
          ]),
        ),
      },
    ]),
  ),
}));
await save('performance.json', summary);
await writeFile(path.join(out, 'performance-raw.json.gz'), gzipSync(JSON.stringify({ ...campaign, runs: reviewed })));
const calibrationRuns = await json(path.join(work, 'calibration', 'calibration-runs.json'));
await writeFile(
  path.join(out, 'calibration-raw.json.gz'),
  gzipSync(JSON.stringify({ ...calibrationRuns, runs: calibrationRuns.runs.map(publicRun) })),
);
const firstPair = complete[0][1];
for (const side of ['before', 'after']) {
  const block = firstPair[side].phases['character:steady'],
    packed = await readFile(path.join(perfRoot, block.trace.file));
  if (digest(packed) !== block.trace.sha256) throw Error('Original trace hash differs');
  const trace = JSON.parse(gunzipSync(packed));
  const sanitized = trace.traceEvents.map(({ args: _args, ...event }) => event);
  await writeFile(
    path.join(out, `trace-${side}-character-steady.json.gz`),
    gzipSync(JSON.stringify({ traceEvents: sanitized })),
  );
}
const normal = await readFile('.work/r31-fix/content/index.js');
if (normal.includes(Buffer.from('__ui1Probe'))) throw Error('Probe leaked into the normal build');
const calibrationSource = await json(path.join(work, 'calibration-source.json'));
if (
  calibrationSource.ContentSha256.toLowerCase() !== digest(await readFile('.work/r31-perf/content/index.js')) ||
  calibrationSource.BusyContentSha256.toLowerCase() !==
    digest(await readFile('.work/r31-perf-busy/content/index.js')) ||
  calibrationSource.NormalContentSha256.toLowerCase() !== digest(normal)
)
  throw Error('The calibrated content bundles changed; recalibration is required');
const beforeBuild = await json(path.resolve('../r31-before/.work/r31-perf/ui1-build.json')),
  afterBuild = await json(path.resolve('.work/r31-perf/ui1-build.json'));
if (
  beforeBuild.revision !== before ||
  afterBuild.revision !== target ||
  beforeBuild.dirtySource ||
  afterBuild.dirtySource
)
  throw Error('Unpinned measurement builds');
await save('source-proof.json', {
  target,
  before,
  branch: git('branch', '--show-current'),
  normalContentSha256: digest(normal),
  calibrationSource,
  calibrationContentIdentical: true,
  captureControl: control,
  captureScriptSha256: digest(await readFile(path.join('.work/r31-fix-tools', control.captureScript))),
  legacyFixtureSha256: digest(fixture),
  beforeBuild: { ...beforeBuild, source: 'BASELINE' },
  afterBuild: { ...afterBuild, source: 'WORKTREE' },
  privateAssetsCommitted: false,
  normalProbe: false,
});
for (const file of ['perf.spec.ts', 'capture-strict.spec.ts', 'review.mjs', 'config.ts', 'pack.mjs', 'data-check.mjs'])
  await copyFile(path.join('.work/r31-fix-tools', file), path.join(out, 'repro', file));
const number = (n) => (n === null ? '—' : Number(n.toFixed(2)).toFixed(2));
const rows = Object.entries(summary.phases).map(
  ([name, p]) =>
    `| ${name} | ${number(p.before.cpu.median)} / ${number(p.before.cpu.p95)} | ${number(p.after.cpu.median)} / ${number(p.after.cpu.p95)} | ${number(p.cpuDelta.median)} / ${number(p.cpuDelta.p95)} |`,
);
const pairRows = complete.flatMap(([pair, data]) =>
  phases.map((name) => {
    const b = data.before.phases[name].cpu,
      a = data.after.phases[name].cpu;
    return `| ${pair} | ${name} | ${number(b.median)} / ${number(b.p95)} | ${number(a.median)} / ${number(a.p95)} |`;
  }),
);
await writeFile(
  path.join(out, 'performance.md'),
  `# R3-1 修正の交互計測\n\n${before.slice(0, 7)} と ${target.slice(0, 7)}。完全な組：${summary.completePairs.join(', ')}。単位はms/フレーム。各欄は中央値 / p95。段階の判断はClaude Codeが行う。\n\n| 場面 | 変更前 | 修正後 | 差 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n| 組 | 場面 | 変更前 | 修正後 |\n| --- | --- | --- | --- |\n${pairRows.join('\n')}\n\n除外理由・背景負荷・GPUの直近値・動画の区間差は performance.json、全試行の数値は performance-raw.json.gz。私用モデルを含む画像・元traceはコミットしない。\n`,
);
await appendFile(
  path.join(out, 'performance.md'),
  '\n背景CPUはユーザーの指示で5%の足切りから参考値へ変更した。旧条件でそろったのは1・2組目。変更後の条件では、広告・可視性・採取窓・実GPUを確かめた完全な組のうち、時系列順で最初の1〜4組を使う。CPUの値による選別はしていない。5・6組目の追加データもrawへ残し、途中の7組目は使わない。旧基準の収集器は条件変更に伴い途中終了した。capture-control.json と capture-strict.spec.ts に記録した。\n',
);
console.log(
  JSON.stringify({
    checks,
    completePairs: summary.completePairs,
    calibration: summary.calibration,
    phases: summary.phases,
  }),
);
