// Flickers (D11 report): a layer hidden for exactly one recorded frame between shown frames, per
// second, in the wheel span and in the comments-loading span. Also longer hidden runs.
// usage: node .work/g13r0-probes/flicker.mjs <label.json>...
import fs from 'node:fs';
const rows = [];
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spans = {
    wheel: [r.wheel[0].t, r.wheel.at(-1).t],
    ...(r.comments ? { comments: r.comments } : {}),
  };
  for (const [name, [from, to]] of Object.entries(spans)) {
    const frames = r.frames.filter((f) => f.t >= from && f.t <= to);
    for (const id of Object.keys(frames[0]?.layers ?? {})) {
      let flickers = 0,
        longer = 0,
        hidden = 0,
        run = 0;
      frames.forEach((f, i) => {
        if (!f.layers[id]) {
          hidden++;
          run++;
          return;
        }
        if (run === 1 && i > run) flickers++;
        else if (run > 1) longer++;
        run = 0;
      });
      const seconds = (to - from) / 1000;
      rows.push({
        label: r.label,
        span: name,
        layer: id,
        seconds: Math.round(seconds * 10) / 10,
        frames: frames.length,
        hidden,
        flickersPerSecond: Math.round((flickers / seconds) * 10) / 10,
        flickers,
        longerHides: longer,
      });
    }
  }
}
console.table(rows);
console.log(JSON.stringify(rows));
