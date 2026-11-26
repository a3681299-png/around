import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const install = process.argv.includes('--install');
const args = install ? ['install', 'chromium', '--no-shell'] : ['test', ...process.argv.slice(2)];
const child = spawn(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, '.work/browsers'),
    // On a developer's own machine, headed test windows open off the visible desktop so they do not
    // cover the work in progress (tests/fixtures.ts keeps them rendering). CI runs under its own
    // display server and keeps the default. Set AROUND_TEST_WINDOW_OFFSCREEN=0 to watch the windows.
    AROUND_TEST_WINDOW_OFFSCREEN: process.env.AROUND_TEST_WINDOW_OFFSCREEN ?? (process.env.CI ? undefined : '1'),
  },
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', async (code) => {
  process.exitCode = code ?? 1;
  // Test and measurement outputs pile up in .work: at most once a day, over 20 GB, the oldest
  // are deleted by the rules of scripts/clean-work.mjs (docs/tooling.md).
  if (!install) (await import('./clean-work.mjs')).autoClean(root);
});
