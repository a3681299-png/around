// One signed-out real-site case per process. Keep every outcome; never retry a failed case.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const work = path.resolve('.work/ui11-verification');
await mkdir(work, { recursive: true });
const cases = [
  ['ink-lifecycle', 'tests/skin-ui11-live.spec.ts', 'checker warning, ink sampling'],
  ['outset', 'tests/skin-ui11-live.spec.ts', 'outward frames stay clear'],
  ['icons', 'tests/skin-ui11-live.spec.ts', 'measure self-filled search icons'],
  ['import-recheck', 'tests/skin-ui11-live.spec.ts', 'petal import explains all three'],
  ['lifecycle', 'tests/skin-ui11-live.spec.ts', 'lazy marks, SPA, native fullscreen'],
  ...[
    'video-card',
    'subscribe-button',
    'like-button',
    'dislike-button',
    'action-button',
    'search-box',
    'filter-chip',
    'description-panel',
    'comment-input',
  ].map((part) => [part, 'tests/skin-live.spec.ts', `: ${part} keeps`]),
  ...['light', 'dark'].map((mode) => [`ink-${mode}`, 'tests/skin-ink-live.spec.ts', `\\(${mode} mode\\)`]),
];
const run = process.env.UI11_LIVE_RUN ?? 'resumed';
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw new Error('Invalid live run name');
const wanted = process.env.UI11_LIVE_CASES?.split(',');
if (wanted?.some((name) => !cases.some((item) => item[0] === name))) throw new Error('Unknown live case');
const result = { startedAt: new Date().toISOString(), reason: process.env.UI11_LIVE_REASON, cases: [] };
for (const [name, file, pattern] of cases.filter((item) => !wanted || wanted.includes(item[0]))) {
  const suffix = run === 'resumed' ? '' : `-${run}`;
  const log = path.join(work, `live-${name}${suffix}.log`);
  const handle = await open(log, 'w');
  const startedAt = new Date().toISOString();
  const args = [
    'scripts/test.mjs',
    '--project=e2e',
    file,
    '--grep',
    pattern,
    `--output=.work/ui11-live-${name}${suffix}`,
    '--global-timeout=660000',
  ];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      WW_TEST_EXTENSION_PATH: '.work/ui11-test',
      WW_LIVE_UI11: '1',
      WW_LIVE_SKIN: '1',
      WW_LIVE_SKIN_SHOTS: 'docs/screenshots/ui1-1/verification/native',
      WW_LIVE_SKIN_DATA: '.work/ui11-verification/site-parts',
      ...(name === 'import-recheck'
        ? { WW_LIVE_UI11_SHOTS: 'docs/screenshots/ui1-1/verification/import-recheck' }
        : {}),
    },
    windowsHide: true,
    stdio: ['ignore', handle.fd, handle.fd],
  });
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
  } finally {
    await handle.close();
  }
  const text = (await readFile(log, 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
  const counts = Object.fromEntries(
    ['passed', 'failed', 'skipped'].map((kind) => [
      kind,
      Number([...text.matchAll(new RegExp('(?:^|\\n)\\s*(\\d+) ' + kind + '(?:\\s|$)', 'g'))].at(-1)?.[1] ?? 0),
    ]),
  );
  const row = { name, file, pattern, startedAt, endedAt: new Date().toISOString(), exit, log, ...counts };
  result.cases.push(row);
  await writeFile(path.join(work, `live-runs-${run}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(row));
}
if (result.cases.some((row) => row.exit !== 0 || row.passed !== 1)) process.exitCode = 1;
