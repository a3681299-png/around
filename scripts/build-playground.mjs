// Builds the Playground (docs/playground-plan.md) as static files only. Separate from the
// extension: scripts/build.mjs and dist/ are not touched.
//   WW_PLAYGROUND_PRIVATE_ASSETS=<checkout> node scripts/build-playground.mjs → dist-playground/
//   WW_PLAYGROUND_OUT=.work/x node scripts/build-playground.mjs
//   WW_PLAYGROUND_TEST=1 adds the read-only test hook (window.__wwPlayground) for e2e only.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playgroundOutputProblems } from './playground/check-output.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.env.WW_PLAYGROUND_OUT ?? 'dist-playground');
const inWork = relative(join(root, '.work'), output);
if (
  output !== join(root, 'dist-playground') &&
  (inWork.startsWith('..') || inWork.includes('/') || inWork.includes('\\') || !inWork)
)
  throw new Error('WW_PLAYGROUND_OUT must be dist-playground or a direct .work child.');
const test = process.env.WW_PLAYGROUND_TEST === '1';
if (!test && !process.env.WW_PLAYGROUND_PRIVATE_ASSETS)
  throw new Error('Set WW_PLAYGROUND_PRIVATE_ASSETS to the local wwt-private-assets checkout.');

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'content'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/playground/index.ts'],
  outfile: join(output, 'app.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  minify: !test,
  logLevel: 'warning',
  loader: { '.css': 'text' },
  dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
  define: {
    __WW_PAGE_CHANGE_LEGACY__: 'false',
    __WW_WORLD_MODE__: '"runtime"',
    __WW_WORLD_DEVTOOLS__: 'false',
    __WW_ASSET_PROFILE__: 'false',
    __WW_G11__: 'false',
    __WW_PLAYGROUND_TEST__: String(test),
    // The same switch as the extension's (scripts/build.mjs): layering unless WW_LAYERING=0 (chunk 4).
    __WW_LAYERING__: String(process.env.WW_LAYERING !== '0'),
  },
});
copyFileSync(join(root, 'src/playground/index.html'), join(output, 'index.html'));
copyFileSync(join(root, 'src/playground/style.css'), join(output, 'style.css'));
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
// The notices point at the full license texts; ship them with the bundle that contains the code.
mkdirSync(join(output, 'assets/licenses'), { recursive: true });
for (const file of ['three-MIT.txt', 'three-vrm-MIT.txt', 'lottie-web-MIT.txt'])
  copyFileSync(join(root, 'assets/licenses', file), join(output, 'assets/licenses', file));

// The content generator is TypeScript that imports the repository's own fixtures; run it once.
const generator = join(root, '.work', 'playground-content.mjs');
mkdirSync(dirname(generator), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/playground/content.ts'],
  outfile: generator,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning',
});
const { writeContent } = await import(pathToFileURL(generator).href + `?${Date.now()}`);
const { models } = writeContent(root, join(output, 'content'));

const problems = playgroundOutputProblems(
  output,
  models.map((file) => `content/${file}`),
);
if (problems.length) {
  rmSync(output, { recursive: true, force: true });
  throw new Error('Playground output refused:\n' + problems.join('\n'));
}
console.log(`Playground: ${relative(root, output) || '.'} (static files only${test ? ', test hook' : ''})`);
