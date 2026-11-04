// Run from the pinned verification checkout after all measurements finish. No product writes.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base = 'docs/benchmarks/g14-verification',
  shots = 'docs/screenshots/g14-verification';
await mkdir(base, { recursive: true });
await mkdir(shots, { recursive: true });
await mkdir(`${base}/repro`, { recursive: true });
const read = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
const write = async (n, d) => writeFile(`${base}/${n}`, JSON.stringify(d, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const compressed = async (n, data) => {
  const b = gzipSync(JSON.stringify(data));
  await writeFile(`${base}/${n}`, b);
  return { file: n, sha256: hash(b), bytes: b.length };
};
const flatten = (s) => [
  ...(s.specs ?? []).flatMap((spec) => (spec.tests ?? []).map((t) => ({ title: spec.title, file: spec.file, ...t }))),
  ...(s.suites ?? []).flatMap(flatten),
];
const names = [
  'windows-all',
  'timing20-complete',
  'no-idle',
  'no-clip',
  'no-input',
  'no-approach',
  'no-hold',
  'ci-case-before',
  'ci-case-after',
  'long-wait-before',
  'operations-live-before',
  'operations-live-after',
];
const testRaw = {},
  checks = [];
for (const label of names) {
  const d = await read(`.work/evidence/${label}.json`);
  testRaw[label] = d;
  checks.push({
    label,
    stats: d.stats,
    tests: flatten(d).map((t) => ({
      title: t.title,
      file: t.file,
      status: t.status,
      results: t.results.map((r) => ({
        status: r.status,
        duration: r.duration,
        retry: r.retry,
        errors: r.errors.map((e) => ({ location: e.location, message: e.message })),
        attachments: r.attachments.map((a) => a.name),
      })),
    })),
  });
}
await write('checks.json', { rawArtifact: await compressed('test-raw.json.gz', testRaw), runs: checks });
await copyFile('.work/evidence/timing20-complete-summary.json', `${base}/timing20.json`);
for (const n of ['environment', 'ci', 'ci-clip-timeline', 'timing20-interruption', 'no-idle-summary'])
  await copyFile(`.work/evidence/${n}.json`, `${base}/${n}.json`);
await copyFile('.work/g14-extra/background.json', `${base}/background.json`);
await copyFile('.work/g14-extra/viewport.json', `${base}/viewport.json`);
const idleTest = flatten(testRaw['windows-all']).find((t) => t.title.startsWith('G1.4: the idle recheck'));
const idleLog = idleTest.results.flatMap((r) => r.stdout).find((x) => x.text?.startsWith('G14_IDLE '));
await write('work-counts.json', JSON.parse(idleLog.text.slice('G14_IDLE '.length)));
const faults = [];
for (const n of ['clip', 'input', 'approach', 'hold']) faults.push(await read(`.work/g14-no-${n}/fault.json`));
faults.push({
  fault: 'idle',
  method: 'WW_NO_IDLE_RECHECK=1; drop WW_IDLE_RECHECK in app and probe',
  contentSha256: hash(await readFile('.work/g14-no-idle/content/index.js')),
});
await write('faults.json', faults);
const visual = {};
for (const n of ['after', 'before', 'g12', 'trace', 'record']) visual[n] = await read(`.work/g14-live/${n}-state.json`);
await write('youtube-visual.json', {
  rawArtifact: await compressed('visual-raw.json.gz', visual),
  runs: Object.entries(visual).map(([label, d]) => ({
    label,
    browser: d.browser,
    at: d.at,
    noInputSince: d.noInputSince,
    hidden: d.hidden,
    clip: d.clip,
    safety: JSON.parse(d.safety),
    layers: d.layers,
    player: d.player,
    nativeViewport: d.native.viewport,
    nativePlayer: d.native.surfaces.filter((s) => s.id.startsWith('player.')),
    rechecks: d.rechecks ?? [],
  })),
});
for (const n of ['after', 'before', 'g12', 'record'])
  await copyFile(`.work/g14-live/${n}-idle.png`, `${shots}/youtube-${n}.png`);
const worst = 'g14-idle-recheck-G1-4-a-si-792c4-without-a-new-drawing-input-e2e-repeat2';
await copyFile(`.work/timing20-complete/${worst}/idle-before-new-read.png`, `${shots}/idle-normal.png`);
await copyFile(`.work/timing20-complete/${worst}/native-reference.png`, `${shots}/native-reference.png`);
const failing = 'g14-idle-recheck-G1-4-a-si-792c4-without-a-new-drawing-input-e2e';
await copyFile(`.work/fault-no-idle/${failing}/idle-before-new-read.png`, `${shots}/idle-no-recheck.png`);
await copyFile(`.work/long-wait-before/${failing}/idle-before-new-read.png`, `${shots}/idle-before.png`);
await copyFile(
  '.work/ci2/test-results/e2e/operation-safety-a-stale-s-44b81-akes-the-input-meant-for-it-e2e/test-failed-3.png',
  `${shots}/ci-stale-handle.png`,
);
await copyFile(
  '.work/ci2/test-results/e2e/operation-safety-a-stale-s-44b81-akes-the-input-meant-for-it-e2e/trace.zip',
  `${base}/ci-stale-handle-trace.zip`,
);
const logs = {};
for (const n of await readdir('.work/evidence'))
  if (n.endsWith('.txt')) logs[n] = await readFile(`.work/evidence/${n}`, 'utf8');
logs['ci-full.txt'] = await readFile('../g14-ci/ci.txt', 'utf8');
await write('logs.json', { rawArtifact: await compressed('logs-raw.json.gz', logs), files: Object.keys(logs) });

const usual = await read('.work/g14-perf-usual/performance.json'),
  staticScene = await read('.work/g14-perf-static-gap/performance.json'),
  startup = await read('.work/g14-perf-startup-focused/performance.json'),
  calibration = await read('.work/g14-perf/calibration.json');
const performance = { sceneSets: { usual, static: staticScene, startup }, aggregate: {} };
performance.sceneSets.static.requiredPairs = 4;
performance.sceneSets.static.completePairs = staticScene.pairs.filter((p) => p.before && p.after).length;
performance.sceneSets.static.verdict = 'inconclusive: four matching valid pairs were not completed';
const median = (a) => {
  a = a.toSorted((a, b) => a - b);
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2;
};
const perfRaw = {};
function slimRun(run, prefix) {
  for (const [name, p] of Object.entries(run.phases)) {
    perfRaw[`${prefix}/${name}`] = p.raw;
    p.rawKey = `${prefix}/${name}`;
    delete p.raw;
    delete p.frameIntervalsMs;
  }
  return run;
}
for (const [set, data] of Object.entries(performance.sceneSets))
  for (const pair of data.pairs)
    for (const n of pair.order) {
      slimRun(pair[n], `${set}/pair-${pair.pair + 1}/${n}`);
      const phase = pair[n].phases.staticOpaque;
      if (!phase) continue;
      const file = `perf-pair-${pair.pair + 1}-${n}.png`;
      await copyFile(`.work/g14-perf-static-gap/${phase.screenshot}`, `${shots}/${file}`);
      phase.screenshot = `../../screenshots/g14-verification/${file}`;
    }
for (const r of calibration) slimRun(r, `calibration/${r.label}`);
performance.rawArtifact = await compressed('performance-raw.json.gz', perfRaw);
performance.budgets = { medianDeltaMs: 0.5, p95DeltaMs: 1 };
for (const name of ['startup', 'steady', 'scrollFar', 'scrollNear', 'spa', 'staticOpaque']) {
  const data = name === 'staticOpaque' ? staticScene : name === 'startup' ? startup : usual;
  const pairs = data.pairs.map((p) => ({
    pair: p.pair + 1,
    before: p.before.phases[name],
    after: p.after.phases[name],
  }));
  const deltas = pairs.map((p) => ({
    median: p.after.cpuMs.median - p.before.cpuMs.median,
    p95: p.after.cpuMs.p95 - p.before.cpuMs.p95,
  }));
  performance.aggregate[name] = {
    pairs: pairs.length,
    requiredPairs: 4,
    before: {
      median: median(pairs.map((p) => p.before.cpuMs.median)),
      p95: median(pairs.map((p) => p.before.cpuMs.p95)),
      intervalP95: median(pairs.map((p) => p.before.intervalMs.p95)),
    },
    after: {
      median: median(pairs.map((p) => p.after.cpuMs.median)),
      p95: median(pairs.map((p) => p.after.cpuMs.p95)),
      intervalP95: median(pairs.map((p) => p.after.intervalMs.p95)),
    },
    pairedDelta: { median: median(deltas.map((d) => d.median)), p95: median(deltas.map((d) => d.p95)) },
    maxPairDelta: { median: Math.max(...deltas.map((d) => d.median)), p95: Math.max(...deltas.map((d) => d.p95)) },
    invalid: pairs.flatMap((p) => [p.before.invalid, p.after.invalid]).filter(Boolean),
  };
}
performance.aggregation =
  'Median of the four per-run medians and p95s; pairedDelta is median of the four pairwise differences. Each pair is retained.';
await write('performance.json', performance);
await write('calibration.json', { rawArtifact: performance.rawArtifact, runs: calibration });
const setup = {};
for (const n of await readdir('.work/g14-perf'))
  if (n.endsWith('.json') && n !== 'calibration.json') setup[n] = await read(`.work/g14-perf/${n}`);
setup['static-smoke-performance.json'] = await read('.work/g14-perf-smoke/performance.json');
setup['startup-before-focus.json'] = await read('.work/evidence/startup-before-focus.json');
setup['static-column-three-pairs.json'] = await read('.work/g14-perf-static/performance.json');
for (const dir of ['g14-perf-static', 'g14-perf-static-retry'])
  for (const n of await readdir(`.work/${dir}`))
    if (n.includes('static-check') || n.includes('static-geometry'))
      setup[`${dir}/${n}`] = await read(`.work/${dir}/${n}`);
for (const n of await readdir('.work/g14-perf-static-gap'))
  if (n.includes('static-check') || n.includes('static-geometry'))
    setup[`g14-perf-static-gap/${n}`] = await read(`.work/g14-perf-static-gap/${n}`);
await write('setup-failures.json', {
  rawArtifact: await compressed('setup-raw.json.gz', setup),
  note: 'Discarded setup attempts are not used in the formal performance verdict; static-smoke is an additional preparation pair.',
});
await copyFile('.work/g14-perf/before-static-1793769990240.png', `${shots}/perf-setup-after-spa.png`);
await copyFile('.work/g14-perf-static-gap/after-static-1793771404874.png', `${shots}/perf-gap-failed.png`);
const gapChecks = await Promise.all(
  (await readdir('.work/g14-perf-static-gap'))
    .filter((n) => n.includes('static-check'))
    .map((n) => read(`.work/g14-perf-static-gap/${n}`)),
);
await write(
  'static-gap-failure.json',
  gapChecks.find((d) => d.picture === 'after-static-1793771404874.png'),
);
await copyFile('.work/evidence/static-gap-pixel-audit.json', `${base}/static-gap-pixel-audit.json`);
for (const [from, to] of [
  ['.work/analyze.mjs', 'analyze.mjs'],
  ['.work/build-faults.mjs', 'build-faults.mjs'],
  ['.work/build-record.mjs', 'build-record.mjs'],
  ['.work/pack-evidence.mjs', 'pack-evidence.mjs'],
  ['.work/validate-artifacts.mjs', 'validate-artifacts.mjs'],
])
  await copyFile(from, `${base}/repro/${to}`);
await copyFile('.work/README-repro.md', `${base}/repro/README.md`);
for (const dir of ['g14-extra', 'g14-live', 'g14-perf']) {
  await mkdir(`${base}/repro/${dir}`, { recursive: true });
  for (const n of await readdir(`.work/${dir}`))
    if (n.endsWith('.ts')) await copyFile(`.work/${dir}/${n}`, `${base}/repro/${dir}/${n}`);
}
console.log(
  JSON.stringify(
    { checks: checks.map((c) => ({ label: c.label, stats: c.stats })), performance: performance.aggregate },
    null,
    2,
  ),
);
