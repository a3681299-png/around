// Attribute extension CPU in a .cpuprofile by caller chain.
// usage: node prof.mjs <file.cpuprofile>
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
for (let i = 0; i < p.samples.length; i++) {
  const d = (p.timeDeltas[i + 1] ?? 0) / 1000;
  self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + d);
}
const ext = (n) => n.callFrame.url.startsWith('chrome-extension://');
const name = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
const chain = (id) => {
  const out = [];
  for (let c = id; c !== undefined; c = parent.get(c)) out.push(byId.get(c));
  return out; // leaf first
};
// Inclusive (ext + native children such as getComputedStyle/layout) attributed to the first ext frame up the stack.
const inclusive = new Map(); // function -> ms
const entry = new Map(); // outermost ext frame -> ms
const callers = new Map(); // target -> (caller path) -> ms
const targets = [
  'applyLayout',
  'fixedContainingBlock',
  'rank2',
  'capture',
  'discover',
  'commit',
  'guardPaint',
  'protectionClip',
  'pagePaintRegions',
  'stepApproach',
  'sample',
  'draw',
];
let total = 0;
for (const [id, ms] of self) {
  const c = chain(id);
  const exts = c.filter(ext);
  if (!exts.length) continue;
  total += ms;
  const seen = new Set();
  for (const n of exts) {
    const k = n.callFrame.functionName || '(anon)';
    if (seen.has(k)) continue;
    seen.add(k);
    inclusive.set(k, (inclusive.get(k) ?? 0) + ms);
  }
  const outer = exts[exts.length - 1];
  entry.set(name(outer), (entry.get(name(outer)) ?? 0) + ms);
  for (const t of targets) {
    const i = exts.findIndex((n) => n.callFrame.functionName === t);
    if (i < 0) continue;
    const path = exts
      .slice(i + 1, i + 6)
      .map((n) => n.callFrame.functionName || `anon:${n.callFrame.lineNumber + 1}`)
      .join(' < ');
    const m = callers.get(t) ?? new Map();
    m.set(path, (m.get(path) ?? 0) + ms);
    callers.set(t, m);
  }
}
const top = (m, k = 12) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([a, b]) => `  ${b.toFixed(1).padStart(7)}  ${a}`)
    .join('\n');
console.log('extension stacks total (incl. native under ext):', total.toFixed(1), 'ms');
console.log('\n# inclusive per function\n' + top(inclusive, 25));
console.log('\n# outermost extension entry\n' + top(entry, 12));
for (const t of targets) if (callers.has(t)) console.log(`\n# ${t} inclusive by callers\n` + top(callers.get(t), 6));
