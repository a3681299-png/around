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
  stepApproach,
  initialApproach,
  approachLayers,
  approachRectOf,
  editorClaims,
  type ApproachState,
  type OperationSnapshot,
  type OperationSurface,
  type PaintFootprint,
} from '../src/world/operations';
import type { Point } from '../src/world/geometry';
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
/** A player that scrolls with the page: its coverable video, the two control bands and seek. */
function playerSnapshot() {
  const player = { left: 16, top: 100, width: 640, height: 360 };
  const allow = { transform: 'fixed-plane', occlusion: 'allow', input: 'native-only' } as const;
  return snapshot([
    surface({
      id: 'player.video',
      kind: 'gesture',
      shape: player,
      protectedEnvelope: player,
      policy: allow,
      scrolls: true,
    }),
    surface({
      id: 'player.controls.top',
      kind: 'click',
      shape: player,
      protectedEnvelope: { ...player, height: 64 },
      scrolls: true,
    }),
    surface({
      id: 'player.controls.bottom',
      shape: player,
      protectedEnvelope: { ...player, top: 100 + 360 - 112, height: 112 },
      scrolls: true,
    }),
  ]);
}
const videoCentre = { left: 16, top: 164, width: 640, height: 184 };
test('explicit editing lets screen-plane handles own only the verified video centre, never its bands', () => {
  const owned = paint({
    pointerEvents: true,
    editorOwned: true,
    editorRegion: videoCentre,
    bounds: { left: 200, top: 200, right: 300, bottom: 280 },
  });
  // Inside the centre: the bands are checked at their current rectangles, the video is owned.
  expect(guardPaint(playerSnapshot(), [owned])).toEqual([]);
  // Without the renderer-issued centre, the swept bands and the video still forbid input.
  const { editorRegion: _unused, ...unowned } = owned;
  void _unused;
  expect(guardPaint(playerSnapshot(), [unowned])).toHaveLength(1);
  expect(guardPaint(playerSnapshot(), [{ ...owned, editorOwned: false }])).toHaveLength(1);
  // Reaching into a band, or outside the centre, falls back to the full protection.
  expect(guardPaint(playerSnapshot(), [{ ...owned, bounds: { ...owned.bounds, bottom: 360 } }])).toHaveLength(1);
  expect(guardPaint(playerSnapshot(), [{ ...owned, bounds: { ...owned.bounds, top: 140 } }])).toHaveLength(1);
  // A real control that appears in the centre stays protected.
  const central = snapshot([
    ...playerSnapshot().surfaces,
    surface({
      id: 'control.9',
      kind: 'click',
      shape: { left: 220, top: 220, width: 40, height: 40 },
      protectedEnvelope: { left: 216, top: 216, width: 48, height: 48 },
      scrolls: true,
    }),
  ]);
  expect(guardPaint(central, [owned])).toMatchObject([{ surfaceId: 'control.9' }]);
  // A player-anchored root that falls back to the page plane takes the same ownership; the
  // atmosphere plane never takes input.
  expect(guardPaint(playerSnapshot(), [{ ...owned, composition: 'page' }])).toEqual([]);
  expect(guardPaint(playerSnapshot(), [{ ...owned, composition: 'atmosphere' }])).toHaveLength(1);
});
test('the page plane reopens the editing video centre too, cutting central controls at their rectangles', () => {
  const inside = (regions: { left: number; top: number; width: number; height: number }[], x: number, y: number) =>
    regions.some((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height);
  const area = { left: 0, top: 0, width: 1100, height: 760 };
  const central = snapshot([
    ...playerSnapshot().surfaces,
    surface({
      id: 'control.9',
      kind: 'click',
      shape: { left: 220, top: 220, width: 40, height: 40 },
      protectedEnvelope: { left: 216, top: 216, width: 48, height: 48 },
      scrolls: true,
    }),
  ]);
  // Without the centre, editing cuts the whole (allow) player.
  expect(inside(pagePaintRegions(central, true, area), 400, 250)).toBe(false);
  const regions = pagePaintRegions(central, true, area, videoCentre);
  expect(inside(regions, 400, 250)).toBe(true);
  expect(inside(regions, 240, 240)).toBe(false); // the central control
  expect(inside(regions, 300, 400)).toBe(false); // bottom band
  expect(inside(regions, 300, 130)).toBe(false); // top band
  // Outside editing the centre changes nothing (the page plane may paint over the video, without input).
  expect(pagePaintRegions(central, false, area, videoCentre)).toEqual(pagePaintRegions(central, false, area));
});
test('the editing clip opens the video centre to the screen plane but keeps bands, seek and central controls cut', () => {
  const inside = (regions: { left: number; top: number; width: number; height: number }[], x: number, y: number) =>
    regions.some((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height);
  const snap = playerSnapshot();
  // Without the centre the swept bands remove the player's whole column.
  expect(inside(safePaintRegions(snap, true), 300, 250)).toBe(false);
  const regions = safePaintRegions(snap, true, videoCentre);
  expect(inside(regions, 300, 250)).toBe(true);
  expect(inside(regions, 300, 130)).toBe(false); // top band
  expect(inside(regions, 300, 400)).toBe(false); // bottom band
  expect(inside(regions, 300, 600)).toBe(false); // the rest of the swept column
  expect(inside(regions, 900, 600)).toBe(true); // elsewhere unchanged
  // The centre is only for explicit editing.
  expect(inside(safePaintRegions(snap, false, videoCentre), 300, 250)).toBe(false);
  const central = snapshot([
    ...snap.surfaces,
    surface({
      id: 'control.9',
      kind: 'click',
      shape: { left: 220, top: 220, width: 40, height: 40 },
      protectedEnvelope: { left: 216, top: 216, width: 48, height: 48 },
      scrolls: true,
    }),
  ]);
  const cut = safePaintRegions(central, true, videoCentre);
  expect(inside(cut, 240, 240)).toBe(false);
  expect(inside(cut, 400, 250)).toBe(true);
  // Regions stay disjoint.
  for (const [i, a] of cut.entries())
    for (const b of cut.slice(i + 1))
      expect(
        a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height,
      ).toBe(false);
  expect(protectionClip(snap, true, videoCentre).path).not.toBe(protectionClip(snap, true).path);
});
test('an editor gesture is claimed only where a fresh read finds no protected control under the point', () => {
  const snap = playerSnapshot();
  expect(editorClaims(snap, { x: 300, y: 250 })).toBe(true);
  expect(editorClaims(snap, { x: 300, y: 400 })).toBe(false); // bottom band
  expect(editorClaims(snap, { x: 300, y: 120 })).toBe(false); // top band
  expect(editorClaims({ ...snap, supported: false }, { x: 300, y: 250 })).toBe(false);
  const hidden = snapshot([surface({ availability: { ...surface().availability, visible: false } })]);
  expect(editorClaims(hidden, { x: 150, y: 210 })).toBe(true);
  expect(editorClaims(snapshot(), { x: 150, y: 210 })).toBe(false);
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
const away = surface({
  id: 'like',
  kind: 'click',
  shape: { left: 700, top: 200, width: 60, height: 30 },
  protectedEnvelope: { left: 696, top: 196, width: 68, height: 38 },
});
const dynamicPaint = (id: string, left: number, top: number, patch: Partial<PaintFootprint> = {}) =>
  paint({ id, dynamic: true, bounds: { left, top, right: left + 50, bottom: top + 20 }, ...patch });
const heldRoots = (state: ApproachState) => [...state.held.keys()].sort();
test('G1.2: each approached control keeps its own hysteresis (40px to enter, 72px to stay, 350ms)', () => {
  const s = snapshot([surface(), away]);
  const step = (state: ApproachState, timeMs: number, point?: { x: number; y: number }) =>
    stepApproach(state, s, { timeMs, keyed: false, ...(point ? { point } : {}) }, []);
  // The seek band is 100..300 x 200..230. 50px above it is outside the entering margin.
  let state = step(initialApproach(), 0, { x: 200, y: 150 });
  expect([...state.near.keys()]).toEqual([]);
  state = step(state, 10, { x: 200, y: 165 });
  expect([...state.near.keys()]).toEqual(['seek']);
  // Inside the staying margin it stays near; the far control never joins.
  state = step(state, 20, { x: 200, y: 140 });
  expect(state.near.get('seek')).toMatchObject({ clearSince: null });
  state = step(state, 30, { x: 200, y: 100 });
  expect(state.near.get('seek')).toMatchObject({ clearSince: 30 });
  expect(step(state, 379, { x: 200, y: 100 }).near.has('seek')).toBe(true);
  expect(step(state, 380, { x: 200, y: 100 }).near.has('seek')).toBe(false);
  expect(state.near.has('like')).toBe(false);
});
test('G1.2: only dynamic roots painted over a near control are held, as root units', () => {
  const s = snapshot([surface(), away]);
  const paints = [
    dynamicPaint('over-seek', 120, 205),
    dynamicPaint('far', 400, 500),
    dynamicPaint('still', 120, 205, { dynamic: false }),
    dynamicPaint('child-a', 600, 600, { root: 'group' }),
    dynamicPaint('child-b', 250, 210, { root: 'group' }),
    // Overlap only (D3): touching the edge is not overlapping.
    dynamicPaint('beside', 300, 205),
  ];
  const state = stepApproach(initialApproach(), s, { timeMs: 0, keyed: false, point: { x: 200, y: 215 } }, paints);
  expect(heldRoots(state)).toEqual(['group', 'over-seek']);
  // D11: the seek band, narrowed to 72px around the pointer.
  const area = { left: 128, top: 200, width: 144, height: 30 };
  expect(approachRectOf(surface())).toEqual({ left: 100, top: 200, width: 200, height: 30 });
  expect(approachLayers(state)).toEqual({ layers: { 'over-seek': [area], group: [area] } });
  expect(approachLayers(initialApproach())).toBeUndefined();
});
test('G1.2: a held root stays held until its control clears, even after it moves away', () => {
  const s = snapshot([surface(), away]);
  let paints = [dynamicPaint('mover', 120, 205)];
  let state = stepApproach(initialApproach(), s, { timeMs: 0, keyed: false, point: { x: 200, y: 215 } }, paints);
  expect(heldRoots(state)).toEqual(['mover']);
  // Back at its resting place, far from the control: still held while the control is near.
  paints = [dynamicPaint('mover', 500, 500)];
  state = stepApproach(state, s, { timeMs: 100, keyed: false, point: { x: 200, y: 215 } }, paints);
  expect(heldRoots(state)).toEqual(['mover']);
  state = stepApproach(state, s, { timeMs: 200, keyed: false, point: { x: 200, y: 500 } }, paints);
  state = stepApproach(state, s, { timeMs: 549, keyed: false, point: { x: 200, y: 500 } }, paints);
  expect(heldRoots(state)).toEqual(['mover']);
  state = stepApproach(state, s, { timeMs: 550, keyed: false, point: { x: 200, y: 500 } }, paints);
  expect(heldRoots(state)).toEqual([]);
  // A layer that moves onto a near control later is held from that frame on.
  state = stepApproach(state, s, { timeMs: 600, keyed: false, point: { x: 720, y: 215 } }, paints);
  expect(heldRoots(state)).toEqual([]);
  paints = [dynamicPaint('mover', 690, 200)];
  state = stepApproach(state, s, { timeMs: 616, keyed: false, point: { x: 720, y: 215 } }, paints);
  expect(heldRoots(state)).toEqual(['mover']);
  expect(state.held.get('mover')).toEqual(['like']);
});
test('G1.2 (D11): near one end of a long control, only layers near the pointer are held', () => {
  // A link 900px wide; the pointer comes near its left end only.
  const long = surface({
    id: 'long-link',
    kind: 'click',
    shape: { left: 100, top: 400, width: 900, height: 20 },
    protectedEnvelope: { left: 96, top: 396, width: 908, height: 28 },
  });
  const s = snapshot([long]);
  const paints = [
    dynamicPaint('near-end', 130, 405),
    dynamicPaint('far-end', 900, 405),
    dynamicPaint('edge', 150, 405),
  ];
  let state = stepApproach(initialApproach(), s, { timeMs: 0, keyed: false, point: { x: 80, y: 410 } }, paints);
  expect([...state.near.keys()]).toEqual(['long-link']);
  // 72px around the pointer reaches x=152: the layers there are held, the far end is not.
  expect(heldRoots(state)).toEqual(['edge', 'near-end']);
  expect(state.near.get('long-link')!.rect).toEqual({ left: 100, top: 400, width: 52, height: 20 });
  // While it clears, the narrowed area stays where the pointer was.
  state = stepApproach(state, s, { timeMs: 10, keyed: false, point: { x: 80, y: 600 } }, paints);
  expect(state.near.get('long-link')).toMatchObject({ clearSince: 10 });
  expect(heldRoots(state)).toEqual(['edge', 'near-end']);
  // A path along the link narrows to the swept area: from x=80 to x=500, and 72px beyond.
  state = stepApproach(
    initialApproach(),
    s,
    { timeMs: 0, keyed: false, previousPoint: { x: 80, y: 380 }, point: { x: 500, y: 380 } },
    [...paints, dynamicPaint('middle', 520, 405)],
  );
  expect(heldRoots(state)).toEqual(['edge', 'middle', 'near-end']);
  // Focus, drag, capture, keys and presses keep the whole control.
  const focused = { ...long, availability: { ...long.availability, focused: true } };
  state = stepApproach(
    initialApproach(),
    snapshot([focused]),
    { timeMs: 0, keyed: false, point: { x: 80, y: 410 } },
    paints,
  );
  expect(heldRoots(state)).toEqual(['edge', 'far-end', 'near-end']);
});
test('G1.2: the banded candidate index finds exactly the controls a full scan finds', () => {
  let seed = 12;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // Every visible, uncoverable control whose approach box the path passes within the margin.
  const reference = (snap: OperationSnapshot, from: Point, to: Point, near: ReadonlySet<string>) =>
    snap.surfaces
      .filter((s) => s.availability.visible && s.policy.occlusion !== 'allow')
      .filter((s) => {
        const r = approachRectOf(s),
          m = near.has(s.id) ? 72 : 40;
        if (r.width <= 0 || r.height <= 0) return false;
        let low = 0,
          high = 1;
        for (const [a, d, min, max] of [
          [from.x, to.x - from.x, r.left - m, r.left + r.width + m],
          [from.y, to.y - from.y, r.top - m, r.top + r.height + m],
        ] as const) {
          if (d === 0) {
            if (a < min || a > max) return false;
          } else {
            const s1 = (min - a) / d,
              s2 = (max - a) / d;
            low = Math.max(low, Math.min(s1, s2));
            high = Math.min(high, Math.max(s1, s2));
            if (low > high) return false;
          }
        }
        return true;
      })
      .map((s) => s.id)
      .sort();
  for (let run = 0; run < 300; run++) {
    const surfaces = Array.from({ length: 1 + Math.floor(random() * 60) }, (_, i) => {
      const left = random() * 2000 - 200,
        top = random() * 12000 - 4000,
        width = random() < 0.1 ? 3000 : 4 + random() * 400,
        height = random() < 0.1 ? 9000 : 4 + random() * 200;
      return surface({
        id: `c${i}`,
        shape: { left, top, width, height },
        protectedEnvelope: { left: left - 4, top: top - 4, width: width + 8, height: height + 8 },
        availability: { ...surface().availability, visible: random() > 0.2 },
        ...(random() < 0.1
          ? {
              policy: { transform: 'fixed-plane' as const, occlusion: 'allow' as const, input: 'native-only' as const },
            }
          : {}),
      });
    });
    const snap = snapshot(surfaces),
      from = { x: random() * 1800, y: random() * 1000 },
      to = random() < 0.5 ? from : { x: random() * 1800, y: random() * 1000 };
    const first = stepApproach(
      initialApproach(),
      snap,
      { timeMs: 0, keyed: false, previousPoint: from, point: to },
      [],
    );
    expect([...first.near.keys()].sort(), `run ${run}`).toEqual(reference(snap, from, to, new Set()));
    // The staying margin for controls already near.
    const second = stepApproach(first, snap, { timeMs: 1, keyed: false, point: to }, []);
    expect(
      [...second.near.entries()]
        .filter(([, entry]) => entry.clearSince === null)
        .map(([id]) => id)
        .sort(),
      `run ${run}`,
    ).toEqual(reference(snap, to, to, new Set(first.near.keys())));
  }
});
test('G1.2: an approach without a pointer holds the layers over its control (D2)', () => {
  const player = { left: 16, top: 145, width: 1050, height: 590 };
  const video = surface({
    id: 'player.video',
    kind: 'gesture',
    shape: player,
    protectedEnvelope: player,
    policy: { transform: 'fixed-plane', occlusion: 'allow', input: 'native-only' },
  });
  const seek = surface({ shape: { left: 100, top: 900, width: 200, height: 30 } });
  seek.protectedEnvelope = { left: 96, top: 896, width: 208, height: 38 };
  const paints = [dynamicPaint('on-seek', 120, 905), dynamicPaint('on-video', 500, 400), dynamicPaint('far', 1500, 50)];
  const held = (surfaces: OperationSurface[], input: Partial<Parameters<typeof stepApproach>[2]>) =>
    heldRoots(stepApproach(initialApproach(), snapshot(surfaces), { timeMs: 0, keyed: false, ...input }, paints));
  const focused = { ...seek, availability: { ...seek.availability, focused: true } };
  const dragging = { ...seek, availability: { ...seek.availability, dragging: true } };
  expect(held([video, focused], {})).toEqual(['on-seek']);
  expect(held([video, dragging], {})).toEqual(['on-seek']);
  // A key typed with focus on a control holds only that control's layers.
  expect(held([video, focused], { keyed: true })).toEqual(['on-seek']);
  // A key on the page (YouTube's k, j, l) goes to the player: the layers over the player.
  expect(held([video, seek], { keyed: true })).toEqual(['on-video']);
  // A press away from every control holds what is painted within 40px of the press.
  expect(held([video, seek], { pressed: { x: 1490, y: 30 } })).toEqual(['far']);
  expect(held([video, seek], { pressed: { x: 1400, y: 30 } })).toEqual([]);
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

test('G1.2: an approach that holds every root equals the whole-page restriction for rules and follow motion', () => {
  const { scene, inputs } = worldScenario(8);
  scene.signalRules = scene.decorations.map((layer) => defaultScrollOpacityRule(layer.id));
  scene.decorations = scene.decorations.map((layer, i) =>
    i % 2 ? { ...layer, motion: { ...defaultFollowMotion(), mode: 'direct' as const } } : layer,
  );
  const roots = evaluateWorld(scene, initialWorldState(), inputs[0]!).frame.layout.roots;
  let all = initialWorldState(),
    whole = initialWorldState();
  for (const input of inputs.slice(0, 40)) {
    const signals = { ...input.signals, scroll: { x: 0, y: input.timeMs % 900, maxX: 0, maxY: 1000 } };
    const a = evaluateWorld(scene, all, {
      ...input,
      signals,
      environment: { ...input.environment, approach: { layers: Object.fromEntries(roots.map((id) => [id, []])) } },
    });
    const b = evaluateWorld(scene, whole, {
      ...input,
      signals,
      environment: { ...input.environment, safeInteraction: true },
    });
    expect(a.frame.layout).toEqual(b.frame.layout);
    expect(a.state.motion).toEqual(b.state.motion);
    all = a.state;
    whole = b.state;
  }
});

test('G1.2: only held roots return their rules to authored values; other layers keep their signal values', () => {
  const { scene, inputs } = worldScenario(4);
  scene.groups = [{ ...scene.groups![0]!, children: ['image-0', 'image-1'] }];
  scene.decorations = scene.decorations.map((layer) => ({ ...layer, visible: true, opacity: 0.75 }));
  scene.signalRules = [
    defaultScrollOpacityRule('image-0'),
    defaultScrollOpacityRule('group-0'),
    defaultScrollOpacityRule('image-2'),
    defaultScrollOpacityRule('image-3'),
  ];
  const input = {
    ...inputs[0]!,
    signals: { ...inputs[0]!.signals, scroll: { x: 0, y: 250, maxX: 0, maxY: 1000 } },
  };
  const free = evaluateWorld(scene, initialWorldState(), input).frame.layout;
  const held = evaluateWorld(scene, initialWorldState(), {
    ...input,
    environment: {
      ...input.environment,
      approach: { layers: { 'group-0': [{ left: 0, top: 0, width: 10, height: 10 }], 'image-3': [] } },
    },
  }).frame.layout;
  const opacity = (layout: typeof free, id: string) =>
    [...layout.layers, ...layout.groups].find((entry) => entry.layer.id === id)!.layer.opacity;
  // The group is held: its own rule and its children's rules return to the authored values.
  expect(opacity(held, 'group-0')).toBe(scene.groups[0]!.opacity);
  expect(opacity(held, 'image-0')).toBe(0.75);
  expect(opacity(held, 'image-3')).toBe(0.75);
  // A root that is not held keeps exactly the value it has without any approach.
  expect(opacity(held, 'image-2')).toBe(opacity(free, 'image-2'));
  expect(opacity(free, 'image-2')).not.toBe(0.75);
});

test('G1.2: a held follow layer stops where it is; a layer that is not held keeps following', () => {
  const { scene, inputs } = worldScenario(2);
  scene.groups = [];
  scene.decorations = scene.decorations.map((layer) => ({
    ...layer,
    visible: true,
    opacity: 1,
    motion: { ...defaultFollowMotion(), mode: 'smooth' as const },
  }));
  let state = initialWorldState();
  const at = (n: number, environment: object = {}) => ({
    ...inputs[0]!,
    timeMs: n * 16,
    deltaMs: n ? 16 : 0,
    signals: { ...inputs[0]!.signals, pointer: { x: 900, y: 600 } },
    environment: { hidden: false, reducedMotion: false, ...environment },
  });
  for (let n = 0; n < 20; n++) state = evaluateWorld(scene, state, at(n)).state;
  const moved = state.motion!.bodies['image-0']!.offset,
    other = state.motion!.bodies['image-1']!.offset;
  expect(Math.hypot(moved.x, moved.y)).toBeGreaterThan(1);
  const held = evaluateWorld(scene, state, at(20, { approach: { layers: { 'image-0': [] } } })).state.motion!;
  expect(held.bodies['image-0']!.offset).toEqual(moved);
  expect(held.bodies['image-0']!.velocity).toEqual({ x: 0, y: 0 });
  expect(
    Math.hypot(held.bodies['image-1']!.offset.x - other.x, held.bodies['image-1']!.offset.y - other.y),
  ).toBeGreaterThan(0);
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
  const on = { suspended: false, enabled: true, layers: 1, editing: false };
  expect(guardWanted(on)).toBe(true);
  expect(guardWanted({ ...on, layers: 0 })).toBe(false); // No artwork: nothing can cover a control.
  expect(guardWanted({ ...on, layers: 0, editing: true })).toBe(true); // The editor may add one at any time.
  expect(guardWanted({ ...on, enabled: false })).toBe(false); // 作品を表示する OFF.
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

test('keyboard focus on the coverable video area alone is not an approach', () => {
  const player = { left: 16, top: 145, width: 1050, height: 590 };
  const video = surface({
    id: 'player.video',
    kind: 'gesture',
    shape: player,
    protectedEnvelope: player,
    policy: { transform: 'fixed-plane', occlusion: 'allow', input: 'native-only' },
    availability: { ...surface().availability, focused: true },
  });
  const step = (surfaces: OperationSurface[]) =>
    stepProximity({ safe: false, clearSince: null }, snapshot(surfaces), {
      timeMs: 0,
      point: { x: 990, y: 300 },
      interacting: false,
    }).safe;
  expect(step([video])).toBe(false);
  // A focused control that must not be covered still counts, wherever the pointer is.
  expect(step([video, surface({ id: 'seek', availability: { ...surface().availability, focused: true } })])).toBe(true);
});
