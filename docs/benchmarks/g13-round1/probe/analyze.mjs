// Summarise a G1.3 round 0 probe: hidden frames in the wheel window, and what the trace says.
// usage: node .work/g13r0-probes/analyze.mjs .work/g13r0-evidence/<label>.json
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const first = r.wheel[0].t,
  last = r.wheel.at(-1).t;
const inWheel = r.frames.filter((f) => f.t >= first && f.t <= last);
const ids = Object.keys(inWheel[0]?.layers ?? {});
const summary = {
  label: r.label,
  pointer: r.pointerMode,
  wheelEvents: r.wheel.length,
  wheelGapMedian: (() => {
    const g = r.wheel
      .slice(1)
      .map((w, i) => w.t - r.wheel[i].t)
      .sort((a, b) => a - b);
    return g[Math.floor(g.length / 2)];
  })(),
  framesInWheel: inWheel.length,
  hidden: Object.fromEntries(ids.map((id) => [id, inWheel.filter((f) => !f.layers[id]).length])),
  stopped: inWheel.reduce((m, f) => ((m[f.safety || 'none'] = (m[f.safety || 'none'] ?? 0) + 1), m), {}),
};
console.log(JSON.stringify(summary, null, 1));
// Timeline of visibility changes.
let prev = '';
for (const f of r.frames) {
  const k = ids.map((id) => (f.layers[id] ? 'V' : 'H')).join('') + ' ' + (f.safety || '').slice(0, 18);
  if (k !== prev) console.log(String(Math.round(f.t - first)).padStart(6), 'y', f.scrollY, k);
  prev = k;
}
console.log('--- geometry trace (relative to first wheel)');
for (const g of r.geometry) {
  const t = String(Math.round(g.at - first)).padStart(6);
  if (g.change === 'read')
    console.log(
      t,
      'read',
      `y=${g.scroll[1]}`,
      g.bumped ? 'BUMP' : '    ',
      JSON.stringify(g.causes),
      `vis=${g.visible} +${g.added}/-${g.removed} vpMoved=${g.viewportMoved} docMoved=${g.documentMoved}`,
      g.mutated?.length ? 'mut=' + g.mutated.slice(0, 4).join(' ') : '',
      g.scrollOnlyMoved ? 'SCROLL-ONLY-MOVED ' + JSON.stringify(g.scrollOnlyMoved) : '',
      g.documentMovedIds ? 'docMovedIds=' + g.documentMovedIds.join(',') : '',
    );
  else
    console.log(
      t,
      g.change,
      g.entry ?? '',
      g.wait ?? '',
      g.reason?.slice(0, 16) ?? '',
      g.diff ? JSON.stringify(g.diff).slice(0, 900) : '',
    );
}
