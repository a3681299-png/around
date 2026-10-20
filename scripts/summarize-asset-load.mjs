import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const bundle = await build({
  entryPoints: ['src/diagnostics/asset-profile-summary.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { summarizeAssetSpans } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const summary = {
  date: '2026-10-19',
  sourceCommit: '90926a6',
  measuredBytes: 57185776,
  reports: {},
  preliminaryObservation: {
    source:
      'Captured console aggregates from the preliminary profile run; full spans were superseded by the final run.',
    totalMs: 16138.6637,
    getQueueMs: 689.5,
    getPartQueueMs: 7020.7,
    gltfParseMs: 166,
    firstRenderMs: 1345.6,
  },
};
for (const name of ['baseline', 'profile', 'queue']) {
  const report = JSON.parse(await readFile(`.work/verification/asset-load-${name}.json`, 'utf8'));
  const conditions = Object.fromEntries(
    Object.entries(report.conditions).map(([key, runs]) => [
      key,
      runs.map(({ spans, ...run }) => ({ ...run, ...summarizeAssetSpans(spans) })),
    ]),
  );
  const iframe = report.iframe
    ? {
        ...report.iframe,
        render: report.iframe.render
          ? (({ spans, ...rest }) => ({ ...rest, ...summarizeAssetSpans(spans) }))(report.iframe.render)
          : null,
      }
    : null;
  summary.reports[name] = {
    browser: report.browser,
    profiling: report.profiling,
    conditions,
    iframe,
    youtube: report.youtube,
    notes: report.notes,
  };
}
try {
  const { render, ...probe } = JSON.parse(await readFile('.work/verification/asset-iframe-probe.json', 'utf8'));
  summary.iframeFollowup = {
    ...probe,
    render: render ? (({ spans, ...rest }) => ({ ...rest, ...summarizeAssetSpans(spans) }))(render) : null,
  };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir('docs/benchmarks', { recursive: true });
await writeFile(
  'docs/benchmarks/vrm-load-2026-10-19.json',
  JSON.stringify(
    summary,
    (key, value) => (['bytes', 'wireChars'].includes(key) && value === 0 ? undefined : value),
    2,
  ) + '\n',
);
for (const [kind, report] of Object.entries(summary.reports))
  for (const [condition, runs] of Object.entries(report.conditions))
    console.log(kind, condition, runs.map((r) => r.totalMs.toFixed(1)).join(' / ') + ' ms');
