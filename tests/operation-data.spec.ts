import { test, expect } from '@playwright/test';
import {
  guardPaint,
  initialProximity,
  stepProximity,
  type OperationSnapshot,
  type OperationSurface,
  type PaintFootprint,
} from '../src/world/operations';
import { SIGNAL_REGISTRY } from '../src/signals/registry';
import { parseEditCommand } from '../src/studio/protocol';
import { parseDesign, emptyDesign } from '../src/design/schema';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { worldScenario } from './helpers/world-scenario';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { defaultFollowMotion } from '../src/signals/motion';

export function surface(patch: Partial<OperationSurface> = {}): OperationSurface {
  return {
    id: 'seek',
    owner: 'native',
    generation: { documentId: 1, geometry: 1 },
    kind: 'drag',
    shape: { left: 100, top: 200, width: 200, height: 30 },
    protectedEnvelope: { left: 96, top: 196, width: 208, height: 38 },
    availability: {
      present: true,
      visible: true,
      disabled: false,
      focused: false,
      editing: false,
      dragging: false,
      captured: false,
    },
    policy: { transform: 'fixed-plane', occlusion: 'forbid', input: 'native-only' },
    compositionCapability: 'exclusion',
    scrolls: false,
    ...patch,
  };
}
export function snapshot(surfaces = [surface()]): OperationSnapshot {
  return {
    generation: { documentId: 1, geometry: 1 },
    viewport: { width: 1100, height: 760 },
    supported: true,
    surfaces,
  };
}
const paint = (patch: Partial<PaintFootprint> = {}): PaintFootprint => ({
  id: 'image-a',
  bounds: { left: 100, top: 205, right: 150, bottom: 225 },
  opacity: 1,
  pointerEvents: false,
  outset: 0,
  composition: 'overlay',
  ...patch,
});

test('click-through opaque art is stopped at protected controls; shadow and unknown filters count', () => {
  expect(guardPaint(snapshot(), [paint()])).toMatchObject([
    { layerId: 'image-a', surfaceId: 'seek', severity: 'enforced' },
  ]);
  expect(guardPaint(snapshot(), [paint({ bounds: { left: 50, top: 205, right: 90, bottom: 225 } })])).toEqual([]);
  expect(
    guardPaint(snapshot(), [paint({ bounds: { left: 50, top: 205, right: 90, bottom: 225 }, outset: 8 })]),
  ).toHaveLength(1);
  for (const outset of [Infinity, NaN, -1]) expect(guardPaint(snapshot(), [paint({ outset })])).toHaveLength(1);
});
test('input capture is forbidden even where noninteractive video paint is allowed', () => {
  const video = snapshot([surface({ policy: { transform: 'fixed-plane', occlusion: 'allow', input: 'native-only' } })]);
  expect(guardPaint(video, [paint()])).toEqual([]);
  expect(guardPaint(video, [paint({ pointerEvents: true })])).toHaveLength(1);
  expect(guardPaint(video, [paint({ pointerEvents: true, opacity: 0 })])).toHaveLength(1);
  // Only the trusted editor owns the central, native-clipped preview region.
  const owned = paint({
    pointerEvents: true,
    editorOwned: true,
    composition: 'native-underlay',
    clip: { left: 90, top: 190, width: 220, height: 60 },
  });
  expect(guardPaint(video, [owned])).toEqual([]);
  expect(guardPaint(snapshot(), [owned])).toHaveLength(1); // Seek remains protected.
  expect(guardPaint(video, [{ ...owned, composition: 'overlay' }])).toHaveLength(1);
  expect(() => parseEditCommand({ type: 'change', id: 'image-a', patch: { editorOwned: true } })).toThrow();
});
test('screen overlays reserve the entire compositor scroll path instead of cutting stale holes', () => {
  expect(
    guardPaint(snapshot([surface({ scrolls: true })]), [
      paint({ bounds: { left: 110, top: 500, right: 160, bottom: 550 } }),
    ]),
  ).toHaveLength(1);
  expect(guardPaint({ ...snapshot(), supported: false }, [paint()])).toHaveLength(1);
});
test('player-local clips permit video paint and report clipped parts without leaving paint on controls', () => {
  const result = guardPaint(snapshot(), [
    paint({
      bounds: { left: 110, top: 150, right: 160, bottom: 220 },
      composition: 'native-underlay',
      clip: { left: 100, top: 100, width: 200, height: 90 },
    }),
  ]);
  expect(result).toMatchObject([{ action: 'clip', severity: 'enforced' }]);
  expect(guardPaint(snapshot(), [paint({ composition: 'native-underlay' })])).toHaveLength(1);
});
test('proximity uses original coordinates, the pointer path and hysteresis, including keyboard/drag focus', () => {
  const s = snapshot();
  let state = stepProximity(initialProximity(), s, { timeMs: 0, interacting: false });
  state = stepProximity(state, s, { timeMs: 350, interacting: false });
  expect(state.safe).toBe(false);
  state = stepProximity(state, s, {
    timeMs: 360,
    interacting: false,
    previousPoint: { x: 0, y: 215 },
    point: { x: 500, y: 215 },
  });
  expect(state.safe).toBe(true);
  state = stepProximity(state, s, { timeMs: 400, interacting: false, point: { x: 500, y: 500 } });
  expect(stepProximity(state, s, { timeMs: 749, interacting: false }).safe).toBe(true);
  expect(stepProximity(state, s, { timeMs: 750, interacting: false }).safe).toBe(false);
  expect(stepProximity(state, s, { timeMs: 1000, interacting: true }).safe).toBe(true);
  const focused = surface();
  focused.availability.focused = true;
  expect(
    stepProximity({ safe: false, clearSince: 0 }, snapshot([focused]), { timeMs: 1000, interacting: false }).safe,
  ).toBe(true);
});
test('idle is a registry numeric host sample, and artwork cannot change Host protection or emergency state', () => {
  expect(SIGNAL_REGISTRY.numericSource('user.idle.duration', 'page', 'y')).toBe(true);
  expect(
    SIGNAL_REGISTRY.evaluate('user.idle.duration', {
      signals: { pointer: undefined, playing: false, samples: { 'user.idle.duration': 12 } },
    }),
  ).toBe(12);
  for (const command of [
    { type: 'emergency-off', value: false },
    { type: 'safety', enabled: false },
  ])
    expect(() => parseEditCommand(command)).toThrow();
  expect(() => parseDesign({ ...emptyDesign('youtube', 'retro'), safety: false })).toThrow();
});

test('reduced motion and native approach return transforms to authored values without changing saved artwork', () => {
  const { scene, inputs } = worldScenario(1);
  const layer = scene.decorations[0]!;
  layer.visible = true;
  layer.opacity = 0.75;
  layer.motion = { ...defaultFollowMotion(), mode: 'direct' };
  scene.groups = [];
  scene.signalRules = [defaultScrollOpacityRule(layer.id)];
  const before = JSON.stringify(scene);
  const input = {
    ...inputs[0]!,
    signals: { pointer: { x: 800, y: 600 }, playing: true, scroll: { x: 0, y: 0, maxX: 0, maxY: 1000 } },
  };
  for (const environment of [
    { hidden: false, reducedMotion: true },
    { hidden: false, reducedMotion: false, safeInteraction: true },
  ]) {
    const result = evaluateWorld(scene, initialWorldState(), { ...input, environment });
    expect(result.frame.layout.layers[0]!.layer.placement).toEqual(layer.placement);
    expect(result.frame.layout.layers[0]!.layer.opacity).toBe(0.75);
    expect(result.frame.needsFrame).toBe(false);
  }
  expect(JSON.stringify(scene)).toBe(before);
});
