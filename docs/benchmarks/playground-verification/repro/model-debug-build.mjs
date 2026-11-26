// Diagnostic only: capture the renderer's existing error report, without changing its decisions.
import { build } from 'esbuild';
import { cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
for (const side of ['before', 'after']) {
  const source = side === 'before' ? path.resolve('../playground-v1-before') : root;
  for (const kind of ['normal', 'probe', 'busy']) {
    const out = path.resolve(`.work/model-debug-${side}-${kind}`),
      target = path.join(source, 'src/renderers/three/models.ts');
    await cp(path.join(source, '.work/extension'), out, { recursive: true });
    let injected = 0;
    const plugin = {
      name: 'capture-model-error',
      setup(b) {
        b.onResolve({ filter: /^original-models$/ }, () => ({ path: target }));
        b.onResolve({ filter: /.*/ }, (a) => {
          if (
            !a.path.startsWith('.') ||
            path.resolve(a.resolveDir, a.path).replace(/\.ts$/, '') !== target.slice(0, -3)
          )
            return;
          injected++;
          return { path: 'reported', namespace: 'verification' };
        });
        b.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
          contents: `export * from 'original-models';import {createModelRenderer as original} from 'original-models';export function createModelRenderer(doc,report,...rest){return original(doc,message=>{const all=JSON.parse(doc.documentElement.getAttribute('data-verification-model-errors')||'[]');all.push(message);doc.documentElement.setAttribute('data-verification-model-errors',JSON.stringify(all));report(message);},...rest);}`,
          loader: 'js',
          resolveDir: source,
        }));
      },
    };
    const probe =
      kind === 'normal'
        ? {}
        : await (
            await import(pathToFileURL(path.join(source, 'scripts/ui1/probe-build.mjs')).href)
          ).probeBuildOptions(kind === 'busy' ? 2 : 0, kind === 'busy');
    await build({
      absWorkingDir: source,
      entryPoints: ['src/content/index.ts'],
      outfile: path.join(out, 'content/index.js'),
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      loader: { '.css': 'text' },
      dropLabels: ['AROUND_TEST_PAGE_CHANGE', 'AROUND_GUARD_TRACE'],
      define: {
        __AROUND_PAGE_CHANGE_LEGACY__: 'false',
        __AROUND_WORLD_MODE__: '"runtime"',
        __AROUND_WORLD_DEVTOOLS__: 'false',
        __AROUND_ASSET_PROFILE__: 'false',
      },
      ...probe,
      plugins: [plugin],
    });
    if (!injected) throw Error('Diagnostic not inserted');
    await writeFile(path.join(out, 'diagnostic.json'), JSON.stringify({ side, kind, source, injected }));
  }
}
console.log('Built normal, probe and 2ms diagnostic bundles for both revisions; no product files changed.');
