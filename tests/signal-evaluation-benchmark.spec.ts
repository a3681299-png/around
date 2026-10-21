import { test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { worldScenario } from './helpers/world-scenario';
import { evaluateLayout } from '../src/world/layout';
import { evaluatePreparedWorld, initialWorldState } from '../src/world/evaluate';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';

test('signal evaluation benchmark: prepared scroll-opacity worlds (informational, no threshold)', async ({}, info) => {
  const results = [];
  for (const count of [2, 32])
    for (const keys of [8, 64]) {
      const { scene, inputs } = worldScenario(count);
      const rules = scene.decorations.map((layer) => ({
        ...defaultScrollOpacityRule(layer.id),
        keyframes: Array.from({ length: keys }, (_, i) => ({
          id: `key-${i}`,
          input: i / (keys - 1),
          value: i % 2,
          easing: 'linear' as const,
        })),
      }));
      const input = { ...inputs[0]!, signals: { ...inputs[0]!.signals, scroll: { x: 0, y: 0, maxX: 0, maxY: 2000 } } };
      const layout = evaluateLayout(scene, input);
      let state = initialWorldState();
      const times = [];
      for (let i = 0; i < 1100; i++) {
        input.timeMs = i * 16;
        input.deltaMs = i ? 16 : 0;
        input.signals.scroll.y = (i % 101) * 20;
        const start = performance.now();
        state = evaluatePreparedWorld(layout, state, input, rules).state;
        if (i >= 100) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      results.push({
        layers: count,
        rules: count,
        keys,
        samples: times.length,
        medianMs: times[Math.floor(times.length / 2)],
        maxMs: times.at(-1),
      });
    }
  console.log('WORLD_SIGNAL_BENCHMARK ' + JSON.stringify(results));
  await info.attach('world-signal-benchmark.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});
