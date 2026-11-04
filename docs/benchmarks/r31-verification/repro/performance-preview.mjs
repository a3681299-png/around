import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const campaign = JSON.parse(await readFile('.work/evidence/r31-perf-complete/runs.json', 'utf8')),
  groups = new Map();
for (const r of campaign.runs) {
  const p = groups.get(r.pair) ?? {};
  p[r.label] = r;
  groups.set(r.pair, p);
}
const pairs = [...groups].filter(([, p]) => p.before?.eligible && p.after?.eligible),
  stats = (xs) => {
    const s = xs.sort((a, b) => a - b),
      n = s.length;
    return { n, median: (s[Math.floor((n - 1) / 2)] + s[Math.ceil((n - 1) / 2)]) / 2, p95: s[Math.ceil(n * 0.95) - 1] };
  };
const result = { pairs: pairs.map(([n]) => n), formalComplete: pairs.length >= 4, rows: {} };
for (const phase of Object.keys(pairs[0][1].before.phases)) {
  const row = {};
  for (const label of ['before', 'after']) {
    const blocks = pairs.map(([, p]) => p[label].phases[phase]);
    for (const b of blocks) {
      assert.equal(b.hiddenSamples, 0);
      assert.equal(b.adSamples, 0);
      assert.ok(b.cpu.count > 120);
      assert.ok(b.valid);
      assert.ok(Math.abs(b.cpuMs - b.accountedCpuMs) < 0.001);
      if (phase === 'character:steady') {
        assert.ok(b.modelSamples > 20);
        assert.ok(!/SwiftShader|llvmpipe/i.test(b.finish.model.backend));
      }
    }
    row[label] = {
      cpu: stats(blocks.flatMap((b) => b.raw.cpuPerFrame)),
      video: blocks.reduce(
        (a, b) => ({ total: a.total + (b.video?.total ?? 0), dropped: a.dropped + (b.video?.dropped ?? 0) }),
        { total: 0, dropped: 0 },
      ),
    };
  }
  row.delta = { median: row.after.cpu.median - row.before.cpu.median, p95: row.after.cpu.p95 - row.before.cpu.p95 };
  result.rows[phase] = row;
}
await writeFile('.work/evidence/performance-preview.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
