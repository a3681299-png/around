import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const local = path.resolve('.work/verify-evidence');
const out = path.resolve(process.argv[2] ?? '../chunk2-r3-2/docs/benchmarks/chunk2-verification');
await mkdir(out, { recursive: true });
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = (file, value) => writeFile(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const pack = (file, value) => writeFile(path.join(out, file), gzipSync(JSON.stringify(value)));
const stats = (values) => {
  const a = [...values].sort((x, y) => x - y),
    n = a.length;
  return n
    ? {
        n,
        min: a[0],
        median: (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2,
        p95: a[Math.ceil(n * 0.95) - 1],
        max: a.at(-1),
        sum: a.reduce((s, x) => s + x, 0),
      }
    : { n: 0, min: null, median: null, p95: null, max: null, sum: 0 };
};
const groups = {};
const evidence = await readdir(local);
const withoutRaw = ({ raw, ...summary }) => {
  const calls = raw.calls.filter((_, i) => i % 2 === 1);
  return {
    ...summary,
    call: {
      ...summary.call,
      ...Object.fromEntries(
        [2, 5, 10, 16].map((threshold) => [`atLeast${threshold}`, calls.filter((d) => d + 1e-6 >= threshold).length]),
      ),
    },
  };
};
const formalStages = ['AA', 'AB', 'B-quiet', 'B-mannequin', 'B-trusie'];
for (const stage of [...formalStages, 'B']) {
  const matching = evidence.filter((name) => new RegExp(`^${stage}-\\d+-(left|right)\\.json$`).test(name));
  if (!matching.length) continue;
  const arms = await Promise.all(matching.map((name) => json(path.join(local, name))));
  const map = new Map();
  for (const arm of arms) {
    const pair = map.get(arm.pair) ?? { pair: arm.pair, order: arm.pair % 2 ? ['left', 'right'] : ['right', 'left'] };
    pair[arm.side] = arm;
    map.set(arm.pair, pair);
  }
  const pairs = [...map.values()].sort((a, b) => a.pair - b.pair);
  const accepted = pairs
    .filter(({ left, right }) => left?.valid && right?.valid)
    .slice(0, stage.startsWith('B') ? 4 : 8);
  const blocks = {};
  for (const key of Object.keys(accepted[0]?.left.blocks ?? {})) {
    const result = { pairs: [] };
    for (const side of ['left', 'right']) {
      const phase = accepted.map((p) => p[side].blocks[key]);
      result[side] = {
        cpu: stats(phase.flatMap((b) => b.raw.frames)),
        calls: stats(phase.flatMap((b) => b.raw.calls.filter((_, i) => i % 2 === 1))),
        rafIntervalMs: stats(
          phase.flatMap((b) => {
            const timestamps = b.raw.boundaries.slice(1, -1);
            return timestamps.slice(1).map((value, index) => value - timestamps[index]);
          }),
        ),
        gpu: stats(phase.flatMap((b) => b.raw.gpu)),
        video: {
          n: phase.filter((b) => b.video !== null).length,
          total: phase.reduce((sum, b) => sum + (b.video?.total ?? 0), 0),
          dropped: phase.reduce((sum, b) => sum + (b.video?.dropped ?? 0), 0),
        },
        realFrames: stats(phase.map((b) => b.clock.actualRafFrames)),
      };
    }
    for (const pair of accepted) {
      const left = pair.left.blocks[key],
        right = pair.right.blocks[key];
      result.pairs.push({
        pair: pair.pair,
        order: pair.order,
        left: withoutRaw(left),
        right: withoutRaw(right),
        delta: {
          median: right.cpu.median - left.cpu.median,
          p95: right.cpu.p95 - left.cpu.p95,
          frames: right.clock.actualRafFrames - left.clock.actualRafFrames,
          cpuTotal: right.cpu.total - left.cpu.total,
        },
      });
    }
    result.delta = {
      median: result.right.cpu.median - result.left.cpu.median,
      p95: result.right.cpu.p95 - result.left.cpu.p95,
    };
    result.pairedP95 = stats(result.pairs.map((p) => p.delta.p95));
    result.absolutePairedP95 = stats(result.pairs.map((p) => Math.abs(p.delta.p95)));
    blocks[key] = result;
  }
  const index = await json(path.join(local, `${stage}-index.json`)).catch(() => null);
  groups[stage] = {
    environment: index && { os: index.os, cpu: index.cpu, url: index.url },
    accepted: accepted.map((p) => p.pair),
    blocks,
    attempts: arms.map(
      ({ pair, side, build, browser, viewport, models, background, valid, error, artworkOff, attempts }) => ({
        pair,
        side,
        build,
        browser,
        viewport,
        models,
        background,
        valid,
        error,
        artworkOff,
        attempts: Object.fromEntries(
          Object.entries(attempts).map(([key, values]) => [
            key,
            values.map((value) => ({
              valid: value.valid,
              frameCount: value.clock.actualRafFrames,
              ad: value.ad,
              promo: value.promo,
              hidden: value.hidden,
              modelSamples: value.modelSamples,
              backend: value.backend,
              video: value.video,
            })),
          ]),
        ),
      }),
    ),
  };
  await save(`${stage}.json`, groups[stage]);
  await pack(`${stage}-raw.json.gz`, { pairs });
}

const checks = {};
const reports = {};
function failures(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests
        .filter((test) => test.status === 'unexpected' || test.status === 'flaky')
        .map((test) => ({
          title: spec.title,
          file: spec.file,
          line: spec.line,
          status: test.status,
          errors: test.results.flatMap((result) => result.errors?.map((error) => error.message) ?? []),
        })),
    ),
    ...failures(suite.suites ?? []),
  ]);
}
for (const file of [...evidence.filter((name) => name.endsWith('-tests.json')), '../windows-all.json']) {
  const report = await json(path.join(local, file));
  const name = path.basename(file, '.json');
  reports[name] = report;
  checks[name] = { ...report.stats, failures: failures(report.suites), errors: report.errors };
}
await save('checks.json', checks);
await pack('test-reports.json.gz', reports);
for (const name of evidence.filter((name) =>
  /^(?:static|fault-builds|(?:first-)?(?:ui1|g11)-calibration|(?:first-)?pg-.*-(?:background|overlap)|pg-motion|pg-pixel-proof|(?:first-)?youtube-.*-g1|r32-edge-pixel-diff)\.json$/.test(
    name,
  ),
))
  await save(name, await json(path.join(local, name)));

const ci = [];
for (const id of [41839637095, 41987199472, 41987868681]) {
  const report = await json(path.join(local, '..', `ci-${id}.json`));
  const counts = { unit: { passed: 0, skipped: 0 }, e2e: { passed: 0, skipped: 0 }, native: { passed: 0, skipped: 0 } };
  for (const line of (await readFile(path.join(local, '..', `ci-${id}.log`), 'utf8')).split('\n')) {
    const match = /\s(\d+) (passed|skipped)(?:\s|$)/.exec(line);
    if (!match) continue;
    const group = line.startsWith('unit\t') ? 'unit' : line.includes('--shard=') ? 'e2e' : 'native';
    counts[group][match[2]] += Number(match[1]);
  }
  ci.push({ ...report, counts });
}
await save('ci.json', ci);
const operation = {};
for (const name of evidence.filter((name) => name.includes('operation') && name.endsWith('.log'))) {
  operation[name] = (await readFile(path.join(local, name), 'utf8')).split('\n').flatMap((line) => {
    const match = /LIVE_(?:VOLUME_INPUT|OPERATION_RESULTS|SEEK_STATE) (\{.*\})/.exec(line);
    return match ? [JSON.parse(match[1])] : [];
  });
}
await save('native-inputs.json', operation);
const profileFiles = evidence.filter((name) => /^A-profile-\d+-(left|right)\.json$/.test(name));
if (profileFiles.length)
  await save(
    'A-profile.json',
    await Promise.all(
      profileFiles.map(async (name) => {
        const { pair, side, valid, error, profile } = await json(path.join(local, name));
        return { pair, side, valid, error, profile };
      }),
    ),
  );
const f = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');
let markdown = '# 組ごとの計測値\n\n';
for (const stage of formalStages) {
  const group = groups[stage];
  if (!group) continue;
  markdown += `## ${stage}\n\n有効な組は ${group.accepted.join('・') || 'なし'}。左と右は版の順。実行順は各組で交替。\n\n`;
  if (!stage.startsWith('B-')) {
    markdown +=
      '| 組 | 実行順 | CPU p95 左→右 (ms) | Δ p95 | rAF 左→右 | コール合計 左→右 (ms) | コール p95 左→右 (ms) | ≥2 / 5 / 10 / 16ms 左→右 | 動画 drop/total 左→右 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
    for (const p of group.blocks['quiet:startup']?.pairs ?? []) {
      const hits = (call) => [call.atLeast2, call.atLeast5, call.atLeast10, call.atLeast16].join(' / ');
      const drop = (v) => (v ? `${v.dropped}/${v.total}` : '—');
      markdown += `| ${p.pair} | ${p.order.join('→')} | ${f(p.left.cpu.p95)} → ${f(p.right.cpu.p95)} | ${f(p.delta.p95)} | ${p.left.clock.actualRafFrames} → ${p.right.clock.actualRafFrames} | ${f(p.left.cpu.total)} → ${f(p.right.cpu.total)} | ${f(p.left.call.p95)} → ${f(p.right.call.p95)} | ${hits(p.left.call)} → ${hits(p.right.call)} | ${drop(p.left.video)} → ${drop(p.right.video)} |\n`;
    }
  } else {
    markdown +=
      '| 場面 | 組 | CPU 中央値 左→右 (ms) | CPU p95 左→右 (ms) | Δ p95 | rAF 左→右 |\n| --- | --- | --- | --- | --- | --- |\n';
    for (const [scene, block] of Object.entries(group.blocks))
      for (const p of block.pairs)
        markdown += `| ${scene} | ${p.pair} | ${f(p.left.cpu.median)} → ${f(p.right.cpu.median)} | ${f(p.left.cpu.p95)} → ${f(p.right.cpu.p95)} | ${f(p.delta.p95)} | ${p.left.clock.actualRafFrames} → ${p.right.clock.actualRafFrames} |\n`;
  }
  markdown += '\n';
}
await writeFile(path.join(out, 'pairs.md'), markdown);
