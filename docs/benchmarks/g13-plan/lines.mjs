// Line-level self time (positionTicks) for one function in a .cpuprofile, with the bundle's source line.
// usage: node lines.mjs <file.cpuprofile> <functionName> <bundle.js>
import fs from 'node:fs';
const [file, fn, bundle] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const src = fs.readFileSync(bundle, 'utf8').split('\n');
const interval = (p.endTime - p.startTime) / p.samples.length / 1000; // ms per tick
const ticks = new Map();
for (const n of p.nodes)
  if (n.callFrame.functionName === fn && n.callFrame.url.startsWith('chrome-extension://'))
    for (const t of n.positionTicks ?? []) ticks.set(t.line, (ticks.get(t.line) ?? 0) + t.ticks);
const total = [...ticks.values()].reduce((a, b) => a + b, 0);
console.log(`${fn}: ${total} ticks ≈ ${(total * interval).toFixed(1)} ms`);
for (const [line, t] of [...ticks].sort((a, b) => b[1] - a[1]).slice(0, 15))
  console.log(`${(t * interval).toFixed(1).padStart(7)} ms  L${line}  ${src[line - 1]?.trim().slice(0, 110)}`);
