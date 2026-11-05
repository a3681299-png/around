import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Explicit development build: retain the original guard and expose its last published snapshot.
 * No source text rewriting and no additional observer; shipping builds never import this module. */
export async function ui0dOperationProbeBuild(native: string, output: string) {
  const relative = path.relative(path.resolve('.work'), output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Probe output must stay in .work');
  await mkdir(output, { recursive: true });
  await cp(native, output, { recursive: true });
  const original = path.resolve('src/host/operation-guard.ts');
  await build({
    entryPoints: ['src/content/index.ts'],
    bundle: true,
    outfile: path.join(output, 'content/index.js'),
    format: 'iife',
    target: 'chrome120',
    charset: 'utf8',
    legalComments: 'none',
    loader: { '.css': 'text' },
    dropLabels: ['WW_TEST_PAGE_CHANGE', 'WW_GUARD_TRACE'],
    define: {
      __WW_WORLD_MODE__: '"runtime"',
      __WW_WORLD_DEVTOOLS__: 'false',
      __WW_ASSET_PROFILE__: 'false',
      __WW_G11__: 'false',
    },
    plugins: [
      {
        name: 'ui0d-operation-snapshot',
        setup(builder) {
          builder.onResolve({ filter: /^ui0d-original-guard$/ }, () => ({ path: original }));
          builder.onResolve({ filter: /(?:^|\/)operation-guard(?:\.ts)?$/ }, (args) => {
            if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== original.slice(0, -3)) return;
            return { path: 'ui0d-guard', namespace: 'ui0d-probe' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'ui0d-probe' }, () => ({
            loader: 'js',
            contents: `
        export * from 'ui0d-original-guard';
        import {createOperationGuardHost as original} from 'ui0d-original-guard';
        export function createOperationGuardHost(...args){
          const host=original(...args); globalThis.__ui0dGuard=host; return host;
        }`,
          }));
        },
      },
    ],
  });
}
