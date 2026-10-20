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
for (const name of ['resident', 'binary', 'cache', 'gpu', 'scenarios', 'quality', 'hardware']) { try { result[name] = await read('.work/verification/asset-runtime-' + name + '.json'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
const metric = (rows, field, unit = 'ms') => { const a = rows.map((r) => typeof field === 'function' ? field(r) : r[field]).filter(Number.isFinite), s = statistics(a); return { count: s.count, unit, median: s.medianMs, min: a.length ? Math.min(...a) : null, max: s.worstMs, p95: s.p95Ms }; };
result.summaries = {};
if (result.resident) result.summaries.resident = { display: metric(result.resident.resident, 'endToEndMs'), reconnect: metric(result.resident.reconnect, 'reconnectMs') };
if (result.binary) result.summaries.savedSourceRoutes = Object.fromEntries(Object.entries(result.binary.modes).map(([name, rows]) => [name, { display: metric(rows, 'endToEndMs'), fetch: metric(rows, name === 'resident' ? 'sourceMs' : 'assetFetchMs') }]));
if (result.cache) result.summaries.cache = { duplicate3: metric(result.cache.duplicate3, 'endToEndMs'), readd: metric(result.cache.cycles, 'displayMs'), mixedDisplay: metric(result.cache.mixed, 'endToEndMs'), mixedSteadyFps: metric(result.cache.mixed, 'averageModelFps', 'fps'), mixedCpuP95: metric(result.cache.mixed, (r) => r.steadyStats.p95CpuMs) };
if (result.scenarios) result.summaries.scenarios = { reload: metric(result.scenarios.reload, 'reloadAndDisplayMs'), concurrentMaintenanceDisplay: metric(result.scenarios.maintenance, 'endToEndMs'), maintenance: metric(result.scenarios.maintenance, 'maintenanceMs'), sequential3: metric(result.scenarios.sequential, 'totalMs') };
if (result.gpu) result.summaries.gpu = Object.fromEntries(Object.entries(result.gpu.conditions).map(([mode, rows]) => [mode, Object.fromEntries([1, 2].map((session) => { const selected = rows.filter((r) => r.browserSession === session); return [session, { total: metric(selected, 'totalMs'), compileApi: metric(selected, (r) => r.stats.preparation?.compileAsyncMs), explicitTextureCpu: metric(selected, (r) => r.stats.preparation?.textureInitCpuMs), explicitTextureGpu: metric(selected, (r) => r.stats.preparation?.textureGpuElapsedMs), firstRender: metric(selected, (r) => r.stages['extension:first.webgl-render-inclusive']), firstRenderShaderApiCpu: metric(selected, (r) => Object.entries(r.stats.firstRenderApi ?? {}).filter(([k]) => /compileShader|linkProgram|getProgramParameter|getShaderParameter|getProgramInfoLog|getShaderInfoLog|useProgram|getActiveUniform|getUniformLocation|getAttribLocation/.test(k)).reduce((n, [, c]) => n + c.cpuMs, 0)), firstRenderTextureApiCpu: metric(selected, (r) => Object.entries(r.stats.firstRenderApi ?? {}).filter(([k]) => /texStorage|texImage|texSubImage|generateMipmap/.test(k)).reduce((n, [, c]) => n + c.cpuMs, 0)) }]; }))]));
if (result.quality) result.summaries.quality = Object.fromEntries(Object.entries({ idle: result.quality.idle, ...result.quality.modes, mixed: result.quality.mixed ?? [] }).map(([name, rows]) => [name, { dropped: metric(rows, 'droppedFramesDelta', 'frames'), decoded: metric(rows, 'totalFramesDelta', 'frames'), elapsed: metric(rows, 'elapsedMs'), droppedFraction: metric(rows, (r) => r.droppedFramesDelta / r.totalFramesDelta, 'ratio') }]));
result.stageCommits = { production: '16a3e35', resident: '1e2bf44', binary: '82c8d23', sharedCache: '675174c' };
await mkdir(new URL('docs/benchmarks/', root), { recursive: true });
await writeFile(new URL('docs/benchmarks/asset-runtime-2026-10-20.json', root), JSON.stringify(result, null, 2) + '\n');
console.log('docs/benchmarks/asset-runtime-2026-10-20.json');
