import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)),
  work = path.join(root, '.work/verification');
await mkdir(work, { recursive: true });
const output = path.join(work, 'world-benchmark-code.mjs');
await build({
  stdin: {
    resolveDir: root,
    contents: `
export { evaluateWorld, initialWorldState } from './src/world/evaluate';
export { legacyWorld } from './src/renderers/dom/legacy-evaluation';
export { assertWorldParity } from './src/renderers/dom/parity';
export { worldScenario } from './tests/helpers/world-scenario';
export { WORLD_RUNTIME_VERSION } from './src/world/types';
`,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
  logLevel: 'silent',
});
const { evaluateWorld, initialWorldState, legacyWorld, assertWorldParity, worldScenario, WORLD_RUNTIME_VERSION } =
  await import(pathToFileURL(output));
const rounds = 50,
  warmup = 20;
let checksum = 0;
const workloads = [];
for (const label of ['mixed-visibility', 'all-visible']) {
  const { scene, inputs } = worldScenario();
  if (label === 'all-visible') {
    scene.decorations.forEach((layer) => {
      layer.visible = true;
      layer.opacity = 0.8;
    });
    scene.groups.forEach((group) => {
      group.visible = true;
      group.opacity = 0.7;
    });
  }
  let a = initialWorldState(),
    b = initialWorldState();
  for (const input of inputs) {
    const actual = evaluateWorld(scene, a, input),
      expected = legacyWorld(scene, b, input);
    assertWorldParity(actual, expected, 'benchmark');
    a = actual.state;
    b = expected.state;
  }
  const run = (evaluate, samples) => {
    let state = initialWorldState();
    for (const input of inputs) {
      const start = performance.now(),
        result = evaluate(scene, state, input),
        end = performance.now();
      if (samples) samples.push((end - start) * 1000);
      state = result.state;
      checksum += result.frame.effects[1]?.mask?.intensity ?? 0;
    }
  };
  for (let i = 0; i < warmup; i++) {
    run(legacyWorld);
    run(evaluateWorld);
  }
  const old = [],
    current = [];
  for (let i = 0; i < rounds; i++) {
    if (i % 2) {
      run(evaluateWorld, current);
      run(legacyWorld, old);
    } else {
      run(legacyWorld, old);
      run(evaluateWorld, current);
    }
  }
  const stats = (samples) => {
    samples.sort((a, b) => a - b);
    const round = (value) => Math.round(value * 1000) / 1000;
    return {
      samples: samples.length,
      medianUs: round(samples[Math.floor(samples.length / 2)]),
      p95Us: round(samples[Math.floor(samples.length * 0.95)]),
      meanUs: round(samples.reduce((a, b) => a + b, 0) / samples.length),
    };
  };
  const legacy = stats(old),
    runtime = stats(current);
  workloads.push({
    label,
    media: 32,
    groups: 16,
    inputSteps: inputs.length,
    warmupRounds: warmup,
    measuredRounds: rounds,
    legacy,
    runtime,
    medianRatio: Math.round((runtime.medianUs / legacy.medianUs) * 1000) / 1000,
  });
}
const report = {
  measuredAt: new Date().toISOString(),
  runtimeVersion: WORLD_RUNTIME_VERSION,
  node: process.version,
  platform: `${platform()} ${arch()}`,
  cpu: cpus()[0]?.model,
  baseline:
    '1d23ec0 draw/paint numeric reference with equivalent returned data; shared unchanged geometry and mask primitives',
  excludes: ['DOM/layout/style application', 'decoding', 'GPU', 'browser scheduling'],
  workloads,
  checksum,
};
await writeFile(path.join(work, 'world-benchmark.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
