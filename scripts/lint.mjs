import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await check(file); continue; }
    if (!/\.(css|ts)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    const label = relative(root, file).replaceAll('\\', '/');
    if (/[^\S\r\n]+$/m.test(source)) errors.push(`${label}: trailing whitespace`);
    if (/^src\/(?:themes|design|editor|world|renderers)\//.test(label) && /\b(?:ytd|ytm|yt)-[a-z]/.test(source)) {
      errors.push(`${label}: keep YouTube selectors inside the site adapter`);
    }
    if (!file.endsWith('.css')) continue;
    const result = await transform(source, { loader: 'css', sourcefile: label, logLevel: 'silent' });
    errors.push(...result.warnings.map(warning => `${label}: ${warning.text}`));
    if (label.startsWith('src/themes/') && /\b(?:ytd|ytm|yt)-[a-z]/.test(source)) {
      errors.push(`${label}: keep YouTube selectors inside the site adapter`);
    }
    if (label.startsWith('src/themes/retro/') && !label.endsWith('tokens.css') && /#[\da-f]{3,8}\b/i.test(source)) {
      errors.push(`${label}: define decoration colors in tokens.css`);
    }
  }
}
await check(join(root, 'src'));
if (errors.length) throw new Error(errors.join('\n'));
console.log('Source whitespace, CSS syntax, theme selector boundaries and color tokens checked.');
