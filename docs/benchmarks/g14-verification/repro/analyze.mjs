import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [mode, file] = process.argv.slice(2);
const data = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const tests = [];
function walk(s) {
  for (const spec of s.specs ?? [])
    for (const test of spec.tests ?? []) tests.push({ title: spec.title, file: spec.file, ...test });
  for (const child of s.suites ?? []) walk(child);
}
walk(data);
if (mode === 'timing') {
  const rows = [];
  for (const test of tests.filter((t) => t.title.startsWith('G1.4: a silent'))) {
    for (const result of test.results ?? []) {
      const read = async (name) => {
        const a = result.attachments.find((a) => a.name === name);
        if (!a) return;
        return JSON.parse(a.body ? Buffer.from(a.body, 'base64').toString() : await readFile(a.path, 'utf8'));
      };
      const sample = await read('sparse-visual.json');
      if (!sample) continue;
      const { movedAt, rows: frames } = sample;
      const covered = frames.filter((r) => r.moved && r.covered);
      const safe = frames.find((r) => r.moved && !r.covered);
      rows.push({
        repeat: rows.length + 1,
        workerIndex: result.workerIndex,
        status: result.status,
        movedAt,
        lastCoveredAge: covered.length ? covered.at(-1).t - movedAt : null,
        firstSafeAge: safe ? safe.t - movedAt : null,
        maxFrameGap: Math.max(...frames.slice(1).map((r, i) => r.t - frames[i].t)),
        pixels: await read('native-pixel-comparison.json'),
      });
    }
  }
  const summary = { stats: data.stats, rows };
  await writeFile(file.replace(/\.json$/, '-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    JSON.stringify(
      {
        stats: data.stats,
        failed: tests
          .filter((t) => t.results.some((r) => r.status === 'failed'))
          .map((t) => ({
            title: t.title,
            errors: t.results.flatMap((r) =>
              r.errors.map((e) => ({ location: e.location, message: e.message?.slice(0, 500) })),
            ),
            attachments: t.results.flatMap((r) => r.attachments.map((a) => ({ name: a.name, path: a.path }))),
          })),
      },
      null,
      2,
    ),
  );
}
