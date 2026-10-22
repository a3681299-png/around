import { test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { worldScenario } from './helpers/world-scenario';
import { evaluateLayout } from '../src/world/layout';
import { evaluatePreparedWorld, initialWorldState } from '../src/world/evaluate';
import { defaultScrollOpacityRule, type SignalRule } from '../src/signals/keyframes';

test('signal lookup benchmark: 32 rules with 64 keys (informational, no threshold)', async ({}, info) => {
  const results = [];
  for (const space of ['anchor', 'layer'] as const) {
    const { scene, inputs } = worldScenario(32),
      rules: SignalRule[] = scene.decorations.map((layer, index) => ({
        ...defaultScrollOpacityRule(layer.id),
        source: {
          signal: index % 2 ? 'pointer.angle' : 'pointer.distance',
          axis: 'x',
          space,
          inputRange: index % 2 ? [-180, 180] : [0, 1],
        },
        keyframes: Array.from({ length: 64 }, (_, i) => ({
          id: `key-${i}`,
          input: i / 63,
          value: i % 2,
          easing: 'linear',
        })),
      })),
      input = { ...inputs[0]!, signals: { ...inputs[0]!.signals, pointer: { x: 300, y: 250 } } },
      layout = evaluateLayout(scene, input);
    let state = initialWorldState();
    const times = [];
    for (let i = 0; i < 3000; i++) {
      input.timeMs = i * 16;
      input.deltaMs = i ? 16 : 0;
      input.signals.pointer.x = (i * 7) % 1100;
      const start = performance.now();
      state = evaluatePreparedWorld(layout, state, input, rules).state;
      if (i >= 2000) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results.push({
      space,
      layers: 32,
      rules: 32,
      keys: 64,
      samples: times.length,
      medianMs: times[Math.floor(times.length / 2)],
      maxMs: times.at(-1),
    });
  }
  console.log('WORLD_SIGNAL_BENCHMARK ' + JSON.stringify(results));
  await info.attach('world-lookup-benchmark.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});
