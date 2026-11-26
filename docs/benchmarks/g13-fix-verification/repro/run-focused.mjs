import { spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
const after = process.cwd();
const before = path.resolve('..', 'g13-fix-before');
const out = path.resolve('.work/fix-evidence');
await mkdir(out, { recursive: true });
for (const name of ['g13-fix-pixels.spec.ts', 'g13-fix-geometry.spec.ts'])
  await copyFile(path.join(after, 'tests', name), path.join(before, 'tests', name));
const results = [];
async function run(label, root, args, extra = {}) {
  const json = path.join(out, label + '.json');
  const child = spawn(
    process.execPath,
    ['scripts/test.mjs', '--project=e2e', ...args, '--reporter=list,json', '--output=.work/fix-results/' + label],
    {
      cwd: root,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: path.resolve(after, '../../.work/browsers'),
        AROUND_TEST_EXTENSION_PATH: path.join(root, '.work/fix-build'),
        PLAYWRIGHT_JSON_OUTPUT_NAME: json,
        ...extra,
      },
      windowsHide: true,
    },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const code = await new Promise((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
  await writeFile(path.join(out, label + '.txt'), output);
  results.push({ label, revision: root === after ? 'd9fce76' : '6b54087', args, code });
  await writeFile(path.join(out, 'runs.json'), JSON.stringify(results, null, 2));
  console.log(
    label,
    'exit',
    code,
    output.match(/\d+ (?:passed|failed|skipped)(?: [^\r\n]*)?/g)?.join(' | ') ?? output.slice(-500),
  );
}
await run('look-after', after, ['tests/g13-fix-pixels.spec.ts']);
await run('look-before', before, ['tests/g13-fix-pixels.spec.ts']);
await run('subtree-after', after, ['tests/g13-fix-pixels.spec.ts'], { G13_WITNESS: 'subtree' });
await run('subtree-before', before, ['tests/g13-fix-pixels.spec.ts'], { G13_WITNESS: 'subtree' });
await run('geometry-after', after, ['tests/g13-fix-geometry.spec.ts']);
await run('geometry-before', before, ['tests/g13-fix-geometry.spec.ts']);
await run('sparse-bound-after', after, ['tests/g13-fix-bound.spec.ts']);
await run('editing-input-after', after, ['tests/operation-editing-input.spec.ts']);
await run('release-report-after', after, ['tests/operation-controls.spec.ts', '--grep', 'stays open']);
for (const [index, side] of ['before', 'after', 'after', 'before', 'before', 'after', 'after', 'before'].entries())
  await run(`controls-${index + 1}-${side}`, side === 'after' ? after : before, [
    'tests/operation-controls.spec.ts',
    '--grep',
    'Studio exposes protection overlays',
    '--repeat-each=5',
  ]);
