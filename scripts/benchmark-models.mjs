import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const work = path.resolve('.work/verification'); await mkdir(work, { recursive: true }); const file = path.join(work, 'model-benchmark-code.mjs');
await build({ stdin: { resolveDir: process.cwd(), contents: `export { evaluatePreparedWorld, initialWorldState } from './src/world/evaluate'; export { evaluateLayout } from './src/world/layout'; export { defaultFollowMotion } from './src/signals/motion'; export { defaultModelSettings } from './src/models/types'; export { inspectAsset } from './src/assets/inspect'; export { modelFixture } from './tests/helpers/model-fixture'; export { WORLD_RUNTIME_VERSION } from './src/world/types';` }, bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent' });
const m = await import(pathToFileURL(file)); const source = m.inspectAsset(m.modelFixture()).model;
const inputs = Array.from({ length: 360 }, (_, n) => ({ timeMs: n * 1000 / 60, deltaMs: n ? 1000 / 60 : 0, viewport: { width: 1920, height: 1080 }, anchors: {}, events: [], environment: { hidden: false, reducedMotion: false }, signals: { playing: true, pointer: { x: 900 + Math.sin(n / 30) * 700, y: 500 + Math.cos(n / 40) * 300 }, pointerTimeMs: n * 1000 / 60 } }));
const modelScene = { decorations: Array.from({ length: 8 }, (_, n) => ({ kind: 'model3d', id: `model-${n}`, name: 'Rig', assetId: `asset-${'0'.repeat(64)}`, source, model: { ...m.defaultModelSettings(source), locomotion: { ...m.defaultModelSettings(source).locomotion, enabled: true, idle: 0, walk: 1, run: 2 }, look: { enabled: true, bone: 3, yawLimit: 50, pitchLimit: 30, lagMs: 160 } }, opacity: 1, visible: true, locked: false, zIndex: n, placement: { anchor: { kind: 'viewport' }, x: .2 + n * .03, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 0 }, motion: m.defaultFollowMotion() })) };
const imageScene = { decorations: modelScene.decorations.map(({ model, source, ...layer }) => ({ ...layer, kind: 'image' })) };
const layouts = [imageScene, modelScene].map((s) => m.evaluateLayout(s, inputs[0])); let checksum = 0;
function run(layout, samples) { let state = m.initialWorldState(); for (const input of inputs) { const start = performance.now(), r = m.evaluatePreparedWorld(layout, state, input); samples?.push(performance.now() - start); state = r.state; checksum += r.frame.layout.layers[0].position.x; } }
for (let n = 0; n < 10; n++) layouts.forEach((l) => run(l)); const samples = [[], []];
for (let n = 0; n < 30; n++) for (const index of n % 2 ? [1, 0] : [0, 1]) run(layouts[index], samples[index]);
const stats = (values) => { const a = [...values].sort((x, y) => x - y); return { samples: a.length, medianMs: a[Math.floor(a.length / 2)], p95Ms: a[Math.floor(a.length * .95)] }; };
const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, runtimeVersion: m.WORLD_RUNTIME_VERSION, layers: 8, imagePursuit: stats(samples[0]), modelClocksPursuitLocomotionAndLook: stats(samples[1]), checksum, excludes: ['Three.js/rendering', 'GPU', 'DOM', 'asset loading/decoding', 'browser scheduling'] };
await writeFile(path.join(work, '3d-world-benchmark.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
