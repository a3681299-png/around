import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const statistics = (values) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return { count: v.length, medianMs: v.length ? v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 : null, worstMs: v.at(-1) ?? null, p95Ms: v[Math.ceil(v.length * .95) - 1] ?? null }; };
const sum = (spans, regex) => spans.filter((s) => regex.test(s.name)).reduce((n, s) => n + s.durationMs, 0);
const summarize = (r) => {
  const spans = (r.spans ?? []).filter((s) => !r.trace || s.id === r.trace);
  return { run: r.run, cache: r.cache, totalMs: r.totalMs, endToEndMs: r.endToEndMs, assetFetchMs: r.assetFetchMs, alphaPixels: r.alphaPixels,
    taskCpuMs: r.taskCpuMs, scriptCpuMs: r.scriptCpuMs, jsHeapAfter: r.jsHeapAfter, stats: r.stats, messages: r.messages, binaryBytes: r.binaryBytes, smallBytes: r.smallBytes,
    stages: Object.fromEntries([...new Set(spans.map((s) => s.context + ':' + s.name))].sort().map((key) => [key, { ms: spans.filter((s) => s.context + ':' + s.name === key).reduce((n, s) => n + s.durationMs, 0), count: spans.filter((s) => s.context + ':' + s.name === key).length }])),
    bulkRpcCount: spans.filter((s) => /^rpc\.(upload-start|upload-part|upload-finish|get|get-part)$/.test(s.name)).length,
    payloadRpcCount: spans.filter((s) => /^rpc\.(upload-part|get-part)$/.test(s.name)).length,
    base64PayloadChars: spans.filter((s) => /^rpc\.(upload-part|get-part)$/.test(s.name)).reduce((n, s) => n + (s.wireChars ?? 0), 0),
    waitMs: sum(spans, /^queue\./), serviceMs: sum(spans, /^service\./) };
};
const reports = {};
for (const name of ['before', 'after']) {
  const r = await read('.work/verification/asset-load-runtime-' + name + '.json');
  reports[name] = { browser: r.browser, conditions: Object.fromEntries(Object.entries(r.conditions).map(([key, runs]) => [key, { summary: statistics(runs.map((r) => r.totalMs)), cold: statistics(runs.slice(0, 1).map((r) => r.totalMs)), warm: statistics(runs.slice(1).map((r) => r.totalMs)), runs: runs.map(summarize) }])) };
}
const old = (await read('.work/verification/asset-load-profile.json')).conditions.A_real_youtube[0];
const major = ['import.file-to-stored', 'renderer.source-load', 'renderer.blob-read', 'renderer.inspect', 'parse.gltf-inclusive', 'parse.vrm-postprocess', 'renderer.bounds', 'first.presentation-proxy-inclusive'];
const ledger = major.map((name) => ({ name, durationMs: old.spans.find((s) => s.name === name).durationMs }));
const result = { date: '2026-10-20', baseCommit: 'bd29d00', evaluatedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), bytes: 57185776, actualVrmVersion: '0.x',
  statistics: 'nearest-rank p95; with five observations p95 equals maximum. First process is not an OS/driver cache flush.', reports,
  historical8276ms: { totalMs: old.totalMs, nonOverlappingMajorDurations: ledger, accountedMs: ledger.reduce((n, v) => n + v.durationMs, 0), residualMs: old.totalMs - ledger.reduce((n, v) => n + v.durationMs, 0), residualExplanation: 'Historical trace cannot attribute remaining test polling/UI/scheduling gaps exactly. Never subtract clocks from different contexts or add nested texture/parse spans twice.' } };
for (const name of ['resident', 'binary', 'cache', 'gpu', 'scenarios']) { try { result[name] = await read('.work/verification/asset-runtime-' + name + '.json'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
await mkdir(new URL('docs/benchmarks/', root), { recursive: true });
await writeFile(new URL('docs/benchmarks/asset-runtime-2026-10-20.json', root), JSON.stringify(result, null, 2) + '\n');
console.log('docs/benchmarks/asset-runtime-2026-10-20.json');
