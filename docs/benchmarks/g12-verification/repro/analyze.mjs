import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const base = '.work/g12v-evidence';
const read = async (name) => JSON.parse(await readFile(path.join(base, name), 'utf8'));
const median = (a) => {
  a = a.toSorted((a, b) => a - b);
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2;
};
const summary = {
  target: '67ad03d',
  baseline: '557b978',
  live: [],
  visual: [],
  performance: {},
};
for (let n = 1; n <= 3; n++) {
  const r = await read(`signal-live-${n}.json`),
    p = r.checks.pointer,
    steps = p.under;
  summary.live.push({
    run: n,
    complete: r.completed,
    pointer: p.point,
    samples: steps.length,
    controlsUnderPointer: steps.filter((s) => s.control).length,
    hidden: steps.filter((s) => s.gifAt?.visibility === 'hidden').length,
    gifHeld: steps.filter((s) => Object.hasOwn(s.approach?.held ?? {}, p.gifId)).length,
    stops: Object.fromEntries(
      [...new Set(steps.map((s) => s.gifAt?.stopped))].map((k) => [
        String(k),
        steps.filter((s) => s.gifAt?.stopped === k).length,
      ]),
    ),
  });
}
for (const label of ['current', 'before-557b978']) {
  const r = await read(`visual-${label}.json`),
    frames = r.wheel;
  const first = r.wheelEvents?.[0]?.t,
    last = r.wheelEvents?.at(-1)?.t;
  const active = frames.filter((f) => f.t >= first && f.t <= last);
  const hidden = active.filter((f) => !f.visible);
  const transitions = active.slice(1).filter((f, i) => f.visible !== active[i].visible).length;
  const reason = (f) => JSON.parse(f.safety ?? '{}').stopped ?? '';
  const reasons = Object.fromEntries(
    [...new Set(hidden.map(reason))].map((k) => [k, hidden.filter((f) => reason(f) === k).length]),
  );
  summary.visual.push({
    label,
    held: r.held,
    nearX: r.timeline.map((f) => f.find((n) => n.id === 'visual-0')?.x),
    farX: r.timeline.map((f) => f.find((n) => n.id === 'visual-1')?.x),
    wheelEvents: r.wheelEvents?.length,
    inputIntervalMedian: median((r.wheelEvents ?? []).slice(1).map((e, i) => e.t - r.wheelEvents[i].t)),
    activeFrames: active.length,
    hiddenFrames: hidden.length,
    hiddenPercent: (100 * hidden.length) / active.length,
    visibilityTransitions: transitions,
    reasons,
    captures: r.captures?.length,
    frameIntervalMedian: median(frames.slice(1).map((f, i) => f.t - frames[i].t)),
    wholeFrames: frames.length,
  });
}
const perf = await read('performance.json');
for (const phase of ['startup', 'steady', 'scroll', 'spa']) {
  const rows = perf.pairs.map((p) => ({
    pair: p.pair,
    order: p.order,
    before: p.before.phases[phase].cpuMs,
    after: p.current.phases[phase].cpuMs,
    deltaMedian: p.current.phases[phase].cpuMs.median - p.before.phases[phase].cpuMs.median,
    deltaP95: p.current.phases[phase].cpuMs.p95 - p.before.phases[phase].cpuMs.p95,
  }));
  summary.performance[phase] = {
    rows,
    medianDelta: median(rows.map((r) => r.deltaMedian)),
    p95Delta: median(rows.map((r) => r.deltaP95)),
    pass: median(rows.map((r) => r.deltaMedian)) <= 0.5 && median(rows.map((r) => r.deltaP95)) <= 1,
  };
}
summary.performance.calibration = {
  before: perf.calibration[0].phases.calibration.cpuMs,
  busy: perf.calibration[1].phases.calibration.cpuMs,
  delta: perf.calibration[1].phases.calibration.cpuMs.median - perf.calibration[0].phases.calibration.cpuMs.median,
};
await writeFile(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
