import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { skillProblems } from './install-skills.mjs';
import { chromeBoundaryProblem } from './browser-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await check(file);
      continue;
    }
    if (!/\.(css|ts)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    const label = relative(root, file).replaceAll('\\', '/');
    if (/[^\S\r\n]+$/m.test(source)) errors.push(`${label}: trailing whitespace`);
    if (/^src\/(?:design|editor|world|renderers|host)\//.test(label) && /\b(?:ytd|ytm|yt)-[a-z]/.test(source)) {
      errors.push(`${label}: keep YouTube selectors inside the site adapter`);
    }
    const chrome = await chromeBoundaryProblem(label, source);
    if (chrome) errors.push(chrome);
    if (!file.endsWith('.css')) continue;
    const result = await transform(source, { loader: 'css', sourcefile: label, logLevel: 'silent' });
    errors.push(...result.warnings.map((warning) => `${label}: ${warning.text}`));
  }
}
await check(join(root, 'src'));
errors.push(...(await skillProblems()));
if (errors.length) throw new Error(errors.join('\n'));
console.log('Source whitespace, CSS syntax, site selector and browser boundaries and skill metadata checked.');
