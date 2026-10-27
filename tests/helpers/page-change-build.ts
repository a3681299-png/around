import { build } from 'esbuild';

/** Test-only counters; neither the shipping bundle nor artwork can enable these. */
export async function pageChangeBundle(legacyPage = false) {
  const result = await build({
    entryPoints: ['tests/helpers/page-change-runtime.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PageChangeTest',
    target: 'chrome120',
    loader: { '.css': 'text' },
    // Keeping the development label explicitly enables counters and the comparison route.
    dropLabels: [],
    define: { __WW_PAGE_CHANGE_LEGACY__: String(legacyPage) },
  });
  return result.outputFiles[0]!.text;
}
