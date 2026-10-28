// CPU sampling is diagnostic only. Never use these perturbed runs for the performance gate.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const folder = path.resolve(process.argv[2] ?? '.work/ui11-verification/profile-v3');
if (
  !path.relative(path.resolve('.work'), folder) ||
  path.relative(path.resolve('.work'), folder).startsWith('..') ||
  path.isAbsolute(path.relative(path.resolve('.work'), folder))
)
  throw new Error('Profiles must stay inside .work.');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const result = await read(path.join(folder, 'result.json'));
if (!result.summary) throw new Error('Wait for the profile run to finish.');
const order = result.pairs.flatMap((row) => row.order.map((condition) => ({ pair: row.pair + 1, condition })));
const summaries = [];
const totals = new Map();
for (const phase of ['startup', 'steady', 'spa']) {
  const files = (await readdir(folder))
    .filter((name) => name.includes(`-${phase}-`) && name.endsWith('-cpuprofile.json'))
    .sort((a, b) => Number(a.match(/-(\d+)-cpuprofile/)?.[1]) - Number(b.match(/-(\d+)-cpuprofile/)?.[1]));
  if (files.length !== order.length) throw new Error(`Profile/block mismatch in ${phase}.`);
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const profile = await read(path.join(folder, file));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    const self = new Map();
    for (let sample = 0; sample < profile.samples.length; sample++) {
      const frame = nodes.get(profile.samples[sample]);
      const key = JSON.stringify(frame);
      self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[sample] / 1000);
    }
    const functions = [...self]
      .map(([key, selfMs]) => ({ ...JSON.parse(key), selfMs }))
      .sort((a, b) => b.selfMs - a.selfMs);
    const extension = functions.filter((frame) => frame.url.startsWith('chrome-extension://'));
    const group = `${phase}:${order[index].condition}`;
    const cumulative = totals.get(group) ?? { runs: 0, functions: new Map() };
    cumulative.runs++;
    for (const frame of extension) {
      const key = JSON.stringify([frame.functionName, frame.url, frame.lineNumber, frame.columnNumber]);
      const previous = cumulative.functions.get(key);
      cumulative.functions.set(key, { ...frame, selfMs: (previous?.selfMs ?? 0) + frame.selfMs });
    }
    totals.set(group, cumulative);
    summaries.push({
      ...order[index],
      phase,
      file,
      durationMs: (profile.endTime - profile.startTime) / 1000,
      extensionSampledMs: extension.reduce((sum, frame) => sum + frame.selfMs, 0),
      topExtension: extension.slice(0, 10),
      topAll: functions.slice(0, 10),
    });
  }
}
const output = path.join(folder, 'profile-summary.json');
const aggregate = Object.fromEntries(
  [...totals].map(([key, group]) => [
    key,
    {
      runs: group.runs,
      topExtension: [...group.functions.values()]
        .map((frame) => ({ ...frame, selfMsPerRun: frame.selfMs / group.runs }))
        .sort((a, b) => b.selfMs - a.selfMs)
        .slice(0, 15),
    },
  ]),
);
await writeFile(output, JSON.stringify({ diagnosticOnly: true, aggregate, summaries }, null, 2));
console.log(
  JSON.stringify(
    summaries.filter((row) => row.phase === 'startup'),
    null,
    2,
  ),
);
