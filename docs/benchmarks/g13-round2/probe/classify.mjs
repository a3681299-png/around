// Classify every read and stop inside the wheel window (first wheel .. last wheel + 600ms).
// usage: node .work/g13r0-probes/classify.mjs <label.json>...
import fs from 'node:fs';
const rows = [];
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = r.wheel[0].t,
    end = r.wheel.at(-1).t + 600;
  const inWindow = (g) => g.at >= first - 200 && g.at <= end;
  const g = r.geometry.filter(inWindow);
  const reads = g.filter((x) => x.change === 'read');
  const frames = r.frames.filter((f) => f.t >= first && f.t <= r.wheel.at(-1).t);
  const ids = Object.keys(frames[0]?.layers ?? {});
  const shifted = g.filter((x) => x.change === 'shifted');
  // A boundary change where only scrollBox tops moved (the rest of each row equal).
  const scrollBoxOnly = shifted.filter(
    (x) =>
      x.entry === 'boundary' &&
      !x.diff.added.length &&
      !x.diff.removed.length &&
      x.diff.changed.every((c) => {
        const a = JSON.parse(c.before),
          b = JSON.parse(c.after);
        const box = (row) => row.at(-1);
        return (
          JSON.stringify(a.slice(0, -1)) === JSON.stringify(b.slice(0, -1)) &&
          Array.isArray(box(a)) &&
          Array.isArray(box(b)) &&
          box(a)[0] === box(b)[0] &&
          box(a)[2] === box(b)[2] &&
          box(a)[3] === box(b)[3]
        );
      }),
  );
  rows.push({
    label: r.label,
    pointer: r.pointerMode,
    framesInWheel: frames.length,
    hidden: Object.fromEntries(ids.map((id) => [id, frames.filter((f) => !f.layers[id]).length])),
    reads: reads.length,
    readsBumped: reads.filter((x) => x.bumped).length,
    readsWithMutation: reads.filter((x) => x.causes.mutation).length,
    readsScrollOnly: reads.filter((x) => Object.keys(x.causes).every((k) => k === 'scroll') && x.causes.scroll).length,
    readsDocumentMoved: reads.filter((x) => x.documentMoved > 0).length,
    readsAddedOrRemoved: reads.filter((x) => x.added || x.removed).length,
    scrollOnlyMoved: reads.flatMap((x) => x.scrollOnlyMoved ?? []),
    mutatedTargets: [...new Set(reads.flatMap((x) => x.mutated ?? []))].slice(0, 12),
    holds: g.filter((x) => x.change === 'hold').length,
    shifted: shifted.length,
    shiftedByEntry: shifted.reduce((m, x) => ((m[x.entry] = (m[x.entry] ?? 0) + 1), m), {}),
    shiftedScrollBoxTopOnly: scrollBoxOnly.length,
    scrollBoxRowsChanged: [...new Set(shifted.flatMap((x) => x.diff?.changed?.map((c) => c.id) ?? []))].length,
  });
}
console.log(JSON.stringify(rows, null, 1));
