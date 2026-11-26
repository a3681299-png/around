import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { playgroundOutputProblems } from '../../scripts/playground/check-output.mjs';
import { chromeBoundaryProblem } from '../../scripts/browser-boundary.mjs';
const results = { boundary: [], output: [], manifestUnchanged: false };
const run = (args) => {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: 'C:/Users/sm787/GitHub-Projects/web-world-themes/.work/creator-editor/.work/browsers',
    },
  });
  return { status: r.status, output: r.stdout + r.stderr };
};
await mkdir('.work/evidence', { recursive: true });
const fault = 'src/host/verification-chrome-fault.ts';
try {
  await writeFile(fault, 'export const verificationFault = () => chrome.storage.local.get("verification-only");\n');
  for (const [label, args] of [
    ['lint', ['scripts/lint.mjs']],
    ['unit', ['scripts/test.mjs', '--project=unit', 'tests/browser-boundary.spec.ts']],
  ]) {
    const r = run(args);
    await writeFile(`.work/evidence/boundary-fault-${label}.log`, r.output);
    results.boundary.push({
      label,
      status: r.status,
      detected: r.output.includes('src/host/verification-chrome-fault.ts'),
    });
    if (r.status === 0 || !r.output.includes('verification-chrome-fault.ts'))
      throw Error('Boundary fault survived ' + label);
  }
} finally {
  await rm(fault, { force: true });
}
for (const source of [
  'chrome.storage.local.get("x");',
  'chrome["storage"].local.get("x");',
  'const c = chrome; c.storage.local.get("x");',
])
  results.boundary.push({ source, problem: (await chromeBoundaryProblem('src/host/future.ts', source)) ?? null });
const manifest = JSON.parse(await readFile('.work/playground/content/manifest.json', 'utf8'));
const models = Object.values(manifest.assets)
  .filter((e) => /\.vrm$/.test(e.file))
  .map((e) => 'content/' + e.file);
results.output.push({ label: 'clean', problems: playgroundOutputProblems('.work/playground', models) });
for (const [label, file, body] of [
  ['trusie', 'content/trusie.vrm', 'synthetic sentinel'],
  ['private', 'content/PochibyKT_Pochi.vrm', 'synthetic sentinel'],
  ['mixamo-renamed', 'content/plain.glb', 'glTF....{"nodes":[{"name":"mixamorig:Hips"}]}'],
  ['japanese', 'credits.txt', 'トルーシェ'],
]) {
  const out = path.resolve('.work/output-fault-' + label);
  await cp('.work/playground', out, { recursive: true });
  await writeFile(path.join(out, file), body);
  const problems = playgroundOutputProblems(
    out,
    models.concat(label === 'mixamo-renamed' ? ['content/plain.glb'] : []),
  );
  const code = `import {playgroundOutputProblems} from './scripts/playground/check-output.mjs';const p=playgroundOutputProblems(${JSON.stringify(out)},${JSON.stringify(models.concat(label === 'mixamo-renamed' ? ['content/plain.glb'] : []))});if(p.length)throw Error('Playground output refused: '+p.join(';'));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  await writeFile(`.work/evidence/output-fault-${label}.log`, child.stdout + child.stderr);
  results.output.push({ label, problems, processStatus: child.status, syntheticOnly: true });
  if (!problems.length || child.status === 0) throw Error('Forbidden output survived ' + label);
}
results.manifestUnchanged =
  execFileSync('git', ['diff', '447b2bf', '0638453', '--', 'manifest.json'], { encoding: 'utf8' }).length === 0;
results.privateHistory = execFileSync(
  'git',
  ['log', '--all', '--format=oneline', '--name-only', '--', '*PochibyKT_Pochi*'],
  { encoding: 'utf8' },
);
const lint = run(['scripts/lint.mjs']);
await writeFile('.work/evidence/lint-source.log', lint.output);
results.cleanLintStatus = lint.status;
await writeFile('.work/evidence/static.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
