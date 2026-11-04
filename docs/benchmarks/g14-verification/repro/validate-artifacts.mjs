import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const base = new URL('../', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const raw = async (meta) => {
  const b = await readFile(new URL(meta.file, base));
  assert.equal(createHash('sha256').update(b).digest('hex'), meta.sha256);
  return JSON.parse(gunzipSync(b));
};
const checks = await read('checks.json'),
  tests = await raw(checks.rawArtifact);
const stat = (n) => tests[n].stats;
assert.equal(stat('windows-all').expected, 268);
assert.equal(stat('windows-all').skipped, 60);
assert.equal(stat('windows-all').unexpected, 0);
assert.equal(stat('timing20-complete').expected, 20);
assert.equal(stat('timing20-complete').unexpected, 0);
for (const [n, count] of [
  ['no-idle', 2],
  ['no-clip', 1],
  ['no-input', 1],
  ['no-approach', 2],
  ['long-wait-before', 1],
])
  assert.equal(stat(n).unexpected, count);
assert.equal(stat('no-hold').expected, 2);
assert.equal(stat('ci-case-before').expected, 10);
assert.equal(stat('ci-case-after').expected, 10);
const timing = await read('timing20.json');
assert.equal(timing.rows.length, 20);
for (const r of timing.rows) {
  assert.equal(r.status, 'passed');
  assert.ok(r.firstSafeAge <= 438);
  assert.equal(r.pixels.pixels, 2800);
  assert.equal(r.pixels.different, 0);
  assert.equal(r.pixels.idleDifferent, 0);
}
const bg = await read('background.json');
assert.equal(bg.noDefaults, true);
assert.deepEqual(
  bg.visibility.map((v) => v.hidden),
  [true, false],
);
for (const n of ['empty-after-shown', 'transparent-after-shown', 'real-hidden', 'inactive-after-shown', 'destroyed']) {
  const r = bg.rows.find((r) => r.name === n);
  assert.equal(r.reads, 0);
  assert.equal(r.rects, 0);
}
const work = await read('work-counts.json');
for (const n of ['none', 'transparent', 'stopped', 'hidden', 'hiddenLater']) assert.equal(work[n].reads, 0);
assert.ok(work.shown.reads >= 2 && work.shown.reads <= 4);
assert.deepEqual(work.shown.invalidations, []);
const visual = await read('youtube-visual.json');
await raw(visual.rawArtifact);
const contains = (s, x, y) =>
  [...s.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)].some(
    (m) => x > +m[1] && x < +m[1] + +m[3] && y > +m[2] && y < +m[2] + +m[4],
  );
for (const n of ['after', 'before', 'g12']) {
  const v = visual.runs.find((v) => v.label === n);
  assert.equal(v.safety.stopped, '');
  assert.equal(v.layers.find((x) => x.id === 'g14').visibility, 'visible');
  assert.equal(contains(v.clip, 300, 300), false);
  assert.equal(v.nativePlayer.find((x) => x.id === 'player.controls.bottom').scrolls, true);
}
const rec = visual.runs.find((v) => v.label === 'record');
assert.equal(rec.rechecks.length, 14);
assert.ok(rec.rechecks.every((r) => r.stack.includes('at recheck')));
assert.equal(new Set(rec.rechecks.map((r) => r.generation.geometry)).size, 1);
const ci = await read('ci-clip-timeline.json');
const hosts = ci.snapshots.flatMap((s) =>
  s.rows.filter((r) => r[1]?.id === 'web-world-themes-decorations').map((r) => ({ at: s.at, ...r[1] })),
);
const before = hosts.filter((s) => s.at < ci.movePlayerCall).at(-1),
  after = hosts.find((s) => s.at > ci.twoRaf.end);
assert.ok(after.at < ci.staleHitAssert);
assert.equal(JSON.parse(after['data-ww-safety']).stopped, '');
assert.ok(contains(before.style, 484, 253.764));
assert.equal(contains(after.style, 484, 253.764), false);

const perf = await read('performance.json'),
  data = await raw(perf.rawArtifact),
  cal = await read('calibration.json');
let phases = 0;
for (const [name, set] of Object.entries(perf.sceneSets)) {
  assert.equal(set.pairs.length, name === 'static' ? 1 : 4);
  if (name === 'static') {
    assert.equal(set.requiredPairs, 4);
    assert.equal(set.completePairs, 1);
    assert.match(set.verdict, /inconclusive/);
  }
  for (const pair of set.pairs) {
    assert.deepEqual(pair.order, pair.pair % 2 ? ['after', 'before'] : ['before', 'after']);
    for (const n of pair.order) {
      const run = pair[n];
      assert.equal(run.build.dirtySource, false);
      assert.ok(run.build.revision.startsWith(n === 'before' ? '20ffdc3' : 'ed03b29'));
      assert.equal(run.browser, bg.browser);
      if (name === 'static') {
        const p = run.phases.staticOpaque;
        assert.deepEqual(p.color, [0, 223, 255, 255]);
        assert.deepEqual(p.dimensions, { width: 1920, height: 1080 });
        assert.equal(p.pixels, 512);
        assert.equal(p.differentPixels, 0);
        assert.deepEqual(p.endState, { visibility: 'visible', opacity: '1', stopped: '' });
      }
      if (name === 'startup') {
        assert.equal(run.startupWindow.start, 0);
        assert.equal(run.startupWindow.end, 6000);
        assert.ok(run.phases.startup.cpuMs.n >= 120);
      }
    }
  }
}
const all = [
  ...Object.values(perf.sceneSets).flatMap((s) => s.pairs.flatMap((p) => p.order.map((n) => p[n]))),
  ...cal.runs,
];
for (const run of all)
  for (const p of Object.values(run.phases)) {
    const r = data[p.rawKey],
      values = Array(r.frames.length - 1).fill(0);
    for (let i = 0; i < r.calls.length; i += 2) {
      const idx = r.frames.findLastIndex((t) => t <= r.calls[i]);
      if (idx >= 0 && idx < values.length) values[idx] += r.calls[i + 1];
    }
    const sum = values.reduce((a, b) => a + b, 0);
    values.sort((a, b) => a - b);
    const median = (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2,
      p95 = values[Math.ceil(values.length * 0.95) - 1];
    assert.equal(values.length, p.cpuMs.n);
    assert.ok(Math.abs(median - p.cpuMs.median) < 1e-8);
    assert.ok(Math.abs(p95 - p.cpuMs.p95) < 1e-8);
    assert.ok(Math.abs(sum - p.cpuTotalMs) < 1e-6);
    phases++;
  }
const delta = cal.runs[1].phases.calibration.cpuMs.median - cal.runs[0].phases.calibration.cpuMs.median;
assert.ok(delta > 1.5 && delta < 3);
await raw((await read('logs.json')).rawArtifact);
await raw((await read('setup-failures.json')).rawArtifact);
const index = await read('artifact-index.json');
for (const entry of index.files) {
  const bytes = await readFile(new URL(entry.file, base));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}
console.log(
  `Validated ${phases} raw CPU phases, 20 visual trials, guard faults, real visibility and the CI clip timeline.`,
);
console.log(JSON.stringify(perf.aggregate, null, 2));
