import {
  centre,
  groupBounds,
  moveGroup,
  movePlacement,
  placementBounds,
  type Bounds,
  type PlacementSample,
  type PlacementChange,
  type Point,
} from './geometry';

export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type Distribution = 'horizontal' | 'vertical';
export interface Guide {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}
const coordinates = (b: Bounds, axis: 'x' | 'y') =>
  axis === 'x' ? [(b.left + b.right) / 2, b.left, b.right] : [(b.top + b.bottom) / 2, b.top, b.bottom];

/** All comparisons use screen CSS pixels, including mixed-anchor and rotated layers. */
export function snapMove(
  samples: readonly PlacementSample[],
  delta: Point,
  targets: readonly Bounds[],
  threshold = 6,
): { changes: PlacementChange[]; guides: Guide[] } {
  const initial = moveGroup(samples, delta);
  const bounds = groupBounds(samples.map((sample, index) => ({ ...sample, placement: initial[index]!.placement })));
  if (!bounds) return { changes: initial, guides: [] };
  const matches: Array<{ axis: 'x' | 'y'; difference: number; position: number; target: Bounds }> = [];
  for (const axis of ['x', 'y'] as const) {
    let match: (typeof matches)[number] | undefined;
    for (const target of targets)
      for (const position of coordinates(target, axis))
        for (const value of coordinates(bounds, axis)) {
          const difference = position - value;
          if (Math.abs(difference) <= threshold && (!match || Math.abs(difference) < Math.abs(match.difference)))
            match = { axis, difference, position, target };
        }
    if (match) matches.push(match);
  }
  // Use the already-clamped common delta, so a boundary doesn't introduce group drift.
  const origin = centre(samples[0]!.placement, samples[0]!.frame),
    moved = centre(initial[0]!.placement, samples[0]!.frame);
  const changes = moveGroup(samples, {
    x: moved.x - origin.x + (matches.find((m) => m.axis === 'x')?.difference ?? 0),
    y: moved.y - origin.y + (matches.find((m) => m.axis === 'y')?.difference ?? 0),
  });
  const result = groupBounds(samples.map((sample, index) => ({ ...sample, placement: changes[index]!.placement })))!;
  const guides = matches
    .filter((match) => coordinates(result, match.axis).some((value) => Math.abs(value - match.position) < 0.00001))
    .map(({ axis, position, target }) => ({
      axis,
      position,
      from: axis === 'x' ? Math.min(result.top, target.top) : Math.min(result.left, target.left),
      to: axis === 'x' ? Math.max(result.bottom, target.bottom) : Math.max(result.right, target.right),
    }));
  return { changes, guides };
}

function translate(sample: PlacementSample, delta: Point): PlacementChange {
  const { placement: p, frame: f } = sample;
  const x = p.x + delta.x / f.width,
    y = p.y + delta.y / f.height;
  if (x < -1e-9 || x > 1 + 1e-9 || y < -1e-9 || y > 1 + 1e-9)
    throw new Error('配置基準の範囲内に整列できません。基準や位置を調整してください。');
  return { id: sample.id, placement: movePlacement(p, f, delta) };
}

/** Align within the eligible selection; locked/hidden layers are filtered by the caller. */
export function alignSamples(samples: readonly PlacementSample[], mode: Alignment): PlacementChange[] {
  if (samples.length < 2) return [];
  const bounds = groupBounds(samples)!;
  return samples.map((sample) => {
    const b = placementBounds(sample.placement, sample.frame);
    const x =
      mode === 'left'
        ? bounds.left - b.left
        : mode === 'right'
          ? bounds.right - b.right
          : mode === 'center-x'
            ? (bounds.left + bounds.right - b.left - b.right) / 2
            : 0;
    const y =
      mode === 'top'
        ? bounds.top - b.top
        : mode === 'bottom'
          ? bounds.bottom - b.bottom
          : mode === 'center-y'
            ? (bounds.top + bounds.bottom - b.top - b.bottom) / 2
            : 0;
    return translate(sample, { x, y });
  });
}

/** Equal visible gaps; outer layers stay fixed, including when gaps are negative. */
export function distributeSamples(samples: readonly PlacementSample[], direction: Distribution): PlacementChange[] {
  if (samples.length < 3) return [];
  const horizontal = direction === 'horizontal';
  const start = (b: Bounds) => (horizontal ? b.left : b.top);
  const end = (b: Bounds) => (horizontal ? b.right : b.bottom);
  const entries = samples
    .map((sample) => ({ sample, bounds: placementBounds(sample.placement, sample.frame) }))
    .sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = entries[0]!,
    last = entries.at(-1)!;
  const gap =
    (end(last.bounds) -
      start(first.bounds) -
      entries.reduce((sum, { bounds }) => sum + end(bounds) - start(bounds), 0)) /
    (entries.length - 1);
  let cursor = start(first.bounds);
  return entries.map(({ sample, bounds }, index) => {
    const delta = index === 0 || index === entries.length - 1 ? 0 : cursor - start(bounds);
    cursor += end(bounds) - start(bounds) + gap;
    return translate(sample, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta });
  });
}
