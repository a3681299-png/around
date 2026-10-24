import { test, expect } from '@playwright/test';
import {
  guardPaint,
  protectionClip,
  safePaintRegions,
  pagePaintRegions,
  intersects,
  ATMOSPHERE_ALPHA_CAP,
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
import { referenceGuardPaint } from './helpers/reference-guard-paint';
import { guardWanted } from '../src/host/operation-guard';

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
  expect(
    guardPaint(snapshot([surface({ compositionCapability: 'native-above' })]), [
      paint({
        composition: 'native-underlay',
        clip: { left: 0, top: 0, width: 1100, height: 760 },
      }),
    ]),
  ).toMatchObject([{ action: 'stop' }]);
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

test('guardPaint reuses per-snapshot envelopes without changing a single issue', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
  for (let round = 0; round < 60; round++) {
    const surfaces = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, i) => {
      const left = random() * 1000,
        top = random() * 700,
        width = 10 + random() * 200,
        height = 10 + random() * 80;
      return surface({
        id: `s${i}`,
        shape: { left, top, width, height },
        protectedEnvelope: { left: left - 4, top: top - 4, width: width + 8, height: height + 8 },
        availability: { ...surface().availability, visible: random() > 0.2 },
        policy: { transform: 'fixed-plane', occlusion: pick(['forbid', 'allow'] as const), input: 'native-only' },
        compositionCapability: pick(['exclusion', 'native-underlay', 'native-above'] as const),
        scrolls: random() > 0.5,
      });
    });
    const current = { ...snapshot(surfaces), supported: random() > 0.05 };
    const paints = Array.from({ length: 1 + Math.floor(random() * 32) }, (_, i) => {
      const left = random() * 1000,
        top = random() * 700;
      return paint({
        id: `p${i}`,
        bounds: { left, top, right: left + random() * 300, bottom: top + random() * 300 },
        opacity: pick([0, 0.5, 1]),
        pointerEvents: random() > 0.7,
        editorOwned: random() > 0.8,
        outset: pick([0, 4, 30]),
        composition: pick(['overlay', 'native-underlay', 'unsupported'] as const),
        ...(random() > 0.3 ? { clip: { left: 100, top: 100, width: 600, height: 400 } } : {}),
      });
    });
    const expected = referenceGuardPaint(current, paints);
    expect(guardPaint(current, paints), `round ${round}`).toEqual(expected);
    // A repeated frame with the same immutable snapshot takes the reuse path.
    expect(guardPaint(current, paints), `round ${round} repeated`).toEqual(expected);
  }
});

test('protection clip is computed once per immutable snapshot and editing state', () => {
  const first = Object.freeze(snapshot([surface(), surface({ id: 'b', scrolls: true })]));
  const clip = protectionClip(first, false);
  expect(protectionClip(first, false)).toBe(clip);
  expect(clip.regions).toEqual(safePaintRegions(first, false));
  expect(clip.path).toBe(
    clip.regions.map((r) => `M${r.left} ${r.top}h${r.width}v${r.height}h${-r.width}Z`).join('') || '',
  );
  expect(protectionClip(first, true)).not.toBe(clip);
  const next = Object.freeze(snapshot([surface({ shape: { left: 0, top: 0, width: 10, height: 10 } })]));
  expect(protectionClip(next, false)).not.toBe(clip);
  expect(protectionClip(Object.freeze({ ...first, supported: false }), false).path).toBe('');
});

test('the page plane cuts page-scrolling surfaces at their current envelope only', () => {
  const page = snapshot([surface({ scrolls: true })]);
  // Same column as the seek bar, far below it: the screen plane must avoid the whole
  // column, the page plane moves with the bar and only avoids its current envelope.
  const below = { left: 120, top: 500, right: 160, bottom: 540 };
  expect(guardPaint(page, [paint({ bounds: below })])).toHaveLength(1);
  expect(guardPaint(page, [paint({ bounds: below, composition: 'page' })])).toEqual([]);
  expect(guardPaint(page, [paint({ composition: 'page' })])).toMatchObject([{ action: 'clip', surfaceId: 'seek' }]);
});

test('the page plane sweeps screen-fixed surfaces and whole inner scroll boxes', () => {
  const fixed = snapshot([surface({ scrolls: false })]);
  const far = { left: 120, top: 2000, right: 160, bottom: 2040 };
  expect(guardPaint(fixed, [paint({ bounds: far })])).toEqual([]);
  expect(guardPaint(fixed, [paint({ bounds: far, composition: 'page' })])).toHaveLength(1);
  const nested = snapshot([surface({ scrolls: true, scrollBox: { left: 50, top: 100, width: 400, height: 300 } })]);
  const insideBox = { left: 380, top: 350, right: 420, bottom: 390 };
  expect(guardPaint(nested, [paint({ bounds: insideBox, composition: 'page' })])).toHaveLength(1);
  expect(guardPaint(nested, [paint({ bounds: { ...insideBox, top: 450, bottom: 480 }, composition: 'page' })])).toEqual(
    [],
  );
  // A proven native-above control stays in front of either plane.
  const above = snapshot([surface({ scrolls: false, compositionCapability: 'native-above' })]);
  expect(guardPaint(above, [paint({ bounds: far, composition: 'page' })])).toEqual([]);
});

test('page regions never meet a page envelope and cover the rest of the requested area', () => {
  const surfaces = [
    surface({ id: 'a', scrolls: true }),
    surface({ id: 'b', scrolls: false, protectedEnvelope: { left: 700, top: 10, width: 60, height: 40 } }),
    surface({
      id: 'c',
      scrolls: true,
      protectedEnvelope: { left: 300, top: 400, width: 20, height: 20 },
      scrollBox: { left: 280, top: 380, width: 200, height: 150 },
    }),
    surface({ id: 'hidden', availability: { ...surface().availability, visible: false } }),
  ];
  const area = { left: 0, top: -500, width: 1100, height: 2000 };
  const regions = pagePaintRegions(snapshot(surfaces), false, area);
  const cuts = [
    surfaces[0]!.protectedEnvelope,
    { left: 700, top: -1e7, width: 60, height: 2e7 },
    surfaces[2]!.scrollBox!,
  ];
  for (const r of regions)
    for (const cut of cuts)
      expect(intersects({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height }, cut)).toBe(
        false,
      );
  const area2 = (r: { width: number; height: number }) => r.width * r.height;
  const removed = area2(surfaces[0]!.protectedEnvelope) + 60 * 2000 + area2(surfaces[2]!.scrollBox!);
  expect(regions.reduce((sum, r) => sum + area2(r), 0)).toBeCloseTo(area2(area) - removed, 6);
  expect(pagePaintRegions({ ...snapshot(surfaces), supported: false }, false, area)).toEqual([]);
});

test('atmosphere crosses protected surfaces but never takes input or skips verification', () => {
  const atmosphere = paint({ composition: 'atmosphere', bounds: { left: 0, top: 0, right: 1100, bottom: 760 } });
  expect(guardPaint(snapshot(), [atmosphere])).toEqual([]);
  expect(guardPaint(snapshot(), [{ ...atmosphere, pointerEvents: true }])).toMatchObject([
    { action: 'stop', surfaceId: 'atmosphere' },
  ]);
  expect(guardPaint({ ...snapshot(), supported: false }, [atmosphere])).toHaveLength(1);
  expect(guardPaint(snapshot(), [{ ...atmosphere, opacity: NaN }])).toHaveLength(1);
  expect(ATMOSPHERE_ALPHA_CAP).toBeGreaterThan(0);
  expect(ATMOSPHERE_ALPHA_CAP).toBeLessThanOrEqual(0.4);
});

test('native-surface inspection runs only while artwork or the editor can paint', () => {
  const on = { suspended: false, enabled: true, strength: 60, layers: 1, editing: false };
  expect(guardWanted(on)).toBe(true);
  expect(guardWanted({ ...on, layers: 0 })).toBe(false); // No artwork: nothing can cover a control.
  expect(guardWanted({ ...on, layers: 0, editing: true })).toBe(true); // The editor may add one at any time.
  expect(guardWanted({ ...on, enabled: false })).toBe(false); // Theme OFF.
  expect(guardWanted({ ...on, strength: 0 })).toBe(false); // Strength zero.
  expect(guardWanted({ ...on, suspended: true, editing: true })).toBe(false); // Emergency OFF / fullscreen suspend.
});

test('approach uses the protected band of a surface, never the whole player behind it', () => {
  const player = { left: 16, top: 145, width: 1050, height: 590 };
  const band = { ...player, top: player.top + player.height - 112, height: 112 };
  const surfaces = [
    surface({
      id: 'player.video',
      kind: 'gesture',
      shape: player,
      protectedEnvelope: player,
      policy: { transform: 'fixed-plane', occlusion: 'allow', input: 'native-only' },
    }),
    surface({ id: 'player.controls.bottom', shape: player, protectedEnvelope: band }),
  ];
  const step = (point: { x: number; y: number }) =>
    stepProximity({ safe: false, clearSince: null }, snapshot(surfaces), { timeMs: 0, point, interacting: false }).safe;
  // Over the middle of the video: neither the gesture area nor the far control band is near.
  expect(step({ x: 80, y: 400 })).toBe(false);
  // Inside, and within the margin of, the real control band.
  expect(step({ x: 80, y: 700 })).toBe(true);
  expect(step({ x: 80, y: band.top - 30 })).toBe(true);
});
