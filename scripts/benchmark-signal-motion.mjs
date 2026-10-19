import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)), work = path.join(root, '.work/verification');
await mkdir(work, { recursive: true }); const file = path.join(work, 'motion-benchmark-code.mjs');
await build({ stdin: { resolveDir: root, contents: `
export { initialWorldState, evaluatePreparedWorld } from './src/world/evaluate';
export { evaluateLayout } from './src/world/layout';
export { WORLD_RUNTIME_VERSION } from './src/world/types';
export { createTakeSampler, parseSignalTake } from './src/world/takes';
export { defaultScrollOpacityRule, defaultSignalRule } from './src/signals/keyframes';
export { defaultFollowMotion } from './src/signals/motion';
export { worldScenario } from './tests/helpers/world-scenario';
` }, bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent' });
const { initialWorldState, evaluatePreparedWorld, evaluateLayout, WORLD_RUNTIME_VERSION, createTakeSampler, parseSignalTake, defaultScrollOpacityRule, defaultSignalRule, defaultFollowMotion, worldScenario } = await import(pathToFileURL(file));
const { scene, inputs: original } = worldScenario();
for (const layer of [...scene.decorations, ...scene.groups]) { layer.visible = true; layer.opacity = .8; }
const inputs = Array.from({ length: 360 }, (_, i) => ({ ...original[i % original.length], timeMs: i * 1000 / 60, deltaMs: i ? 1000 / 60 : 0, environment: { hidden: false, reducedMotion: false }, signals: { playing: true, pointer: { x: 700 + Math.sin(i / 40) * 500, y: 400 + Math.cos(i / 30) * 200 }, pointerTimeMs: i * 1000 / 60, scroll: { x: 0, y: i / 359 * 10000, maxX: 0, maxY: 10000 } } }));
const scrollRules = [...scene.decorations, ...scene.groups].map((layer) => defaultScrollOpacityRule(layer.id));
const motionScene = structuredClone(scene);
for (const layer of [...motionScene.decorations, ...motionScene.groups]) layer.motion = defaultFollowMotion();
motionScene.signalRules = [...motionScene.decorations, ...motionScene.groups].map((layer) => defaultSignalRule(layer.id, 'position.x', { signal: 'pointer.x', axis: 'x', space: 'viewport', inputRange: [0, 1] }));
const baseLayouts = inputs.map((input) => evaluateLayout(scene, input)), motionLayouts = inputs.map((input) => evaluateLayout(motionScene, input));
let checksum = 0;
const run = (layouts, rules, samples) => { let state = initialWorldState(); for (let i = 0; i < inputs.length; i++) { const start = performance.now(), result = evaluatePreparedWorld(layouts[i], state, inputs[i], rules); samples?.push(performance.now() - start); state = result.state; checksum += result.frame.layout.layers[0].position.x; } };
for (let i = 0; i < 10; i++) { run(baseLayouts, scrollRules); run(motionLayouts, motionScene.signalRules); }
const base = [], motion = [];
for (let i = 0; i < 30; i++) { if (i % 2) { run(motionLayouts, motionScene.signalRules, motion); run(baseLayouts, scrollRules, base); } else { run(baseLayouts, scrollRules, base); run(motionLayouts, motionScene.signalRules, motion); } }
const stats = (samples) => { const a = [...samples].sort((x, y) => x - y), round = (x) => Math.round(x * 1000) / 1000; return { samples: a.length, medianMs: round(a[Math.floor(a.length / 2)]), p95Ms: round(a[Math.floor(a.length * .95)]), meanMs: round(a.reduce((x, y) => x + y, 0) / a.length) }; };
const take = parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: WORLD_RUNTIME_VERSION, id: 'take-motion-benchmark', name: 'Motion', siteId: 'youtube', initialState: initialWorldState(), inputs: Array.from({ length: 3600 }, (_, i) => ({ ...inputs[i % inputs.length], timeMs: i * 1000 / 60, deltaMs: i ? 1000 / 60 : 0, signals: { ...inputs[i % inputs.length].signals, pointerTimeMs: i * 1000 / 60 } })) });
const heapBefore = process.memoryUsage().heapUsed;
let start = performance.now(); const sampler = createTakeSampler(motionScene, take); const prepareMs = performance.now() - start;
start = performance.now(); sampler.at(59983.333333333336); const coldEndSeekMs = performance.now() - start;
const seeks = []; let seed = 1234;
for (let i = 0; i < 256; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; start = performance.now(); checksum += sampler.at(seed / 0xffffffff * 59983).frame.layout.layers[0].position.x; seeks.push(performance.now() - start); }
const report = { measuredAt: new Date().toISOString(), runtimeVersion: WORLD_RUNTIME_VERSION, node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model,
  scene: { media: 32, groups: 16, masks: 48, rules: 48, motionControllers: 48 }, evaluation: { sourceInputs: 360, warmupRounds: 10, measuredRounds: 30, existingScroll: stats(base), pointerKeysAndPursuit: stats(motion) },
  seek: { samples: 3600, durationMs: 59983.333333333336, jsonCharacters: JSON.stringify(take).length, prepareMs, coldEndSeekMs, random: stats(seeks), checkpoints: sampler.checkpoints, heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, heapNote: 'Uncollected JS heap delta; not retained size, peak memory or browser memory.' }, checksum,
  excludes: ['DOM/style/layout/paint', 'GPU', 'media decoding', 'browser scheduling', 'process CPU utilization and peak memory'] };
await writeFile(path.join(work, 'signal-motion-benchmark.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
