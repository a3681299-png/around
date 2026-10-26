import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

/** Test-only counters; neither the shipping bundle nor artwork can enable these. */
export async function pageChangeBundle(ref?: string, legacyPage = false) {
  const result = await build({
    entryPoints: ['tests/helpers/page-change-runtime.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PageChangeTest',
    target: 'chrome120',
    loader: { '.css': 'text' },
    plugins: [
      {
        name: 'page-change-measurement',
        setup(builder) {
          builder.onLoad({ filter: /[\\/]src[\\/].*\.(ts|css)$/ }, async ({ path }) => {
            const file = relative(process.cwd(), path).replaceAll('\\', '/');
            let contents = ref
              ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' })
              : await readFile(path, 'utf8');
            const meter = (field: string) => `if (globalThis.__pageChanges) globalThis.__pageChanges.${field}++;`;
            const inject = (needle: string, field: string) => {
              if (contents.split(needle).length !== 2) throw new Error(`Measurement hook changed: ${file}`);
              contents = contents.replace(needle, needle + meter(field));
            };
            // The first line of compileDesign, identical before and after v13 added its options.
            if (file === 'src/design/renderer.ts') inject('  const design = readDesign(input);', 'compiles');
            if (file === 'src/features/controller.ts') inject('    refresh() {', 'featureRefreshes');
            if (legacyPage && file === 'src/themes/controller.ts') {
              const needle = 'site.connect(followPage)';
              if (!contents.includes(needle)) throw new Error('Legacy full-render route must be updated');
              contents = contents.replace(needle, 'site.connect(render)');
            }
            return { contents, loader: path.endsWith('.css') ? 'text' : 'ts' };
          });
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}
