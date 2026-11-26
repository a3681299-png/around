// Summarizes V8 CPU profiles from `UI1_CPUPROFILE=1 node scripts/ui1/measure.mjs …`:
// self time of the extension's content-script functions, per build and phase.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.work/ui1-results');
const phase = process.argv[3] ?? 'startup';
const totals = new Map();
for (const file of (await readdir(dir)).filter(
  (name) => name.includes(`-${phase}-`) && name.endsWith('cpuprofile.json'),
)) {
  const build = file.split(`-${phase}-`)[0];
  const profile = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  // Sample deltas are in microseconds; each sample belongs to the node it hit.
  profile.samples.forEach((id, index) => {
    const node = byId.get(id);
    const url = node?.callFrame.url ?? '';
    if (!url.startsWith('chrome-extension://') || !url.includes('content/index.js')) return;
    const key = `${node.callFrame.functionName || '(anonymous)'}:${node.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  const entry = totals.get(build) ?? { runs: 0, self: new Map() };
  entry.runs++;
  for (const [key, ms] of self) entry.self.set(key, (entry.self.get(key) ?? 0) + ms);
  totals.set(build, entry);
}
for (const [build, { runs, self }] of totals) {
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${build}: ${runs} runs, extension self time ${(total / runs).toFixed(1)} ms per run`);
  for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`  ${(ms / runs).toFixed(2).padStart(8)} ms  ${key}`);
}
