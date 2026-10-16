import { test, expect } from '@playwright/test';
import { createHistory } from '../src/editor/history';
import { deleteLayers, duplicateLayers, frontToBack, reorderLayers, selectLayer } from '../src/editor/layers';
import { centre, moveGroup, reanchorPlacement } from '../src/design/geometry';
import type { LayerState } from '../src/design/types';

const layer = (id: string, zIndex = 0, locked = false): LayerState => ({ id, name: id, zIndex, locked, visible: true, opacity: 1,
  placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 80, heightPx: 60, rotationDeg: 0 } });

test('selection toggles and canvas clicks preserve an existing group without recording an edit', () => {
  expect(selectLayer(['a'], 'b', true)).toEqual(['a', 'b']);
  expect(selectLayer(['a', 'b'], 'a', true)).toEqual(['b']);
  expect(selectLayer(['a', 'b'], 'a', false, true)).toEqual(['a', 'b']);
  expect(selectLayer(['a', 'b'], 'a', false)).toEqual(['a']);
});

test('32 layers reorder deterministically; locked deletion and duplication are excluded', () => {
  const layers = Array.from({ length: 32 }, (_, i) => layer(`layer-${i}`, i % 3, i % 4 === 0));
  expect(frontToBack(layers).slice(0, 3).map((l) => l.id)).toEqual(['layer-29', 'layer-26', 'layer-23']);
  const order = reorderLayers(layers, 'layer-0', 'layer-31', true);
  const ids = frontToBack(order).map((l) => l.id);
  expect(ids.indexOf('layer-0')).toBe(ids.indexOf('layer-31') + 1);
  expect(new Set(order.map((l) => l.zIndex)).size).toBe(32);
  expect(deleteLayers(layers, layers.map((l) => l.id))).toEqual(layers.filter((l) => l.locked));
  expect(duplicateLayers(layers, ['layer-0'], () => 'copy', (l) => l.placement).ids).toEqual([]);
  expect(() => duplicateLayers(layers, ['layer-1'], () => 'copy', (l) => l.placement)).toThrow('32');
  const copies = duplicateLayers(layers.slice(0, 3), ['layer-0', 'layer-1'], () => 'copy', (l) => ({ ...l.placement, x: .6 }));
  expect(copies.ids).toEqual(['copy']);
  expect(copies.layers.at(-1)).toMatchObject({ id: 'copy', name: 'layer-1 コピー', placement: { x: .6 }, locked: false });
  expect(layers[1]?.placement.x).toBe(.5);
});

test('history batches a gesture, ignores no-ops, invalidates redo only on edits and bounds snapshots', () => {
  const history = createHistory<{ x: number }>((v) => ({ ...v }), (a, b) => a.x === b.x, 3);
  history.begin({ x: 0 });
  for (let x = 1; x <= 100; x++) history.record({ x: x - 1 }, { x });
  history.commit({ x: 100 });
  expect(history.undo({ x: 100 })).toEqual({ x: 0 });
  history.record({ x: 0 }, { x: 0 });
  expect(history.redo({ x: 0 })).toEqual({ x: 100 });
  history.begin({ x: 100 }); expect(history.cancel()).toEqual({ x: 100 });
  for (let x = 101; x <= 105; x++) history.record({ x: x - 1 }, { x });
  expect(history.values()).toHaveLength(3);
  expect(history.undo({ x: 105 })).toEqual({ x: 104 });
  history.record({ x: 104 }, { x: 200 }); expect(history.canRedo).toBe(false);
  history.reset(); expect(history.values()).toEqual([]);
});

test('mixed anchor group movement shares one pixel delta and clamps without changing group spacing', () => {
  const a = { id: 'a', placement: layer('a').placement, frame: { left: 0, top: 0, width: 1000, height: 800 } };
  const b = { id: 'b', placement: { ...layer('b').placement, anchor: { kind: 'surface' as const, target: 'player' } }, frame: { left: 100, top: -100, width: 600, height: 400 } };
  const moved = moveGroup([a, b], { x: 40, y: 10 });
  expect(centre(moved[0]!.placement, a.frame).x).toBeCloseTo(540, 6);
  expect(centre(moved[0]!.placement, a.frame).y).toBeCloseTo(410, 6);
  expect(centre(moved[1]!.placement, b.frame).x).toBeCloseTo(440, 6);
  expect(centre(moved[1]!.placement, b.frame).y).toBeCloseTo(110, 6);
  const clamped = moveGroup([a, b], { x: 1000, y: -1000 });
  expect(centre(clamped[0]!.placement, a.frame).x - 500).toBeCloseTo(300, 6);
  expect(centre(clamped[1]!.placement, b.frame).x - 400).toBeCloseTo(300, 6);
  const other = reanchorPlacement(a.placement, a.frame, b.frame, b.placement.anchor);
  expect(centre(other, b.frame).x).toBeCloseTo(500, 6);
  let current = a.placement;
  for (let i = 0; i < 1000; i++) current = moveGroup([{ ...a, placement: current }], { x: i % 2 ? -1 : 1, y: 0 })[0]!.placement;
  expect(current).toEqual(a.placement);
});
