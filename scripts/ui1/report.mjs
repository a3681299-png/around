// Preserve the independent run's values, including every alternating pair and rejected gate.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';
const directory = path.resolve('.work/ui1-verification');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const testCounts = async (file) => {
  const log = (await readFile(file, 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
  return Object.fromEntries(
    ['passed', 'failed', 'skipped'].map((kind) => [
      kind,
      Number([...log.matchAll(new RegExp('(?:^|\\n)\\s*(\\d+) ' + kind + '(?:\\s|$)', 'g'))].at(-1)?.[1] ?? 0),
    ]),
  );
};
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: sorted.at(-1) ?? null,
  };
};
const report = {
  verifiedAt: new Date().toISOString(),
  scope: {
    before: '29b8d5ba923c4a0a06db96678a4c27346893dd95',
    after: '97797dcde9658b457aa2b9728c59620390ac236b',
    excluded: '857ae43',
  },
  performance: {},
  calibration: await read(path.join(directory, 'calibration.json')),
  nativeParts: {},
  diagnostics: await read('.work/ui1-inspection.json'),
  profiles: {},
  dist: await read('.work/ui1-dist-check.json'),
  normalBuildHookProof: await read('.work/ui1-hook-build-proof.json'),
  g1: await read('.work/ui1-g1-contract.json'),
  tests: {
    unit: await testCounts('.work/ui1-unit-final-2.log'),
    e2eFirstFull: await testCounts('.work/ui1-e2e-full.log'),
    modelClockBefore: await testCounts('.work/ui1-model-clock-before.log'),
    modelClockAfter: await testCounts('.work/ui1-model-clock-after.log'),
    hooksAndSkinsRepeat: await testCounts('.work/ui1-hooks-repeat.log'),
    liveFinal: await testCounts('.work/ui1-live-final.log'),
    ci: { revision: '97797dc', run: 40426322049, status: 'success', unit: 354, e2e: 248, skipped: 28 },
  },
};
let tables = '';
for (const mode of ['build', 'skin']) {
  const data = await read(path.join(directory, `perf-${mode}/result.json`));
  report.performance[mode] = {
    ...data,
    pairs: data.pairs.map((pair) => ({
      ...pair,
      blocks: Object.fromEntries(
        Object.entries(pair.blocks).map(([condition, block]) => [
          condition,
          {
            ...block,
            ...Object.fromEntries(
              ['startup', 'steady', 'spa'].map((phase) => [
                phase,
                {
                  ...block[phase],
                  frames: undefined,
                  full: undefined,
                  cpu: stats(block[phase].frames),
                  fullFrame: stats(block[phase].full),
                },
              ]),
            ),
          },
        ]),
      ),
    })),
  };
  const conditions = mode === 'build' ? ['before', 'after'] : ['plain', 'skinned'];
  tables += `\n${mode}\n| 組・順 | 場面 | 中央値 前→後 | p95 前→後 | 増分 p95 |\n| --- | --- | --- | --- | --- |\n`;
  for (const row of data.pairs)
    for (const phase of ['startup', 'steady', 'spa']) {
      const [a, b] = conditions.map((condition) => stats(row.blocks[condition][phase].frames));
      const f = (value) => value.toFixed(2);
      tables += `| ${row.pair + 1} (${row.order.join('→')}) | ${phase} | ${f(a.median)}→${f(b.median)} | ${f(a.p95)}→${f(b.p95)} | ${f(b.p95 - a.p95)} |\n`;
    }
}
for (const file of await readdir(path.join(directory, 'parts'))) {
  if (!file.endsWith('.json')) continue;
  const key = file.slice(0, -5),
    value = await read(path.join(directory, 'parts', file));
  report.nativeParts[key] = value[key];
}
for (const file of await readdir(path.join(directory, 'profile-build'))) {
  if (!file.includes('startup') || !file.endsWith('cpuprofile.json')) continue;
  const profile = await read(path.join(directory, 'profile-build', file)),
    nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const sums = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const frame = nodes.get(profile.samples[i]).callFrame;
    if (!frame.url.startsWith('chrome-extension://')) continue;
    const key = JSON.stringify({
      name: frame.functionName || '(anonymous)',
      line: frame.lineNumber + 1,
      url: frame.url,
    });
    sums.set(key, (sums.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  report.profiles[file] = [...sums]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, selfMs]) => ({ ...JSON.parse(key), selfMs }));
}
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  'docs/benchmarks/ui1-verification-windows.json',
  await prettier.format(JSON.stringify(report), {
    ...(await prettier.resolveConfig('docs/benchmarks/ui1-verification-windows.json')),
    parser: 'json',
  }),
);
await writeFile(path.join(directory, 'pair-tables.md'), tables);
console.log(tables);
