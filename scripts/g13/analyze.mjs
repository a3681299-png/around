// Summarise scripts/g13/perf.spec.ts output: per scene, each build's median/p95 per pair, the
// "b − a" difference per pair and its median, and the same-build near − far difference (D1).
// usage: node scripts/g13/analyze.mjs <performance.json> [a] [b]
import { readFileSync } from 'node:fs';

const [file, aName, bName] = process.argv.slice(2);
const result = JSON.parse(readFileSync(file, 'utf8'));
const [a, b] = aName && bName ? [aName, bName] : Object.keys(result.builds);
const median = (values) => {
  const s = values.filter((v) => v !== null && v !== undefined).toSorted((x, y) => x - y);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null;
};
const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
const scenes = ['startup', 'steady', 'scrollFar', 'scrollNear', 'spa'];
const rows = [];
for (const scene of scenes) {
  const pairs = result.pairs.filter((p) => p[a]?.phases[scene] && p[b]?.phases[scene]);
  if (!pairs.length) continue;
  const at = (p, name, key) => p[name].phases[scene].cpuMs[key];
  rows.push({
    scene,
    pairs: pairs.length,
    [a]: pairs.map((p) => `${round(at(p, a, 'median'))}/${round(at(p, a, 'p95'))}`).join(' '),
    [b]: pairs.map((p) => `${round(at(p, b, 'median'))}/${round(at(p, b, 'p95'))}`).join(' '),
    diffMedian: round(median(pairs.map((p) => at(p, b, 'median') - at(p, a, 'median')))),
    diffP95: round(median(pairs.map((p) => at(p, b, 'p95') - at(p, a, 'p95')))),
    shown: scene.startsWith('scroll')
      ? pairs
          .map((p) =>
            [a, b].map((n) => `${p[n].phases[scene].visibility.shown}/${p[n].phases[scene].visibility.frames}`),
          )
          .join(' ')
      : '',
    invalid: pairs.flatMap((p) => [a, b].filter((n) => p[n].phases[scene].invalid)).join(','),
  });
}
console.table(rows);
// D1 addition: near against far in the same build and pair (median of the per-pair differences).
const nearFar = [a, b].map((name) => {
  const pairs = result.pairs.filter((p) => p[name]?.phases.scrollNear && p[name]?.phases.scrollFar);
  const d = (key) =>
    round(median(pairs.map((p) => p[name].phases.scrollNear.cpuMs[key] - p[name].phases.scrollFar.cpuMs[key])));
  return { build: name, pairs: pairs.length, nearMinusFarMedian: d('median'), nearMinusFarP95: d('p95') };
});
console.table(nearFar);
console.log(JSON.stringify({ a, b, rows, nearFar }));
