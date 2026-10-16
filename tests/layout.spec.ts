import { test, expect } from '@playwright/test';
import { alignSamples, distributeSamples, snapMove, type Alignment } from '../src/design/layout';
import { centre, groupBounds, placementBounds, type PlacementSample } from '../src/design/geometry';

const sample = (id: string, x = .3, y = .3, widthPx = 80, heightPx = 60): PlacementSample => ({ id,
  frame: { left: 0, top: 0, width: 1000, height: 800 }, placement: { anchor: { kind: 'viewport' }, x, y, widthPx, heightPx, rotationDeg: 0 } });
const viewport = { left: 0, top: 0, right: 1000, bottom: 800 };

test('snapping finds screen centre and all four edges within tolerance, without forcing distant placement', () => {
  const s = sample('a');
  for (const [delta, expected] of [
    [{ x: 196, y: 157 }, { x: 500, y: 400 }],
    [{ x: -257, y: -207 }, { x: 40, y: 30 }],
    [{ x: 657, y: 527 }, { x: 960, y: 770 }],
  ] as const) {
    const result = snapMove([s], delta, [viewport]);
    const point = centre(result.changes[0]!.placement, s.frame);
    expect(point.x).toBeCloseTo(expected.x, 6); expect(point.y).toBeCloseTo(expected.y, 6);
    expect(result.guides).toHaveLength(2);
  }
  const free = snapMove([s], { x: 100, y: 80 }, [viewport]);
  expect(free.guides).toEqual([]);
  expect(centre(free.changes[0]!.placement, s.frame)).toEqual({ x: 400, y: 320 });
});

test('player and other layer bounds snap mixed-anchor groups without adding relative error', () => {
  const a = sample('a'), b = { ...sample('b', .4, .5), frame: { left: 100, top: 50, width: 600, height: 400 } };
  const player = { left: 100, top: 50, right: 700, bottom: 450 };
  const other = { left: 655, top: 600, right: 755, bottom: 700 };
  const original = groupBounds([a, b])!;
  const delta = { x: other.left - original.right + 3, y: 117 };
  const result = snapMove([a, b], delta, [player, other]);
  const moved = result.changes.map((change) => ({ ...[a, b].find((sample) => sample.id === change.id)!, placement: change.placement }));
  expect(groupBounds(moved)!.right).toBeCloseTo(other.left, 6);
  const dxA = centre(moved[0]!.placement, a.frame).x - centre(a.placement, a.frame).x;
  const dxB = centre(moved[1]!.placement, b.frame).x - centre(b.placement, b.frame).x;
  expect(dxA).toBeCloseTo(dxB, 5);
  expect(result.guides.some((guide) => guide.axis === 'x' && guide.position === 655)).toBe(true);
  const atPlayer = snapMove([a], { x: 96, y: 8 }, [player]);
  expect(centre(atPlayer.changes[0]!.placement, a.frame).x).toBeCloseTo(400, 6);
});

test('alignment uses rotated visible bounds, preserves size and rejects impossible mixed-anchor layouts atomically', () => {
  const a = sample('a'), b = { ...sample('b', .6, .7, 100, 40), placement: { ...sample('b', .6, .7, 100, 40).placement, rotationDeg: 45 } };
  for (const mode of ['left', 'center-x', 'right', 'top', 'center-y', 'bottom'] as Alignment[]) {
    const changes = alignSamples([a, b], mode);
    const bounds = changes.map((change, i) => placementBounds(change.placement, [a, b][i]!.frame));
    const value = (b: typeof bounds[number]) => mode === 'left' ? b.left : mode === 'right' ? b.right : mode === 'center-x' ? (b.left + b.right) / 2 : mode === 'top' ? b.top : mode === 'bottom' ? b.bottom : (b.top + b.bottom) / 2;
    expect(value(bounds[0]!)).toBeCloseTo(value(bounds[1]!), 5);
    expect(changes[1]?.placement).toMatchObject({ widthPx: 100, heightPx: 40, rotationDeg: 45 });
  }
  const offscreen = { ...sample('offscreen'), frame: { left: 2000, top: 0, width: 100, height: 100 } };
  expect(() => alignSamples([a, offscreen], 'left')).toThrow('配置基準');
  expect(a.placement.x).toBe(.3);
});

test('distribution equalizes edge gaps for unequal sizes and rotated layers while fixing outer layers', () => {
  for (const direction of ['horizontal', 'vertical'] as const) {
    const samples = [sample('a', .15, .15, 40, 50), sample('b', .32, .38, 90, 70), sample('c', .8, .8, 150, 120)];
    const result = distributeSamples(samples, direction);
    expect(result[0]!.placement).toEqual(samples[0]!.placement); expect(result[2]!.placement).toEqual(samples[2]!.placement);
    const b = result.map((change, i) => placementBounds(change.placement, samples[i]!.frame));
    expect(direction === 'horizontal' ? b[1]!.left - b[0]!.right : b[1]!.top - b[0]!.bottom)
      .toBeCloseTo(direction === 'horizontal' ? b[2]!.left - b[1]!.right : b[2]!.top - b[1]!.bottom, 5);
  }
});
