import { test, expect } from '@playwright/test';
import { createSignalRegistry, SIGNAL_REGISTRY, scrollProgress, type NumericSignalIds } from '../src/signals/registry';
import { parseSignalSource } from '../src/signals/keyframe-schema';
import { SIGNAL_PRESETS } from '../src/signals/presets';
import { parseWorldInput } from '../src/world/recording';
import { signalValue } from '../src/world/signals';
import { sampleKeyframes } from '../src/world/keyframes';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { worldScenario } from './helpers/world-scenario';

test('one numeric registry entry supplies its type, source validation, catalog, evaluation and subscriptions', () => {
  // The only new definition. A host would put its acquired number in samples.
  const registry = createSignalRegistry({
    ...SIGNAL_REGISTRY.definitions,
    'test.level': {
      category: 'value',
      valueType: 'number',
      spaces: ['viewport'],
      axes: ['x'],
      subscriptions: ['scroll'],
      hostSample: true,
      historyDependent: true,
      evaluate: ({ signals }) => {
        const value = signals.samples?.['test.level'];
        return typeof value === 'number' ? value * 2 : undefined;
      },
      needsFrame: ({ signals }) => signals.samples?.['test.level'] === 0.25,
      preview: (value, context) => ({ signals: { ...context.signals, samples: { 'test.level': value / 2 } } }),
      presets: [
        {
          id: 'test-level',
          label: '仮シグナル',
          order: 10,
          unit: '%',
          space: 'viewport',
          axis: 'x',
          inputRange: [0, 1],
        },
      ],
    },
  });
  const id: NumericSignalIds<typeof registry.definitions> = 'test.level';
  const source = parseSignalSource({ signal: id, space: 'viewport', axis: 'x', inputRange: [0, 1] }, registry);
  const input = parseWorldInput(
    { ...worldScenario(2).inputs[0]!, signals: { playing: false, samples: { [id]: 0.25 } } },
    { registry },
  );
  const rule = { ...defaultScrollOpacityRule('image-0'), source };
  expect(signalValue(rule, input, undefined, undefined, { registry })).toBe(0.5);
  expect(sampleKeyframes(rule.keyframes, registry.numericValue(source, { signals: input.signals })!)).toBe(1);
  expect(registry.catalog[id]).toEqual({ category: 'value', valueType: 'number' });
  expect(registry.presets.at(-1)?.source).toEqual(source);
  expect(registry.subscriptions([id])).toEqual({ pointer: false, scroll: true, video: false });
  expect(registry.needsFrame(id, { signals: input.signals })).toBe(true);
  expect(registry.definition(id)?.historyDependent).toBe(true);
  const preview = registry.numericPreview(source, 0.8, { signals: input.signals });
  expect(registry.numericValue(source, { signals: preview.signals })).toBe(0.8);
  expect(
    signalValue(rule, { ...input, signals: { playing: false, pointer: undefined } }, undefined, undefined, {
      registry,
    }),
  ).toBeUndefined();
  expect(() => parseSignalSource({ ...source, axis: 'y' }, registry)).toThrow();
  expect(() => parseSignalSource({ ...source, space: 'anchor' }, registry)).toThrow();
  // The application registry has not acquired this test-only capability.
  expect(() => parseSignalSource(source)).toThrow();
  expect(() => parseWorldInput(input)).toThrow();
});

test('numeric sources use registry coordinate/type metadata and keep bounded, strict ranges', () => {
  const source = { signal: 'pointer.distance', space: 'layer', axis: 'y', inputRange: [0, 1] };
  expect(parseSignalSource(source)).toEqual(source);
  for (const patch of [
    { signal: 'pointer.position' },
    { signal: 'video.playing' },
    { signal: 'video.play' },
    { signal: 'unknown' },
    { signal: ['pointer.distance'] },
    { space: ['layer'] },
    { axis: ['y'] },
    { extra: true },
    { inputRange: [NaN, 1] },
    { inputRange: [0, Infinity] },
    { inputRange: [-1e6 - 1, 1] },
    { inputRange: [1, 1] },
    { inputRange: ['0', 1] },
  ])
    expect(() => parseSignalSource({ ...source, ...patch })).toThrow();
  expect(() => parseSignalSource({ ...source, signal: 'page.scroll.progress' })).toThrow();
  expect(() => parseSignalSource({ ...source, signal: 'pointer.x' })).toThrow();
  expect(SIGNAL_REGISTRY.subscriptions(['pointer.angle', 'page.scroll.progress', 'video.pause'])).toEqual({
    pointer: true,
    scroll: true,
    video: true,
  });
});

test('host samples reject unknown IDs, wrong types, non-finite and excessive values and are copied', () => {
  const registry = createSignalRegistry({
    n: {
      category: 'value',
      valueType: 'number',
      spaces: [],
      axes: [],
      subscriptions: [],
      hostSample: true,
      evaluate: () => 0,
    },
    p: {
      category: 'value',
      valueType: 'point',
      spaces: [],
      axes: [],
      subscriptions: [],
      hostSample: true,
      evaluate: () => undefined,
    },
    b: {
      category: 'state',
      valueType: 'boolean',
      spaces: [],
      axes: [],
      subscriptions: [],
      hostSample: true,
      evaluate: () => false,
    },
  });
  const input = { n: 10, p: { x: 2, y: 3 }, b: true };
  const result = registry.parseSamples(input);
  input.p.x = 99;
  expect(result).toEqual({ n: 10, p: { x: 2, y: 3 }, b: true });
  for (const value of [
    null,
    [],
    { unknown: 1 },
    { n: NaN },
    { n: Infinity },
    { n: 1e9 + 1 },
    { n: '1' },
    { b: 1 },
    { p: { x: 0 } },
    { p: { x: 0, y: 1, z: 2 } },
    { p: { x: 1e7 + 1, y: 0 } },
  ])
    expect(() => registry.parseSamples(value)).toThrow();
  expect(() => SIGNAL_REGISTRY.parseSamples({ 'pointer.x': 0.5 })).toThrow();
});

test('scroll progress has one finite, clamped calculation for both direct and rule evaluation', () => {
  const source = defaultScrollOpacityRule('image-0').source;
  for (const [y, maxY, expected] of [
    [-1, 100, 0],
    [0, 0, 0],
    [50, 100, 0.5],
    [101, 100, 1],
    [NaN, 100, 0],
    [1, Infinity, 0],
  ]) {
    const signals = { playing: false, pointer: undefined, scroll: { x: 0, y: y!, maxX: 0, maxY: maxY! } };
    expect(scrollProgress(signals)).toBe(expected);
    expect(SIGNAL_REGISTRY.numericValue(source, { signals })).toBe(expected);
  }
});

test('registry keeps existing preset order, values, state and event evaluations', () => {
  expect(SIGNAL_PRESETS.map((preset) => preset.id)).toEqual([
    'scroll',
    'mouse-x',
    'mouse-y',
    'anchor-x',
    'anchor-y',
    'layer-distance',
    'anchor-distance',
    'layer-angle',
    'anchor-angle',
    'mouse-speed',
  ]);
  for (const preset of SIGNAL_PRESETS) expect(parseSignalSource(preset.source)).toEqual(preset.source);
  const context = {
    signals: { playing: true, pointer: { x: 2, y: 4 } },
    events: [{ type: 'video.play' as const }, { type: 'video.pause' as const }],
  };
  expect(SIGNAL_REGISTRY.evaluate('pointer.position', context)).toEqual({ x: 2, y: 4 });
  expect(SIGNAL_REGISTRY.evaluate('video.playing', context)).toBe(true);
  expect(SIGNAL_REGISTRY.evaluate('video.play', context)).toEqual([{ type: 'video.play' }]);
  expect(SIGNAL_REGISTRY.evaluate('video.ended', context)).toEqual([]);
});
