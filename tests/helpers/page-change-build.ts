import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

/** Test-only counters; neither the shipping bundle nor artwork can enable these. */
export async function pageChangeBundle(ref?: string) {
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
            if (file === 'src/design/renderer.ts')
              inject(
                'export function compileDesign(input: DesignDocument, targets: readonly DesignTarget[]): string {',
                'compiles',
              );
            if (file === 'src/features/controller.ts') inject('    refresh() {', 'featureRefreshes');
            return { contents, loader: path.endsWith('.css') ? 'text' : 'ts' };
          });
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}
