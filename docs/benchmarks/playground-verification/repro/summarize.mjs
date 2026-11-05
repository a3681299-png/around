import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
const work = path.resolve('.work/evidence');
const out = path.resolve(process.env.VERIFY_REPORT_OUT ?? '../creator-editor/docs/benchmarks/playground-verification');
await mkdir(out, { recursive: true });
const json = async (f) => {
  let text;
  try {
    text = await readFile(path.join(work, f), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    text = await readFile(path.resolve('.work/verify-tools/.work/evidence', f), 'utf8');
  }
  return JSON.parse(text.replace(/^\uFEFF/, ''));
};
const save = async (f, d) => writeFile(path.join(out, f), JSON.stringify(d, null, 2) + '\n');
function failures(report) {
  const found = [];
  function walk(s) {
    for (const spec of s.specs ?? [])
      for (const t of spec.tests ?? [])
        if (t.status === 'unexpected')
          found.push({
            file: spec.file,
            line: spec.line,
            title: spec.title,
            errors: t.results.flatMap((r) => r.errors ?? []),
          });
    for (const c of s.suites ?? []) walk(c);
  }
  for (const s of report.suites ?? []) walk(s);
  return found;
}
const checks = {};
for (const name of [
  'unit',
  'windows-all',
  'pg-normal',
  'pg-normal-record',
  'pg-no-mark',
  'pg-no-parser',
  'pg-no-clip',
  'stability-after',
  'stability-before',
  'no-hysteresis',
  'fast-release',
  'live-after-final',
  'live-before',
  'anchor-after',
  'anchor-before',
  'anchor-final-after',
  'anchor-final-before',
  'real-after',
  'real-before',
  'operations-repeat-after',
  'operations-resume-before',
  'perf-calibration-first-test',
  'perf-calibration-test',
  'model-debug-tests',
  'model-full-after-tests',
  'model-full-before-tests',
  'take-first-after-tests',
  'take-first-before-tests',
  'take-second-after-tests',
  'take-second-before-tests',
  'take-after-tests',
  'take-before-tests',
  'performance-test',
]) {
  try {
    const r = await json(name + '.json');
    checks[name] = { ...r.stats, failures: failures(r), errors: r.errors };
    await writeFile(path.join(out, name + '-report.json.gz'), gzipSync(JSON.stringify(r)));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
await save('checks.json', checks);
for (const name of [
  'static.json',
  'source-proof.json',
  'ci.json',
  'ci-before.json',
  'first-live-after.json',
  'first-live-before.json',
  'live-final-after.json',
  'live-final-before.json',
  'signal-live-after.json',
  'signal-live-before.json',
  'pg-playground-test.json',
  'pg-fault-parser.json',
  'pg-fault-clip.json',
  'extra-runs.json',
  'take-live-after.json',
  'take-live-before.json',
])
  try {
    await copyFile(path.join(work, name), path.join(out, name));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
for (const side of ['before', 'after'])
  for (const kind of ['normal', 'probe']) {
    const name = `model-debug-${side}-${kind}.json`;
    const { console: ignoredConsole, ...diagnosis } = await json(name);
    await save(name, diagnosis);
  }
for (const [source, dest] of [
  ['performance-first-attempt/runs.json', 'performance-first-attempt-raw.json.gz'],
  ['calibration-first/calibration.json', 'calibration-first-raw.json.gz'],
  ['model-full-after/runs.json', 'model-full-after-raw.json.gz'],
  ['model-full-before/runs.json', 'model-full-before-raw.json.gz'],
]) {
  const data = await json(source);
  await writeFile(path.join(out, dest), gzipSync(JSON.stringify(data)));
}
const ciLog = await readFile(path.join(work, 'ci.log'), 'utf8');
const counts = {
  unit: { passed: 0, skipped: 0 },
  e2e: { passed: 0, skipped: 0 },
  nativeEntry: { passed: 0, skipped: 0 },
};
for (const line of ciLog.split('\n')) {
  const match = /(\d+) (passed|skipped)(?:\s|$)/.exec(line);
  if (!match) continue;
  const part = line.startsWith('unit\t') ? 'unit' : line.includes('--shard=') ? 'e2e' : 'nativeEntry';
  counts[part][match[2]] += Number(match[1]);
}
await save('ci-counts.json', counts);
for (const file of await readdir(work))
  if (/\.log$/.test(file) && !file.startsWith('live-after.'))
    await writeFile(path.join(out, file + '.gz'), gzipSync(await readFile(path.join(work, file))));
const stats = (values) => {
  const a = [...values].sort((a, b) => a - b),
    n = a.length;
  return {
    count: n,
    median: n ? (a[Math.floor((n - 1) / 2)] + a[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? a[Math.ceil(n * 0.95) - 1] : null,
  };
};
try {
  const raw = await json('performance/runs.json');
  const grouped = new Map();
  for (const r of raw.runs) {
    const p = grouped.get(r.pair) ?? {};
    p[r.label] = r;
    grouped.set(r.pair, p);
  }
  const accepted = [...grouped].filter(([, p]) => p.before?.eligible && p.after?.eligible).slice(0, 4);
  const phases = [
    'no-character:startup',
    'no-character:steady',
    'no-character:spa',
    'character:startup',
    'character:steady',
    'character:spa',
  ];
  const runSummaries = raw.runs.map((run) => ({
    pair: run.pair,
    label: run.label,
    eligible: run.eligible,
    error: run.error,
    backgroundPercent: [run.hostBefore?.BackgroundPercent, run.hostAfter?.BackgroundPercent],
    phases: Object.fromEntries(
      Object.entries(run.attempts).map(([phase, blocks]) => [
        phase,
        blocks.map((block) => ({
          valid: block.valid,
          adSamples: block.adSamples,
          hiddenSamples: block.hiddenSamples,
          modelSamples: block.modelSamples,
          frames: block.cpu.count,
          documentMs: block.clock.end - block.clock.start,
        })),
      ]),
    ),
  }));
  const summary = {
    environment: raw.environment,
    acceptedPairs: accepted.map(([id]) => id),
    sufficientPairs: accepted.length >= 4,
    allRuns: runSummaries,
    phases: {},
    pairs: [],
  };
  for (const phase of phases) {
    const row = {};
    for (const side of ['before', 'after']) {
      const blocks = accepted.map(([, p]) => p[side].phases[phase]),
        video = blocks.filter((b) => b.video?.total > 0 && !b.video.counterReset);
      row[side] = {
        cpu: stats(blocks.flatMap((b) => b.raw.cpuPerFrame)),
        frame: stats(blocks.flatMap((b) => b.raw.fullFrameMs)),
        gpu: stats(blocks.flatMap((b) => b.raw.gpuMs)),
        video: {
          samples: video.length,
          total: video.reduce((s, b) => s + b.video.total, 0),
          dropped: video.reduce((s, b) => s + b.video.dropped, 0),
        },
      };
    }
    row.delta = accepted.length
      ? { median: row.after.cpu.median - row.before.cpu.median, p95: row.after.cpu.p95 - row.before.cpu.p95 }
      : { median: null, p95: null };
    row.withinCpuBudget = summary.sufficientPairs && row.delta.median <= 0.5 && row.delta.p95 <= 1;
    summary.phases[phase] = row;
  }
  for (const [id, p] of accepted)
    summary.pairs.push({
      id,
      order: id % 2 ? ['before', 'after'] : ['after', 'before'],
      phases: Object.fromEntries(
        phases.map((k) => [
          k,
          {
            before: p.before.phases[k].cpu,
            after: p.after.phases[k].cpu,
            delta: {
              median: p.after.phases[k].cpu.median - p.before.phases[k].cpu.median,
              p95: p.after.phases[k].cpu.p95 - p.before.phases[k].cpu.p95,
            },
          },
        ]),
      ),
    });
  await save('performance.json', summary);
  await writeFile(path.join(out, 'performance-raw.json.gz'), gzipSync(JSON.stringify(raw)));
  const cal = await json('calibration/calibration.json');
  await save('calibration.json', {
    delta: cal.delta,
    runs: cal.runs.map((r) => ({
      label: r.label,
      eligible: r.eligible,
      error: r.error,
      phases: Object.fromEntries(Object.entries(r.phases).map(([k, { raw, ...b }]) => [k, b])),
    })),
  });
  await writeFile(path.join(out, 'calibration-raw.json.gz'), gzipSync(JSON.stringify(cal)));
  for (const [index, phase] of [
    [0, 'character:steady'],
    [1, 'no-character:startup'],
  ]) {
    for (const side of ['before', 'after']) {
      const run = accepted[index]?.[1][side];
      if (!run) continue;
      const file = run.phases[phase].trace.file;
      const trace = JSON.parse(gunzipSync(await readFile(path.join(work, 'performance', file))));
      for (const event of trace.traceEvents) delete event.args;
      await writeFile(
        path.join(out, `trace-${side}-${phase.replace(':', '-')}.json.gz`),
        gzipSync(JSON.stringify(trace)),
      );
    }
  }
  const f = (n) => (typeof n === 'number' ? n.toFixed(3) : '—');
  let md =
    '| 場面 | CPU中央値 前→後 ms | CPU p95 前→後 ms | 差 中央値 / p95 ms | CPU予算 | 全体p95 前→後 ms |\n| --- | --- | --- | --- | --- | --- |\n';
  for (const [k, r] of Object.entries(summary.phases))
    md += `| ${k} | ${f(r.before.cpu.median)} → ${f(r.after.cpu.median)} | ${f(r.before.cpu.p95)} → ${f(r.after.cpu.p95)} | ${f(r.delta.median)} / ${f(r.delta.p95)} | ${!summary.sufficientPairs ? '未判定' : r.withinCpuBudget ? '範囲内' : '超過'} | ${f(r.before.frame.p95)} → ${f(r.after.frame.p95)} |\n`;
  md += '\n| 組 | 場面 | CPU中央値 前→後 ms | CPU p95 前→後 ms |\n| --- | --- | --- | --- |\n';
  for (const p of summary.pairs)
    for (const [k, r] of Object.entries(p.phases))
      md += `| ${p.id} (${p.order.join('→')}) | ${k} | ${f(r.before.median)} → ${f(r.after.median)} | ${f(r.before.p95)} → ${f(r.after.p95)} |\n`;
  await writeFile(path.join(out, 'performance.md'), md);
  console.log(JSON.stringify({ counts, acceptedPairs: summary.acceptedPairs, phases: summary.phases }, null, 2));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.log(JSON.stringify({ counts, performance: 'not collected' }, null, 2));
}
