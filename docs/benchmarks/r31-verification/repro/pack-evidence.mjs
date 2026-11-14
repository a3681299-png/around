import { mkdir, readFile, writeFile, cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = process.cwd(),
  before = path.resolve('../r31-before'),
  source = '.work/evidence',
  out = 'docs/benchmarks/r31-verification';
await mkdir(out, { recursive: true });
await mkdir(out + '/repro', { recursive: true });
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'string'
        ? v
            .replaceAll(root, 'WORKTREE')
            .replaceAll(before, 'BASELINE')
            .replaceAll(root.replaceAll('\\', '/'), 'WORKTREE')
            .replaceAll(before.replaceAll('\\', '/'), 'BASELINE')
        : v,
    ),
  );
const load = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const put = async (file, value) => writeFile(out + '/' + file, JSON.stringify(clean(value), null, 2) + '\n');
const summary = (report) => {
  const cases = [];
  function walk(s) {
    for (const p of s.specs ?? [])
      for (const t of p.tests ?? [])
        cases.push({
          file: p.file,
          line: p.line,
          title: p.title,
          status: t.status,
          errors: t.results.flatMap((r) =>
            (r.errors ?? (r.error ? [r.error] : [])).map((e) =>
              (e.message ?? String(e)).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 5000),
            ),
          ),
        });
    for (const c of s.suites ?? []) walk(c);
  }
  walk(report);
  return { stats: report.stats, cases };
};
const required = [
  'windows-all',
  'unit-windows',
  'before-version-assertions',
  'before-flakes',
  'after-flakes',
  'extra-final',
  'live-normal-final',
  'live-probe-final',
  'sidepanel-visual-final',
  'perf-final-tests',
  'perf-complete-tests',
];
const tests = {};
for (const name of required) tests[name] = summary(await load(`${source}/${name}.json`));
tests['studio-window-shot-tests'] = summary(await load(`${source}/studio-window-shot-tests.json`));
tests['character-live'] = summary(await load(`${source}/character-live.json`));
await put('tests.json', tests);
const ci = await load(source + '/ci.json');
assert.ok(ci.headSha.startsWith('8003738'));
await put('ci.json', {
  headSha: ci.headSha,
  url: ci.url,
  conclusion: ci.conclusion,
  jobs: ci.jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, url: j.url })),
  unit: { passed: 494, skipped: 3 },
  e2e: { passed: 260, failed: 8, skipped: 61 },
  nativeEntry: { passed: 4 },
});
for (const name of [
  'independent-data',
  'compat-before-captured',
  'history-v13',
  'vrma-loader',
  'legacy-upgrade',
  'legacy-backup-before',
  'legacy-backup-after',
  'studio-window',
  'data-mutants',
])
  await put(name + '.json', await load(source + '/' + name + '.json'));
for (const variant of ['mesh', 'bad-scene-index', 'bad-scene-root', 'derived-hips-infinity'])
  await put('import-' + variant + '.json', await load(`${source}/import-${variant}-r31-normal.json`));
const mutations = await load(source + '/browser-mutants.json');
for (const row of mutations) {
  row.results = summary(await load(`${source}/mutant-${row.Fault}.json`));
  row.build = await load(`.work/r31-no-${row.Fault}/fault.json`);
}
await put('browser-mutants.json', mutations);
const visuals = [];
for (const label of ['before', 'after', 'probe-before', 'probe-after']) {
  const v = await load(`${source}/live-visual-${label}.json`);
  visuals.push({
    label: v.label,
    instrumented: v.instrumented,
    body: v.body,
    defaultRect: v.default?.rect,
    canvas: v.canvas,
    viewport: v.viewport,
    player: {
      rect: v.player?.rect,
      pointerEvents: v.player?.pointerEvents,
      playback: v.player?.playback,
      clip: v.player?.frame?.clip,
      timeMs: v.player?.frame?.timeMs,
      suspended: v.player?.frame?.suspended,
    },
    native: v.native,
    overControl: v.overControl,
    controlPixelsEqual: v.controlPixelsEqual,
    shortcut: v.shortcut,
    offRemoved: v.offRemoved,
    browser: v.browser,
  });
}
await put('live-visuals.json', visuals);
await put('character-live.json', await load('.work/verification/character-live.json'));
await put(
  'sidepanel-visuals.json',
  await Promise.all(['before', 'after'].map((label) => load(`${source}/sidepanel-visual-${label}.json`))),
);
for (const file of ['legacy-v13-vrm.aroundbackup', 'public-character.aroundbackup']) {
  const bytes = await readFile(source + '/' + file);
  assert.ok(bytes.length < 150000, 'Only tiny original public test fixtures may be copied');
  const len = bytes.readUInt32LE(16),
    m = JSON.parse(bytes.subarray(52, 52 + len).toString('utf8'));
  assert.ok(m.assets.every((a) => a.name === 'Original.vrm' || /^motion-\d+\.vrma$/.test(a.name)));
  await writeFile(out + '/' + file, bytes);
}
await cp(source + '/studio-window-public.png', out + '/studio-window-public.png');

const measureRoot = source + '/r31-perf-complete',
  campaign = await load(measureRoot + '/runs.json'),
  calibration = await load(source + '/r31-perf/calibration.json');
const group = new Map();
for (const run of campaign.runs) {
  const pair = group.get(run.pair) ?? {};
  pair[run.label] = run;
  group.set(run.pair, pair);
}
const pairs = [...group].filter(([, p]) => p.before?.eligible && p.after?.eligible);
const intervalOK = (r, phase) =>
  r &&
  !r.error &&
  r.hostBefore?.Quiet &&
  r.hostAfter?.Quiet &&
  r.phases[phase]?.valid &&
  r.phases[phase].clock.end - r.phases[phase].clock.start >= 5800 &&
  !(r.review ?? []).some((x) => x.phase === phase);
const stats = (xs) => {
  const a = [...xs].sort((a, b) => a - b),
    n = a.length;
  return {
    count: n,
    median: n ? (a[Math.floor((n - 1) / 2)] + a[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? a[Math.ceil(n * 0.95) - 1] : null,
    max: a.at(-1) ?? null,
  };
};
const phases = Object.keys(pairs[0][1].before.phases),
  aggregates = {},
  phasePairs = {};
for (const phase of phases) {
  const selected = [...group].filter(([, p]) => intervalOK(p.before, phase) && intervalOK(p.after, phase)).slice(0, 4);
  phasePairs[phase] = selected;
  const a = { pairs: selected.map(([n]) => n), pairCount: selected.length };
  for (const label of ['before', 'after']) {
    const blocks = selected.map(([, p]) => p[label].phases[phase]);
    a[label] = {
      cpu: stats(blocks.flatMap((b) => b.raw.cpuPerFrame)),
      gpu: stats(phase.endsWith(':spa') ? [] : blocks.flatMap((b) => b.raw.gpuMs)),
      frame: stats(blocks.flatMap((b) => b.raw.fullFrameMs)),
      video: blocks.reduce(
        (v, b) => ({ total: v.total + (b.video?.total ?? 0), dropped: v.dropped + (b.video?.dropped ?? 0) }),
        { total: 0, dropped: 0 },
      ),
      perPair: blocks.map((b) => ({ cpu: b.cpu, gpu: phase.endsWith(':spa') ? null : b.gpu, video: b.video })),
    };
  }
  a.delta = { median: a.after.cpu.median - a.before.cpu.median, p95: a.after.cpu.p95 - a.before.cpu.p95 };
  a.numericBudgetMet = a.delta.median <= 0.5 + 1e-6 && a.delta.p95 <= 1 + 1e-6;
  a.pass = a.pairCount >= 4 && a.numericBudgetMet;
  aggregates[phase] = a;
}
const perf = {
  environment: campaign.environment,
  qualifiedPairs: pairs.map(([n]) => n),
  intervalQualification:
    'Both host audits quiet, no error, this interval valid, at least 5.8 seconds, no overlap with original campaign timeout. Partial intervals never close the whole six-scene campaign.',
  excludedPairs: [...group]
    .filter(([, p]) => !p.before?.eligible || !p.after?.eligible)
    .map(([n, p]) => ({
      pair: n,
      before: p.before?.eligible,
      after: p.after?.eligible,
      beforeReview: p.before?.review,
      afterReview: p.after?.review,
      beforeError: p.before?.error,
      afterError: p.after?.error,
    })),
  calibrationDelta: calibration.delta,
  aggregates,
  videoArtworkOff: campaign.runs.map((r) => ({
    pair: r.pair,
    label: r.label,
    eligible: r.eligible,
    value: r.artworkOffVideo,
  })),
  hostAudits: campaign.runs.map((r) => ({ pair: r.pair, label: r.label, before: r.hostBefore, after: r.hostAfter })),
  allPhasesPass: pairs.length >= 4 && Object.values(aggregates).every((v) => v.pass),
  steadyIntervalsPass: aggregates['character:steady'].pass && aggregates['no-character:steady'].pass,
};
await put('performance.json', perf);
await writeFile(out + '/performance-raw.json.gz', gzipSync(JSON.stringify(clean({ campaign, calibration }))));
const f = (n) => (n === null ? '—' : n.toFixed(2)),
  signed = (n) => {
    const rounded = Math.abs(n) < 0.005 ? 0 : n;
    return (rounded >= 0 ? '+' : '') + f(rounded);
  };
let table =
  '| 場面 | 有効な組 | 変更前 CPU 中央値 / p95 | 変更後 | 差 | 判定 |\n| --- | --- | --- | --- | --- | --- |\n';
for (const [phase, a] of Object.entries(aggregates))
  table += `| ${phase} | ${a.pairs.join(',')} | ${f(a.before.cpu.median)} / ${f(a.before.cpu.p95)} | ${f(a.after.cpu.median)} / ${f(a.after.cpu.p95)} | ${signed(a.delta.median)} / ${signed(a.delta.p95)} | ${a.pairCount < 4 ? '未判定（4組未満）' : a.pass ? '区間では基準内' : '基準超過'} |\n`;
let detail =
  '# R3-1 交互計測\n\n**全6場面の正式合格は未成立。** 単位はms/フレーム。全場面がそろう組は' +
  pairs.map(([n]) => n).join(', ') +
  'のみ。参考として、場面単位で有効な前後の区間を最大4組ずつ集計した。別場面の不備でその場面の合格を補わない。\n\n' +
  table +
  '\n## 組ごとのCPU\n\n| 組 | 場面 | 変更前 中央値 / p95 | 変更後 | 差 |\n| --- | --- | --- | --- | --- |\n';
for (const phase of phases)
  for (const [n, p] of phasePairs[phase]) {
    const b = p.before.phases[phase].cpu,
      a = p.after.phases[phase].cpu;
    detail += `| ${n} | ${phase} | ${f(b.median)} / ${f(b.p95)} | ${f(a.median)} / ${f(a.p95)} | ${signed(a.median - b.median)} / ${signed(a.p95 - b.p95)} |\n`;
  }
detail +=
  '\n## GPU・動画（参考）\n\nGPUは250ms間隔で読んだ直近値の中央値/p95。全描画のp95ではない。動画は区間のフレーム数の差。SPAは検索結果への移動で、動画視聴の区間ではない。\n\n| 場面 | 変更前GPU | 変更後GPU | 変更前 dropped / total | 変更後 |\n| --- | --- | --- | --- | --- |\n';
for (const [phase, a] of Object.entries(aggregates))
  detail += `| ${phase} | ${f(a.before.gpu.median)} / ${f(a.before.gpu.p95)} | ${f(a.after.gpu.median)} / ${f(a.after.gpu.p95)} | ${a.before.video.dropped} / ${a.before.video.total} | ${a.after.video.dropped} / ${a.after.video.total} |\n`;
await writeFile(out + '/performance.md', detail);
await writeFile('.work/evidence/performance-table.md', table);
// Keep reproducible numeric timeline events, with URLs/args removed. Full original traces stay local.
for (const label of ['before', 'after']) {
  const run = phasePairs['character:steady'][0][1][label],
    block = run.phases['character:steady'],
    trace = JSON.parse(gunzipSync(await readFile(path.join(run.traceDirectory ?? measureRoot, block.trace.file))));
  const events = trace.traceEvents.map(({ name, cat, ph, pid, tid, ts, dur, id, id2, bind_id }) => ({
    name,
    cat,
    ph,
    pid,
    tid,
    ts,
    dur,
    id,
    id2,
    bind_id,
  }));
  await writeFile(
    out + `/trace-${label}-character-steady.json.gz`,
    gzipSync(JSON.stringify({ originalSha256: block.trace.sha256, traceEvents: events })),
  );
}
const fileNames = [
  'data-check.mjs',
  'history-v13.mjs',
  'vrma-loader-check.mjs',
  'build-mutants.mjs',
  'mutant-data.mjs',
  'config.ts',
  'extra.spec.ts',
  'live-visual.spec.ts',
  'sidepanel-visual.spec.ts',
  'perf.spec.ts',
  'performance-preview.mjs',
  'run-mutants.ps1',
  'run-remaining.ps1',
  'pack-evidence.mjs',
];
for (const file of fileNames) await cp('.work/r31-tools/' + file, out + '/repro/' + file);
const sourceProof = {
  target: execFileSync('git', ['rev-parse', '8003738'], { encoding: 'utf8' }).trim(),
  before: execFileSync('git', ['rev-parse', '8e63f0d'], { encoding: 'utf8' }).trim(),
  productDiff: execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      'HEAD',
      '--',
      'src',
      'tests',
      'manifest.json',
      'scripts',
      'playwright.config.ts',
      'package.json',
      'package-lock.json',
    ],
    { encoding: 'utf8' },
  ).trim(),
  normalContentHash: createHash('sha256')
    .update(await readFile('.work/r31-normal/content/index.js'))
    .digest('hex'),
  normalHasCpuProbe: (await readFile('.work/r31-normal/content/index.js', 'utf8')).includes('__ui1Probe'),
  builds: {
    before: await load(before + '/.work/r31-perf/ui1-build.json'),
    after: await load('.work/r31-perf/ui1-build.json'),
  },
};
assert.equal(sourceProof.productDiff, '');
assert.equal(sourceProof.normalHasCpuProbe, false);
await put('source-proof.json', sourceProof);
await put('results.json', {
  target: sourceProof.target,
  before: sourceProof.before,
  tests: Object.fromEntries(Object.entries(tests).map(([k, v]) => [k, v.stats])),
  performance: { qualifiedPairs: perf.qualifiedPairs, allPhasesPass: perf.allPhasesPass, aggregates: perf.aggregates },
  independentData: (await load(source + '/independent-data.json')).failures,
  privateArtifactsCommitted: false,
});
console.log(
  JSON.stringify({
    tests: Object.fromEntries(Object.entries(tests).map(([k, v]) => [k, v.stats])),
    performance: perf.allPhasesPass,
    pairs: perf.qualifiedPairs,
    aggregates,
  }),
);
