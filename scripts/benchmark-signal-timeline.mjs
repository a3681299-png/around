import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)), work = path.join(root, '.work/verification');
await mkdir(work, { recursive: true });
const output = path.join(work, 'signal-benchmark-code.mjs');
await build({ stdin: { resolveDir: root, contents: `
export { initialWorldState, evaluatePreparedWorld } from './src/world/evaluate';
export { evaluateLayout } from './src/world/layout';
export { WORLD_RUNTIME_VERSION } from './src/world/types';
export { createTakeSampler, parseSignalTake, projectGhosts } from './src/world/takes';
export { defaultScrollOpacityRule } from './src/signals/keyframes';
export { worldScenario } from './tests/helpers/world-scenario';
` }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
const { initialWorldState, evaluatePreparedWorld, evaluateLayout, WORLD_RUNTIME_VERSION, createTakeSampler, parseSignalTake, projectGhosts, defaultScrollOpacityRule, worldScenario } = await import(pathToFileURL(output));
const { scene, inputs } = worldScenario();
for (const layer of [...scene.decorations, ...scene.groups]) { layer.visible = true; layer.opacity = .8; }
scene.signalRules = [...scene.decorations, ...scene.groups].map(layer => defaultScrollOpacityRule(layer.id));
inputs.forEach((input, index) => { input.signals.scroll = { x: 0, y: (1 - Math.abs(index / 90 - 1)) * 10000, maxX: 0, maxY: 10000 }; });
const layouts = inputs.map(input => evaluateLayout(scene, input));
let checksum = 0;
const stats = samples => { const sorted = [...samples].sort((a, b) => a - b), round = n => Math.round(n * 1000) / 1000; return { samples: sorted.length, medianMs: round(sorted[Math.floor(sorted.length / 2)]), p95Ms: round(sorted[Math.floor(sorted.length * .95)]), meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length) }; };
const run = (rules, measured) => {
  let state = initialWorldState();
  for (let i = 0; i < inputs.length; i++) {
    const start = performance.now(), result = evaluatePreparedWorld(layouts[i], state, inputs[i], rules), elapsed = performance.now() - start;
    measured?.push(elapsed); state = result.state; checksum += result.frame.layout.layers[0].layer.opacity;
  }
};
for (let i = 0; i < 20; i++) { run([]); run(scene.signalRules); }
const baseline = [], rules = [];
for (let i = 0; i < 50; i++) { if (i % 2) { run(scene.signalRules, rules); run([], baseline); } else { run([], baseline); run(scene.signalRules, rules); } }
const take = parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: WORLD_RUNTIME_VERSION, id: 'take-benchmark', name: 'Benchmark', siteId: 'youtube', initialState: initialWorldState(),
  inputs: Array.from({ length: 3600 }, (_, i) => ({ ...inputs[i % inputs.length], timeMs: i * 50, deltaMs: i ? 50 : 0 })) });
let start = performance.now(); const sampler = createTakeSampler(scene, take); const prepareMs = performance.now() - start;
start = performance.now(); sampler.at(179950); const coldEndSeekMs = performance.now() - start;
const seeks = []; let seed = 1234;
for (let i = 0; i < 512; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; start = performance.now(); const result = sampler.at(seed / 0xffffffff * 179950); seeks.push(performance.now() - start); checksum += result.frame.layout.layers[0].layer.opacity; }
start = performance.now(); const ghosts = projectGhosts(take, scene.signalRules[0]); const projectionMs = performance.now() - start;
const report = { measuredAt: new Date().toISOString(), runtimeVersion: WORLD_RUNTIME_VERSION, node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model,
  scene: { media: 32, groups: 16, masks: 48, rules: 48 }, evaluation: { inputSteps: 180, warmupRounds: 20, measuredRounds: 50, withoutRules: stats(baseline), withRules: stats(rules) },
  seek: { samples: 3600, durationMs: 179950, jsonCharacters: JSON.stringify(take).length, prepareMs, coldEndSeekMs, warmRandom: stats(seeks), stateCheckpoints: sampler.checkpoints, cacheStride: 32 },
  projection: { ghosts: ghosts.length, timeMs: projectionMs }, checksum,
  excludes: ['DOM/style/layout/paint', 'GPU', 'media decoding', 'browser/communication scheduling', 'process memory and CPU utilization'] };
await writeFile(path.join(work, 'signal-timeline-benchmark.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
