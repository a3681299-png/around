import { transform } from 'esbuild';
import { cpuProbeBanner, cpuProbeFooter } from './cpu-probe.mjs';
import path from 'node:path';

/** Native await resumes without calling Promise.prototype.then. In measurement builds only,
 * let esbuild lower async/await to promise callbacks, so every synchronous continuation passes
 * through the same isolated-world wrapper. Suspended time is never charged as CPU. */
export async function probeBuildOptions(busyMs = 0, afterAwait = false) {
  const supported = { 'async-await': false };
  const { code } = await transform(cpuProbeBanner(busyMs, afterAwait), {
    target: 'chrome120',
    supported,
    charset: 'utf8',
    legalComments: 'none',
  });
  return { supported, banner: { js: code }, footer: { js: cpuProbeFooter } };
}

/** Diagnostic dependency injection: keep image loading/painting and remove only the optional
 * legibility pixel port. The product module is imported intact; no source text is rewritten. */
export function disableInkPlugin(source) {
  const original = path.join(source, 'src/design/renderer.ts');
  return {
    name: 'ui1-diagnostic-disable-ink',
    setup(build) {
      build.onResolve({ filter: /^ui1-original-renderer$/ }, () => ({ path: original }));
      build.onResolve({ filter: /(?:^|\/)design\/renderer(?:\.ts)?$/ }, (args) => {
        if (path.resolve(args.resolveDir, args.path).replace(/\.ts$/, '') !== original.slice(0, -3)) return;
        return { path: 'disabled-ink-port', namespace: 'ui1-diagnostic' };
      });
      build.onLoad({ filter: /.*/, namespace: 'ui1-diagnostic' }, () => ({
        contents: `
          export * from 'ui1-original-renderer';
          import { createDesignRenderer as original } from 'ui1-original-renderer';
          export function createDesignRenderer(doc, targets, assets, onStatus) {
            return original(doc, targets, assets ? { ...assets, pixels: undefined } : assets, onStatus);
          }`,
        loader: 'js',
      }));
    },
  };
}
