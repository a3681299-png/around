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
  },
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
