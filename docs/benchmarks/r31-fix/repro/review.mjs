import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const work = path.resolve('.work/r31-fix-evidence'),
  dir = path.join(work, 'performance');
const runs = [];
for (const file of (await readdir(dir)).filter((f) => /^pair-\d+-(before|after)\.json$/.test(f)))
  runs.push(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
runs.sort((a, b) => a.pair - b.pair || Date.parse(a.started) - Date.parse(b.started));
const calibration = JSON.parse(await readFile(path.join(work, 'calibration/calibration-runs.json'), 'utf8'));
const interrupted = process.argv.includes('--interrupted');
const control = {
  interrupted,
  reason: interrupted
    ? 'User changed background CPU from a 5% rejection gate to reference data; capture stopped after enough complete pairs existed.'
    : 'Completed capture reviewed with background CPU as reference data.',
  backgroundPolicy: 'reference only',
  oldBackgroundThresholdPercent: 5,
  selection: 'first four complete pairs in chronological order; never selected by CPU values',
  requestedPairs: 4,
  reviewedAt: new Date().toISOString(),
  captureScript: interrupted ? 'capture-strict.spec.ts' : 'perf.spec.ts',
};
await writeFile(
  path.join(dir, 'runs.json'),
  JSON.stringify({ environment: calibration.environment, control, runs }, null, 2),
);
await writeFile(path.join(work, 'capture-control.json'), JSON.stringify(control, null, 2));
console.log(JSON.stringify({ control, profiles: runs.length }));
