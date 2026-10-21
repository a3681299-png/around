import { test, expect } from '@playwright/test';
import {
  createPointRegistry,
  POINT_REGISTRY,
  resolvePoint,
  legacySignalOrigin,
  type PointReference,
} from '../src/world/points';
import { evaluateLayout } from '../src/world/layout';
import { signalValue } from '../src/world/signals';
import { defaultSignalRule } from '../src/signals/keyframes';
import { worldScenario } from './helpers/world-scenario';

function context() {
  const { scene, inputs } = worldScenario(2);
  const input = { ...inputs[0]!, signals: { ...inputs[0]!.signals, pointer: { x: 140, y: 120 } } };
  return { input, scene, context: { geometry: input, signals: input.signals, layout: evaluateLayout(scene, input) } };
}
test('pointer, anchor, layer and authored fixed points resolve from each frame without changing inputs', () => {
  const { context: ctx } = context();
  const before = JSON.stringify(ctx);
  expect(resolvePoint({ kind: 'pointer' }, ctx)).toEqual({ x: 140, y: 120 });
  expect(resolvePoint({ kind: 'anchor', anchor: { kind: 'surface', target: 'video-player' } }, ctx)).toEqual({
    x: 440,
    y: 300,
  });
  expect(resolvePoint({ kind: 'anchor', anchor: { kind: 'viewport' } }, ctx)).toEqual({ x: 550, y: 380 });
  expect(resolvePoint({ kind: 'layer', layerId: 'image-0' }, ctx)).toEqual(ctx.layout.layers[0]!.position);
  expect(resolvePoint({ kind: 'fixed', position: { x: 17, y: 23 } }, ctx)).toEqual({ x: 17, y: 23 });
  const next = { ...ctx, signals: { ...ctx.signals, pointer: { x: 200, y: 400 } } };
  expect(resolvePoint({ kind: 'pointer' }, next)).toEqual({ x: 200, y: 400 });
  expect(JSON.stringify(ctx)).toBe(before);
});
test('unavailable geometry and non-finite points resolve to none, with no stale or viewport fallback', () => {
  const { context: ctx } = context();
  expect(
    resolvePoint({ kind: 'pointer' }, { ...ctx, signals: { ...ctx.signals, pointer: undefined } }),
  ).toBeUndefined();
  expect(resolvePoint({ kind: 'anchor', anchor: { kind: 'surface', target: 'missing' } }, ctx)).toBeUndefined();
  expect(resolvePoint({ kind: 'layer', layerId: 'missing' }, ctx)).toBeUndefined();
  expect(
    resolvePoint(
      { kind: 'anchor', anchor: { kind: 'viewport' } },
      { ...ctx, geometry: { ...ctx.geometry, viewport: { width: 0, height: 0 } } },
    ),
  ).toBeUndefined();
  expect(resolvePoint({ kind: 'fixed', position: { x: NaN, y: Infinity } }, ctx)).toBeUndefined();
  const anchored = context();
  anchored.scene.decorations[0]!.placement.anchor = { kind: 'surface', target: 'video-player' };
  anchored.context.layout = evaluateLayout(anchored.scene, anchored.input);
  const missing = { ...anchored.context, geometry: { ...anchored.input, anchors: {} } };
  expect(resolvePoint({ kind: 'anchor', layerId: 'image-0' }, missing)).toBeUndefined();
  expect(resolvePoint({ kind: 'layer', layerId: 'image-0' }, missing)).toBeUndefined();
});
test('legacy anchor/layer origins retain their distinct meaning, while either numeric relation can use another point', () => {
  const { context: ctx, input } = context();
  const rule = defaultSignalRule('image-0', 'opacity', {
    signal: 'pointer.distance',
    axis: 'x',
    space: 'layer',
    inputRange: [0, 1],
  });
  const layer = ctx.layout.layers[0]!;
  expect(resolvePoint(legacySignalOrigin('layer', 'image-0')!, ctx)).toEqual({
    x: layer.frame!.width * layer.layer.placement.x,
    y: layer.frame!.height * layer.layer.placement.y,
  });
  expect(resolvePoint(legacySignalOrigin('anchor', 'image-0')!, ctx)).toEqual({ x: 550, y: 380 });
  const origin = { kind: 'fixed' as const, position: { x: 240, y: 120 } };
  expect(signalValue(rule, input, ctx.layout, undefined, { origin })).toBe(100 / Math.hypot(1100, 760));
  rule.source.signal = 'pointer.angle';
  expect(signalValue(rule, input, ctx.layout, undefined, { origin })).toBe(0);
});
test('a new point needs only a single additional registry definition and derives its reference type', () => {
  const custom = createPointRegistry({
    ...POINT_REGISTRY.definitions,
    halfway: {
      resolve(reference: { first: { x: number; y: number }; second: { x: number; y: number } }) {
        return { x: (reference.first.x + reference.second.x) / 2, y: (reference.first.y + reference.second.y) / 2 };
      },
    },
  });
  const reference: PointReference<typeof custom.definitions> = {
    kind: 'halfway',
    first: { x: 10, y: 20 },
    second: { x: 30, y: 60 },
  };
  expect(custom.resolve(reference, context().context)).toEqual({ x: 20, y: 40 });
});
