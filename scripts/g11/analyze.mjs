import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { workPath } from './environment.mjs';

if (!process.env.G11_WORK) throw new Error('Set G11_WORK to the measurement result directory.');
const work = workPath(process.env.G11_WORK);
const data = JSON.parse(await readFile(path.join(work, 'baseline.json'), 'utf8'));
assert(!data.failure, 'Rejected or incomplete measurements must not be reported as a successful run.');
function stats(values) {
  const a = [...values].sort((a, b) => a - b),
    n = a.length;
  return {
    count: n,
    sum: values.reduce((a, b) => a + b, 0),
    median: n ? (a[Math.floor((n - 1) / 2)] + a[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? a[Math.ceil(n * 0.95) - 1] : null,
    max: a.at(-1) ?? null,
  };
}
function unionArea(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.left, r.right]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1],
      right = xs[i];
    const spans = rects
      .filter((r) => r.left < right && r.right > left)
      .map((r) => [r.top, r.bottom])
      .sort((a, b) => a[0] - b[0]);
    let bottom = -Infinity,
      length = 0;
    for (const [top, end] of spans) {
      length += Math.max(0, end - Math.max(top, bottom));
      bottom = Math.max(bottom, end);
    }
    area += (right - left) * length;
  }
  return area;
}
const checks = [];
for (const row of data.areas) {
  const { width, height } = row.viewport;
  const rects = row.snapshot.surfaces
    .filter(
      (s) => s.availability.visible && s.compositionCapability !== 'native-above' && s.policy.occlusion !== 'allow',
    )
    .map((s) => {
      const r = s.protectedEnvelope;
      return {
        left: Math.max(0, r.left),
        right: Math.min(width, r.left + r.width),
        top: s.scrolls ? 0 : Math.max(0, r.top),
        bottom: s.scrolls ? height : Math.min(height, r.top + r.height),
      };
    })
    .filter((r) => r.left < r.right && r.top < r.bottom);
  const expected = row.snapshot.supported ? width * height - unionArea(rects) : 0;
  assert(Math.abs(row.safePixels - expected) < 1e-4, row.name + ' area mismatch');
  for (let i = 0; i < row.regions.length; i++)
    for (let j = i + 1; j < row.regions.length; j++) {
      const a = row.regions[i],
        b = row.regions[j];
      assert(
        Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) <= 1e-7 ||
          Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) <= 1e-7,
        'safe regions overlap',
      );
    }
  checks.push({ name: 'independent union and disjointness: ' + row.name, passed: true });
  if (row.pageRegions) {
    // The page plane cuts page-scrolling surfaces at their envelope, inner scroll boxes whole
    // and screen-fixed surfaces along their column; recomputed here independently.
    const pageRects = row.snapshot.surfaces
      .filter(
        (s) => s.availability.visible && s.compositionCapability !== 'native-above' && s.policy.occlusion !== 'allow',
      )
      .map((s) => {
        const r = !s.scrolls
          ? { ...s.protectedEnvelope, top: -1e7, height: 2e7 }
          : (s.scrollBox ?? s.protectedEnvelope);
        return {
          left: Math.max(0, r.left),
          right: Math.min(width, r.left + r.width),
          top: Math.max(0, r.top),
          bottom: Math.min(height, r.top + r.height),
        };
      })
      .filter((r) => r.left < r.right && r.top < r.bottom);
    const pageExpected = row.snapshot.supported && row.pageSlot ? width * height - unionArea(pageRects) : 0;
    // A partition that exceeds the clip budget is reported as zero (no paint), never larger.
    assert(
      Math.abs(row.pageSafePixels - pageExpected) < 1e-4 || (row.pageSafePixels === 0 && row.pageRegions.length === 0),
      row.name + ' page area mismatch',
    );
    checks.push({ name: 'independent page-plane union: ' + row.name, passed: true });
  }
}
const playback = data.playback;
if (playback) {
  const events = playback.validation.events;
  assert(playback.validation.sameElement);
  assert(playback.end.currentTime - playback.start.currentTime >= 59);
  assert(playback.validation.samples.length >= 58);
  assert(playback.validation.samples.every((s) => s.sameElement && !s.ad && !s.paused && s.readyState >= 2));
  assert(!events.some((e) => ['loadedmetadata', 'emptied', 'error', 'seeking', 'pause', 'waiting'].includes(e.type)));
  checks.push({ name: '60 second real playback validity', passed: true });
}
const pooled = {
  guarded: { cpu: [], quiet: [], recapturing: [], intervals: [], fullFrame: [], render: [], recaptures: [] },
  unguarded: { cpu: [], quiet: [], recapturing: [], intervals: [], fullFrame: [], render: [], recaptures: [] },
};
for (const pair of data.pairs)
  for (const block of pair.blocks) {
    const mode = block.guarded ? 'guarded' : 'unguarded';
    const raw = JSON.parse(await readFile(path.join(work, `pair-${pair.pair}-${mode}-raw.json`), 'utf8'));
    const grouped = new Map();
    for (const r of raw.frames) {
      assert(Number.isFinite(r.ms) && r.ms >= 0);
      grouped.set(r.time, (grouped.get(r.time) ?? 0) + r.ms);
    }
    assert(grouped.size >= 1);
    pooled[mode].cpu.push(...grouped.values());
    // A recapture belongs to the latest RAF that started at or before it. Captures outside
    // RAF callbacks can only move a frame into the recapture group, never out of it.
    const starts = [...grouped.keys()].sort((a, b) => a - b),
      recapturing = new Set();
    for (const { time } of raw.captures) {
      let low = 0,
        high = starts.length - 1,
        found;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (starts[mid] <= time) ((found = starts[mid]), (low = mid + 1));
        else high = mid - 1;
      }
      if (found !== undefined) recapturing.add(found);
    }
    for (const [time, ms] of grouped) pooled[mode][recapturing.has(time) ? 'recapturing' : 'quiet'].push(ms);
    pooled[mode].intervals.push(...raw.intervals);
    pooled[mode].recaptures.push(...raw.captures.map((r) => r.ms));
    checks.push({ name: `valid frame records: ${pair.pair} ${mode}`, passed: true });
  }
const traces = [];
for (const file of await readdir(work))
  if (file.endsWith('-trace.json')) {
    if (!data.pairs.some((p) => file.startsWith(`pair-${p.pair}-`))) continue;
    const trace = JSON.parse(await readFile(path.join(work, file), 'utf8')).traceEvents;
    const mode = file.includes('-unguarded-') ? 'unguarded' : 'guarded';
    const counts = new Map();
    for (const e of trace)
      if (e.name === 'FireAnimationFrame') counts.set(`${e.pid}:${e.tid}`, (counts.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
    const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const open = new Map(),
      fullFrame = [],
      render = [];
    for (const e of [...trace].filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts)) {
      if (e.name === 'AnimationFrame' && ['s', 'f'].includes(e.ph)) {
        const key = `full:${e.id}`;
        if (e.ph === 's') open.set(key, e.ts);
        else if (open.has(key)) {
          fullFrame.push((e.ts - open.get(key)) / 1000);
          open.delete(key);
        }
      }
      if (e.name === 'AnimationFrame::Render' && ['b', 'e'].includes(e.ph)) {
        const key = `render:${JSON.stringify(e.id2)}`;
        if (e.ph === 'b') open.set(key, e.ts);
        else if (open.has(key)) {
          render.push((e.ts - open.get(key)) / 1000);
          open.delete(key);
        }
      }
    }
    pooled[mode].fullFrame.push(...fullFrame);
    pooled[mode].render.push(...render);
    assert(fullFrame.length > 0, 'No complete frame flows found: ' + file);
    const names = new Map();
    for (const e of trace) {
      const entry = names.get(e.name) ?? { name: e.name, count: 0, totalDuration: 0, phases: new Set() };
      entry.count++;
      entry.totalDuration += e.dur ?? 0;
      entry.phases.add(e.ph);
      names.set(e.name, entry);
    }
    traces.push({
      file,
      events: trace.length,
      main,
      fullFrameMs: stats(fullFrame),
      renderMs: stats(render),
      names: [...names.values()]
        .sort((a, b) => b.totalDuration - a.totalDuration)
        .slice(0, 40)
        .map((x) => ({ ...x, phases: [...x.phases] })),
      animationSamples: trace.filter((e) => /AnimationFrame|BeginMainThreadFrame/.test(e.name)).slice(0, 14),
      threads: trace.filter((e) => e.ph === 'M'),
    });
  }
const modes = Object.fromEntries(
  Object.entries(pooled).map(([mode, p]) => [
    mode,
    {
      fullFrameMs: stats(p.fullFrame),
      renderPhaseMs: stats(p.render),
      extensionRafCpuMs: stats(p.cpu),
      extensionCpuQuietFrameMs: stats(p.quiet),
      extensionCpuRecaptureFrameMs: stats(p.recapturing),
      rafIntervalMs: stats(p.intervals),
      recaptureMs: stats(p.recaptures),
    },
  ]),
);
const summary = {
  revision: data.revision,
  measuredAt: data.measuredAt,
  areas: data.areas.map(
    ({
      name,
      drawablePercent,
      pageDrawablePercent,
      pageSlot,
      surfaceCount,
      viewport,
      cards,
      commentThreads,
      safePixels,
      totalPixels,
    }) => ({
      name,
      drawablePercent,
      pageDrawablePercent,
      pageSlot,
      surfaceCount,
      viewport,
      cards,
      commentThreads,
      safePixels,
      totalPixels,
    }),
  ),
  playback: playback
    ? {
        ...playback,
        validation: {
          sameElement: playback.validation.sameElement,
          eventCount: playback.validation.events.length,
          sampleCount: playback.validation.samples.length,
        },
      }
    : null,
  p95: modes,
  // Pass/fail: extension CPU per frame on frames without a recapture. Full-frame p95 is
  // recorded for reference only; it swings with machine load even without the guard.
  verdict: (() => {
    const g = modes.guarded.extensionCpuQuietFrameMs,
      u = modes.unguarded.extensionCpuQuietFrameMs;
    if (!g.count || !u.count) return null;
    const medianDelta = g.median - u.median,
      p95Delta = g.p95 - u.p95;
    return { medianDelta, p95Delta, limits: { median: 0.5, p95: 1 }, pass: medianDelta <= 0.5 && p95Delta <= 1 };
  })(),
  pairs: data.pairs,
  checks,
  traceIndex: traces,
};
await writeFile(
  process.env.G11_SUMMARY_PATH ? workPath(process.env.G11_SUMMARY_PATH) : path.join(work, 'summary.json'),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify(
    { ...summary, traceIndex: traces.map((t) => ({ file: t.file, events: t.events, names: t.names.slice(0, 18) })) },
    null,
    2,
  ),
);
