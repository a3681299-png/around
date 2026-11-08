import { test, expect } from '@playwright/test';
import {
  floorPath,
  onFloor,
  residentPose,
  startResident,
  stepResident,
  type ResidentInput,
  type ResidentState,
  type RoomLayout,
} from '../src/world/room-life';

/**
 * The character's life in the room (docs/living-room.md): pure and deterministic. A 4 × 4 m floor
 * with a desk-sized hole in the middle, a seat, a hiding place and a standing place.
 */
const square = (x0: number, z0: number, x1: number, z1: number) => [
  [x0, z0, x1, z0, x1, z1],
  [x0, z0, x1, z1, x0, z1],
];
// The floor around a hole from (−0.5, −2.5) to (0.5, −1.5).
const layout: RoomLayout = {
  floorY: 0,
  floor: [
    ...square(-2, -4, 2, -2.5),
    ...square(-2, -1.5, 2, 0),
    ...square(-2, -2.5, -0.5, -1.5),
    ...square(0.5, -2.5, 2, -1.5),
  ],
  spots: [
    { id: 'chair', kind: 'sit', x: 1.2, y: 0.5, z: -3.2, heading: 0 },
    { id: 'desk', kind: 'hide', x: 0, y: 0, z: -2.8, heading: Math.PI },
    { id: 'window', kind: 'stand', x: -1.5, y: 0, z: -0.5, heading: 0 },
  ],
};
const input = (extra: Partial<ResidentInput> = {}): ResidentInput => ({
  dt: 0.1,
  layout,
  seen: () => 1,
  roomSeen: 1,
  flat: false,
  front: 1,
  nearFront: false,
  reducedMotion: false,
  ...extra,
});
const run = (from: ResidentState, seconds: number, extra: Partial<ResidentInput> = {}, seed = 7) => {
  let s = from;
  const trace: ResidentState[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    s = stepResident(s, input(extra), seed);
    trace.push(s);
  }
  return { s, trace };
};

test('the floor test and a path around the hole, every point of it on the floor', () => {
  expect(onFloor(layout, 0, -2)).toBe(false);
  expect(onFloor(layout, 0, -1)).toBe(true);
  const path = floorPath(layout, [0, -1], [0, -3]);
  expect(path.length).toBeGreaterThan(1);
  let at: readonly [number, number] = [0, -1];
  for (const point of path) {
    for (let i = 0; i <= 20; i++) {
      const x = at[0] + ((point[0] - at[0]) * i) / 20,
        z = at[1] + ((point[1] - at[1]) * i) / 20;
      expect(onFloor(layout, x, z), `${x},${z}`).toBe(true);
    }
    at = point;
  }
  expect(at).toEqual([0, -3]);
  // A straight line when nothing is in the way.
  expect(floorPath(layout, [-1.5, -0.5], [1.5, -0.5])).toEqual([[1.5, -0.5]]);
});

test('the same seed and inputs give the same life; another seed another', () => {
  const a = run(startResident(layout, 1), 60).trace.map((s) => [s.activity, s.spot, s.x.toFixed(3)]);
  const b = run(startResident(layout, 1), 60).trace.map((s) => [s.activity, s.spot, s.x.toFixed(3)]);
  expect(a).toEqual(b);
  const c = run(startResident(layout, 1), 60, {}, 99).trace.map((s) => [s.activity, s.spot, s.x.toFixed(3)]);
  expect(c).not.toEqual(a);
});

test('it walks on the floor only, sits down at a seat, stands up before walking, and never slides seated', () => {
  const { trace } = run(startResident(layout, 3), 240);
  const kinds = new Set(trace.map((s) => s.activity));
  for (const kind of ['walk', 'sitDown', 'sit', 'standUp', 'hide'] as const) expect(kinds, kind).toContain(kind);
  for (const s of trace) {
    if (s.activity === 'walk') expect(onFloor(layout, s.x, s.z), `${s.x},${s.z}`).toBe(true);
  }
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1]!,
      b = trace[i]!;
    // Seated means still: a seat is left only by standing up first.
    if (a.activity === 'sit') expect(['sit', 'standUp']).toContain(b.activity);
    if (b.activity === 'walk' && a.activity !== 'walk') expect(['idle', 'hide']).toContain(a.activity);
    // No jumps on foot (a walk step is at most 0.85 m/s × 0.1 s).
    if (a.activity === 'walk' && b.activity === 'walk') expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.09);
  }
});

test('the pose: the hips go down to the seat over the sit-down, seated at the seat, the feet on the floor otherwise', () => {
  const { trace } = run(startResident(layout, 3), 240);
  // The first sit-down, start to end.
  const first = trace.findIndex((s) => s.activity === 'sitDown');
  const end = trace.findIndex((s, i) => i > first && s.activity !== 'sitDown');
  const down = trace.slice(first, end).map((s) => residentPose(s, layout).seat);
  expect(down[0]).toBeLessThan(0.2);
  expect(down.at(-1)).toBeGreaterThan(0.8);
  for (let i = 1; i < down.length; i++) expect(down[i]).toBeGreaterThanOrEqual(down[i - 1]!);
  const seated = trace.find((s) => s.activity === 'sit')!;
  expect(residentPose(seated, layout)).toMatchObject({ clip: 'sit', seat: 1, seatY: 0.5, x: 1.2, z: -3.2 });
  const walking = trace.find((s) => s.activity === 'walk')!;
  expect(residentPose(walking, layout)).toMatchObject({ clip: 'walk', seat: 0, y: 0 });
});

test('the room hidden for a while: it goes to the front (standing up first), and comes back when the room opens', () => {
  const seated = startResident(layout, 5);
  expect(seated.activity).toBe('sit');
  const away = run(seated, 6, { roomSeen: 0.05 });
  const order = [...new Set(away.trace.map((s) => s.activity))];
  expect(order).toEqual(['sit', 'standUp', 'leave', 'front']);
  expect(residentPose(away.s, layout)).toMatchObject({ visible: false });
  // A fade by default (far), a hop only when the Host says the two places are near.
  expect(away.trace.find((s) => s.activity === 'leave')!.via).toBe('fade');
  const back = run(away.s, 4, { roomSeen: 0.8 });
  const activities = back.trace.map((s) => s.activity);
  expect(activities).toContain('arrive');
  expect(activities.at(-1)).not.toBe('front');
  // Never to the front when the artwork says so.
  expect(run(seated, 20, { roomSeen: 0, front: 0 }).trace.some((s) => s.activity === 'front')).toBe(false);
});

test('while the room looks flat it may be somewhere else unseen; never while the room is open', () => {
  const s = startResident(layout, 11);
  const flat = run(s, 40, { flat: true }).trace;
  const swaps = flat.filter((x, i) => i && x.swappedAt !== flat[i - 1]!.swappedAt);
  expect(swaps.length).toBeGreaterThan(0);
  // A swap lands settled (seated or at its place), not mid-walk.
  for (const x of swaps) expect(['sit', 'hide', 'idle']).toContain(x.activity);
  const open = run(s, 40, { flat: false }).trace;
  expect(open.every((x) => x.swappedAt === -Infinity)).toBe(true);
});

test('places the viewer sees are chosen more often', () => {
  const visits = (seen: (id: string) => number) => {
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 30; seed++) {
      const spots = run(startResident(layout, seed), 120, { seen: (spot) => seen(spot.id) }, seed).trace;
      for (let i = 1; i < spots.length; i++)
        if (spots[i]!.activity === 'walk' && spots[i - 1]!.activity !== 'walk')
          counts[spots[i]!.spot!] = (counts[spots[i]!.spot!] ?? 0) + 1;
    }
    return counts;
  };
  const counts = visits((id) => (id === 'window' ? 1 : 0));
  expect(counts['window']!).toBeGreaterThan((counts['desk'] ?? 0) * 1.5);
});
