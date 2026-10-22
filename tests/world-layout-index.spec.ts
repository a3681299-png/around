import { test, expect } from '@playwright/test';
import { evaluateLayout } from '../src/world/layout';
import { layoutEntry } from '../src/world/layout-index';
import { resolvePoint } from '../src/world/points';
import { SIGNAL_REGISTRY } from '../src/signals/registry';
import { worldScenario } from './helpers/world-scenario';

test('signal and point lookup share one index and retain original entry references', () => {
  const { scene, inputs } = worldScenario(2),
    geometry = inputs[0]!,
    layout = evaluateLayout(scene, geometry);
  let reads = 0;
  for (const entry of [...layout.groups, ...layout.layers]) {
    const id = entry.layer.id;
    Object.defineProperty(entry.layer, 'id', {
      get() {
        reads++;
        return id;
      },
    });
  }
  expect(layoutEntry(layout, 'image-0') === layout.layers[0]).toBe(true);
  const indexed = reads;
  for (let i = 0; i < 10; i++) {
    expect(layoutEntry(layout, 'group-0') === layout.groups[0]).toBe(true);
    expect(
      resolvePoint({ kind: 'layer', layerId: 'image-0' }, { geometry, layout, signals: geometry.signals }),
    ).toBeDefined();
    expect(
      SIGNAL_REGISTRY.numericValue(
        { signal: 'pointer.distance', space: 'layer', axis: 'x', inputRange: [0, 1] },
        { signals: { pointer: { x: 10, y: 20 }, playing: false }, geometry, layout, layerId: 'image-0' },
      ),
    ).toBeDefined();
  }
  expect(reads).toBe(indexed);
  expect(layoutEntry(layout, undefined)).toBeUndefined();
  expect(layoutEntry(layout, 'missing')).toBeUndefined();
});

test('a new layout never reuses stale entries or missing IDs from another layout', () => {
  const { scene, inputs } = worldScenario(2),
    first = evaluateLayout(scene, inputs[0]!);
  expect(layoutEntry(first, 'image-0')).toBe(first.layers[0]);
  expect(layoutEntry(first, 'new-image')).toBeUndefined();
  const next = evaluateLayout(
    { ...scene, groups: [], decorations: [{ ...scene.decorations[1]!, id: 'new-image' }] },
    inputs[1]!,
  );
  expect(layoutEntry(next, 'image-0')).toBeUndefined();
  expect(layoutEntry(next, 'new-image')).toBe(next.layers[0]);
  expect(layoutEntry(first, 'image-0')).toBe(first.layers[0]);
});
