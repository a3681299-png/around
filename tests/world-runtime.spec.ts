import { test, expect } from '@playwright/test';
import { evaluatePreparedWorld, evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { evaluateLayout } from '../src/world/layout';
import { legacyLayout, legacyWorld } from '../src/renderers/dom/legacy-evaluation';
import { assertWorldParity } from '../src/renderers/dom/parity';
import { worldScenario } from './helpers/world-scenario';
import { createHistory } from '../src/editor/history';
import { parseDesign } from '../src/design/schema';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('32 media / 16 groups match legacy layout and masks across anchors, lifecycle and signals', () => {
  const { scene, inputs } = freeze(worldScenario());
  let current = initialWorldState(),
    legacy = initialWorldState();
  for (const input of inputs) {
    expect(evaluateLayout(scene, input)).toEqual(legacyLayout(scene, input));
    const actual = evaluateWorld(scene, freeze(current), input),
      expected = legacyWorld(scene, legacy, input);
    expect(actual).toEqual(expected);
    assertWorldParity(actual, expected, 'test');
    current = actual.state;
    legacy = expected.state;
  }
});

test('reused layout produces the same frames and recordings; geometry changes invalidate preparation', () => {
  const { scene, inputs } = freeze(worldScenario());
  let state = initialWorldState(),
    prepared = evaluateLayout(scene, inputs[0]!),
    signature = '';
  for (const input of inputs) {
    const key = JSON.stringify({ viewport: input.viewport, anchors: input.anchors });
    if (key !== signature) {
      prepared = freeze(evaluateLayout(scene, input));
      signature = key;
    }
    const expected = evaluateWorld(scene, state, input),
      result = evaluatePreparedWorld(prepared, freeze(state), input);
    expect(result).toEqual(expected);
    state = result.state;
  }
});

test('identical initial state and timestamped inputs produce identical JSON and do not alter history', () => {
  const { scene, inputs } = freeze(worldScenario(6));
  const design = parseDesign({
    schemaVersion: 6,
    id: 'test',
    siteId: 'youtube',
    baseThemeId: null,
    rules: [],
    ...scene,
  });
  const history = createHistory(parseDesign, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const before = JSON.stringify(design);
  const run = () => {
    let state = initialWorldState();
    return inputs.map((input) => {
      const result = evaluateWorld(design, state, input);
      state = result.state;
      return result;
    });
  };
  expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  expect(JSON.stringify(design)).toBe(before);
  expect(history.canUndo).toBe(false);
  expect(history.values()).toEqual([]);
});

test('missing anchors, hidden groups, zero opacity and deleted IDs release their evaluation state', () => {
  const { scene, inputs } = worldScenario(4);
  const first = evaluateWorld(scene, initialWorldState(), inputs[0]!);
  const missing = evaluateWorld(scene, first.state, { ...inputs[1]!, anchors: {} });
  expect(
    missing.frame.layout.layers
      .filter((layer) => layer.layer.placement.anchor.kind === 'surface')
      .every((layer) => !layer.visible && !layer.renderable),
  ).toBe(true);
  const empty = evaluateWorld({ decorations: [] }, missing.state, inputs[2]!);
  expect(empty.state.effects).toEqual({ fades: {}, visibility: {} });
  expect(empty.frame.needsFrame).toBe(false);
  expect(empty.frame.subscriptions).toEqual({ pointer: false, video: false });
});

test('pause/resume fade is continuous, consumes events once, and lifecycle resets are replayable inputs', () => {
  const { scene, inputs } = worldScenario(4),
    input = inputs[0]!;
  scene.groups![1]!.effects![0]!.bindings = [scene.groups![1]!.effects![0]!.bindings[1]!];
  let result = evaluateWorld(scene, initialWorldState(), input);
  result = evaluateWorld(scene, result.state, {
    ...input,
    timeMs: 100,
    deltaMs: 100,
    signals: { pointer: undefined, playing: false },
    events: [{ type: 'video.pause' }],
  });
  result = evaluateWorld(scene, result.state, {
    ...input,
    timeMs: 275,
    deltaMs: 175,
    signals: { pointer: undefined, playing: false },
    events: [],
  });
  expect(result.frame.effects.find((effect) => effect.id === 'group-1')!.mask!.intensity).toBeCloseTo(0.5);
  expect(result.frame.layout.groups[1]!.layer.opacity).toBe(0.7);
  expect(result.frame.machine.events).toEqual([]);
  expect(result.frame.machine.video).toBe('paused');
  const reset = evaluateWorld(scene, result.state, {
    ...input,
    timeMs: 280,
    deltaMs: 5,
    signals: { pointer: undefined, playing: false },
    events: [{ type: 'host.lifecycle' }],
  });
  expect(reset.frame.effects.find((effect) => effect.id === 'group-1')!.mask!.intensity).toBe(0);
  expect(reset.frame.needsFrame).toBe(false);
});

test('runtime rejects a different version or invalid/backwards time, and compare detects drift', () => {
  const { scene, inputs } = worldScenario(4),
    input = inputs[0]!;
  expect(() => evaluateWorld(scene, { ...initialWorldState(), runtimeVersion: 'future' as never }, input)).toThrow(
    /version/,
  );
  for (const timeMs of [-1, NaN, Infinity])
    expect(() => evaluateWorld(scene, initialWorldState(), { ...input, timeMs })).toThrow(/time/);
  expect(() => evaluateWorld(scene, { ...initialWorldState(), timeMs: 5 }, input)).toThrow(/time/);
  expect(() => assertWorldParity({ opacity: 1 }, { opacity: 0.9 }, 'test')).toThrow(/parity mismatch/);
});
