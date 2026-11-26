import { spawn } from 'node:child_process';
import { writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
const after = process.cwd(),
  before = path.resolve('..', 'g13-fix-before');
const out = path.resolve('.work/fix-evidence');
await copyFile(
  path.join(after, 'tests/g13-fix-editing-history.spec.ts'),
  path.join(before, 'tests/g13-fix-editing-history.spec.ts'),
);
const results = [];
async function run(label, root, args, extra = {}) {
  const child = spawn(
    process.execPath,
    ['scripts/test.mjs', '--project=e2e', ...args, '--reporter=list,json', '--output=.work/fix-results/' + label],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: path.resolve(after, '../../.work/browsers'),
        AROUND_TEST_EXTENSION_PATH: path.join(root, '.work/fix-build'),
        PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(out, label + '.json'),
        ...extra,
      },
    },
  );
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const code = await new Promise((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
  await writeFile(path.join(out, label + '.txt'), output);
  results.push({ label, revision: root === after ? 'd9fce76' : '6b54087', args, code });
  await writeFile(path.join(out, 'additional-runs.json'), JSON.stringify(results, null, 2));
  console.log(
    label,
    'exit',
    code,
    output.match(/\d+ (?:passed|failed|skipped)(?: [^\r\n]*)?/g)?.join(' | ') ?? output.slice(-500),
  );
}
await run('sparse-bound-realtime', after, ['tests/g13-fix-bound.spec.ts', '--repeat-each=2'], { G13_REALTIME: '1' });
await run('safety-ui-after', after, ['tests/g13-fix-safety-ui.spec.ts']);
await run('resume-history-after', after, ['tests/g13-fix-editing-history.spec.ts', '--grep', 'a covered control']);
await run('resume-history-before', before, ['tests/g13-fix-editing-history.spec.ts', '--grep', 'a covered control']);
await run('g13-protection-after', after, ['tests/operation-safety.spec.ts', '--grep', 'G1.3']);
