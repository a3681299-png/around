import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const base = new URL('../', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, base), 'utf8'));
let phases = 0;
for (const name of ['performance', 'calibration']) {
  const data = await read(name + '.json');
  const bytes = await readFile(new URL(data.rawArtifact.file, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), data.rawArtifact.sha256);
  const raw = JSON.parse(gunzipSync(bytes).toString('utf8'));
  const runs = data.runs ?? data.pairs.flatMap((p) => p.order.map((n) => p[n]));
  for (const run of runs) {
    assert.equal(run.build.dirtySource, false);
    assert.equal(run.browser, '153.0.8010.12');
    for (const phase of Object.values(run.phases)) {
      const r = raw[phase.rawKey];
      const values = Array(r.frames.length - 1).fill(0);
      for (let i = 0; i < r.calls.length; i += 2) {
        const frame = r.frames.findLastIndex((t) => t <= r.calls[i]);
        if (frame >= 0 && frame < values.length) values[frame] += r.calls[i + 1];
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
const data = await read('focused.json');
const run = (name) => data.runs.find((r) => r.label === name);
const attachment = (label, name) =>
  run(label)
    .tests.flatMap((t) => t.attachments)
    .find((a) => a.name === name).content;
assert.equal(run('g1').stats.expected, 59);
assert.equal(run('g1').stats.unexpected, 0);
assert.equal(run('bound-before').stats.unexpected, 2);
const irregular = attachment('independent-after', 'irregular-populations.json');
assert.equal(irregular.trials.length, 96);
assert.equal(
  irregular.trials.reduce((n, t) => n + t.rows.length, 0),
  2304,
);
assert.deepEqual(irregular.violations, []);
assert.ok(irregular.populations.every((p) => p.count === p.discovered));
assert.ok(irregular.trials.every((t) => t.foundAt !== null));
const tab = attachment('background-matching-browser', 'background-return.json');
assert.equal(tab.noDefaults, true);
assert.equal(tab.browser, '153.0.8010.12');
assert.equal(tab.originalTab.windowId, tab.otherTab.windowId);
assert.deepEqual(
  tab.after.visibility.map((v) => v.hidden),
  [true, false],
);
assert.ok(tab.after.age > 404);
assert.equal(tab.after.snapshot, tab.after.actual);
assert.equal(attachment('pixels-after', 'native-pixel-comparison.json').different, 0);
for (const label of ['idle-visual-confirmed', 'idle-visual-trace']) {
  assert.equal(run(label).stats.unexpected, 1);
  const pixels = attachment(label, 'native-pixel-comparison.json');
  assert.equal(pixels.pixels, 2800);
  assert.equal(pixels.idleDifferent, 2800);
  assert.equal(pixels.different, 0);
  const visual = attachment(label, 'sparse-visual.json');
  assert.ok(visual.rows.some((r) => r.covered && r.t > visual.movedAt + 404 + 34));
}
const trace = attachment('idle-visual-trace', 'idle-geometry.json');
const visual = attachment('idle-visual-trace', 'sparse-visual.json');
const groups = trace.geometry.filter((e) => e.change === 'sweep' && e.group === 0);
const old = groups.filter((e) => e.at - trace.origin < visual.movedAt).at(-1);
const next = groups.find((e) => e.at - trace.origin > visual.movedAt);
assert.ok(next.at - old.at > 1000);
console.log(
  `Validated ${phases} raw CPU phases, G1 59, 2304 source reads, real visibility, and the 2800-pixel idle failure.`,
);
