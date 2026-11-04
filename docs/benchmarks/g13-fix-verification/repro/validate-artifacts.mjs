// Check the preserved evidence independently of the browser runner's summaries.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const base = new URL('../', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, base), 'utf8'));
let phases = 0;
for (const file of ['performance.json', 'calibration.json']) {
  const summary = await read(file);
  const bytes = await readFile(new URL(summary.rawArtifact.file, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), summary.rawArtifact.sha256);
  const raw = JSON.parse(gunzipSync(bytes).toString('utf8'));
  const runs = summary.runs ?? summary.pairs.flatMap((p) => p.order.map((name) => p[name]));
  for (const run of runs) {
    assert.equal(run.build.dirtySource, false);
    for (const phase of Object.values(run.phases)) {
      const data = raw[phase.rawKey];
      const values = Array(data.frames.length - 1).fill(0);
      for (let i = 0; i < data.calls.length; i += 2) {
        const frame = data.frames.findLastIndex((t) => t <= data.calls[i]);
        if (frame >= 0 && frame < values.length) values[frame] += data.calls[i + 1];
      }
      values.sort((a, b) => a - b);
      const median = (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2;
      const p95 = values[Math.ceil(values.length * 0.95) - 1];
      assert.equal(values.length, phase.cpuMs.n);
      assert.ok(Math.abs(median - phase.cpuMs.median) < 1e-8);
      assert.ok(Math.abs(p95 - phase.cpuMs.p95) < 1e-8);
      phases++;
    }
  }
}
const focused = await read('focused.json');
for (const [side, expectedFailures] of [
  ['before', 8],
  ['after', 0],
]) {
  const runs = focused.runs.filter((r) => r.label.startsWith('controls-') && r.label.endsWith(side));
  assert.equal(
    runs.reduce((sum, r) => sum + r.tests.length, 0),
    20,
  );
  assert.equal(
    runs.reduce((sum, r) => sum + r.stats.unexpected, 0),
    expectedFailures,
  );
}
const bounds = focused.runs.find((r) => r.label === 'sparse-bound-no-trace');
assert.equal(bounds.tests.length, 2);
for (const test of bounds.tests) {
  assert.equal(test.status, 'failed');
  const result = test.attachments.find((a) => a.name === 'sparse-bound.json').content;
  assert.deepEqual(result.mutations, []);
  assert.ok(result.rows.some((r) => r.age > result.bound && !r.targetRead && r.snapshot !== r.actual));
}
console.log(`Validated ${phases} raw CPU phases, both 20-run comparisons, and both silent bound violations.`);
