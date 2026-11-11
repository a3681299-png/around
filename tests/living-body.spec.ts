import { test, expect } from '@playwright/test';
import { DEFAULT_LIMITS, stepMover, wrapAngle, type Mover, type Path } from '../src/characters/locomotion';
import { footAtRest, stepFoot, STEP_DRIFT_M, type FootSample, type FootState } from '../src/characters/foot-plant';
import {
  approachIntent,
  standoff,
  startApproach,
  stepApproach,
  type ApproachPhase,
  type ApproachState,
  type BodyReach,
} from '../src/characters/approach';
import type { Vec3 } from '../src/characters/two-bone-ik';
import type { RoomLayout } from '../src/world/room-life';

// --- walking to a point ---------------------------------------------------------------------

const still = (heading = 0): Mover => ({ x: 0, z: 0, heading, speed: 0, turn: 0 });
function walk(from: Mover, path: Path, dt: number, seconds = 20) {
  let mover = from,
    left = path,
    t = 0,
    peak = 0,
    peakAccel = 0,
    peakTurn = 0;
  const trace: Mover[] = [];
  while (t < seconds) {
    const result = stepMover(mover, left, dt);
    peakAccel = Math.max(peakAccel, Math.abs(result.mover.speed - mover.speed) / dt);
    peakTurn = Math.max(peakTurn, Math.abs(wrapAngle(result.mover.heading - mover.heading)) / dt);
    mover = result.mover;
    left = result.path;
    peak = Math.max(peak, mover.speed);
    trace.push(mover);
    t += dt;
    if (result.arrived) break;
  }
  return { mover, t, peak, peakAccel, peakTurn, trace };
}

test('a walk eases in, never exceeds its pace, and stops on the point without a jolt', () => {
  const run = walk(still(), [[0, 2]], 1 / 60);
  expect(Math.hypot(run.mover.x, run.mover.z - 2)).toBeLessThan(0.015);
  expect(run.mover.speed).toBe(0);
  expect(run.peak).toBeGreaterThan(DEFAULT_LIMITS.maxSpeed * 0.95);
  expect(run.peak).toBeLessThanOrEqual(DEFAULT_LIMITS.maxSpeed + 1e-9);
  // Speed changes stay within what the limits allow (the stop is a slowing, not a wall).
  expect(run.peakAccel).toBeLessThanOrEqual(DEFAULT_LIMITS.decel * 1.5 + 1e-6);
  // The last frames before the stop are slow.
  expect(run.trace[run.trace.length - 3]!.speed).toBeLessThan(0.25);
});

test('the same walk comes out at 24, 60 and 144 frames a second', () => {
  const path: Path = [
    [0.6, 1.2],
    [1.5, 1.4],
  ];
  const runs = [1 / 24, 1 / 60, 1 / 144].map((dt) => walk(still(), path, dt));
  for (const run of runs) {
    expect(Math.hypot(run.mover.x - 1.5, run.mover.z - 1.4)).toBeLessThan(0.02);
    expect(Math.abs(run.t - runs[1]!.t)).toBeLessThan(0.12);
  }
});

test('facing away, the body turns on the spot first, at no more than its turn rate', () => {
  const run = walk(still(0), [[0, -2]], 1 / 60);
  const turned = run.trace.findIndex((m) => Math.abs(wrapAngle(Math.PI - m.heading)) < Math.PI / 3);
  // Until it faces the way (within 60°) it has not left its place.
  const before = run.trace[turned - 1]!;
  expect(Math.hypot(before.x, before.z)).toBeLessThan(0.03);
  expect(run.peakTurn).toBeLessThanOrEqual(DEFAULT_LIMITS.turnRate + 1e-6);
  expect(Math.hypot(run.mover.x, run.mover.z + 2)).toBeLessThan(0.015);
});

// --- feet that stay where they are --------------------------------------------------------------

const sample = (x: number, z: number, rise = 0, yaw = 0): FootSample => ({
  ankle: [x, 0.08 + rise, z - 0.1],
  toe: [x, 0.02 + rise, z],
  ankleRise: rise,
  toeRise: rise,
  yaw,
});
const contact = (state: FootState, s: FootSample) => [s.toe[0] + state.dx, s.toe[2] + state.dz];

test('a foot on the floor stays on its spot while the body moves over it', () => {
  let foot = stepFoot(footAtRest(), sample(0, 0), 1 / 60, true);
  expect(foot.down).toBe(true);
  // The motion drags the foot 4 cm (a blend's slide): the correction holds the contact still.
  for (let i = 1; i <= 8; i++) {
    const s = sample(i * 0.005, i * -0.002);
    foot = stepFoot(foot, s, 1 / 60, true);
    const [x, z] = contact(foot, s);
    expect(Math.hypot(x!, z!)).toBeLessThan(1e-9);
  }
  expect(foot.step).toBeUndefined();
});

test('left too far behind, the foot steps to where the motion wants it, lifting on the way', () => {
  let foot = stepFoot(footAtRest(), sample(0, 0), 1 / 60, true);
  const far = sample(STEP_DRIFT_M + 0.03, 0);
  foot = stepFoot(foot, far, 1 / 60, true);
  expect(foot.step).toBe(0);
  let lifted = 0,
    last = Math.hypot(foot.dx, foot.dz);
  for (let i = 0; i < 40 && foot.step !== undefined; i++) {
    foot = stepFoot(foot, far, 1 / 60, true);
    lifted = Math.max(lifted, foot.lift);
    // The correction only shrinks (the foot travels one way, no snap).
    expect(Math.hypot(foot.dx, foot.dz)).toBeLessThanOrEqual(last + 1e-9);
    last = Math.hypot(foot.dx, foot.dz);
  }
  expect(foot.step).toBeUndefined();
  expect(lifted).toBeGreaterThan(0.02);
  expect(Math.hypot(foot.dx, foot.dz)).toBe(0);
  expect(foot.lift).toBe(0);
});

test('a turn of the body alone also makes the foot step; never while the other foot is stepping', () => {
  let foot = stepFoot(footAtRest(), sample(0, 0), 1 / 60, true);
  const turned = sample(0, 0, 0, 0.8);
  const waiting = stepFoot(foot, turned, 1 / 60, false);
  expect(waiting.step).toBeUndefined();
  // Held meanwhile: the foot keeps its own turn on the floor.
  expect(waiting.dyaw).toBeCloseTo(-0.8, 6);
  foot = stepFoot(waiting, turned, 1 / 60, true);
  expect(foot.step).toBe(0);
});

test('lifting off lets the correction go without a jump; heel to toe keeps it', () => {
  let foot = stepFoot(footAtRest(), sample(0, 0), 1 / 60, true);
  foot = stepFoot(foot, sample(0.05, 0), 1 / 60, true);
  expect(foot.dx).toBeCloseTo(-0.05, 9);
  // The toes come up while the ankle stays down (a heel strike seen backwards): same correction.
  const heel: FootSample = { ...sample(0.05, 0), toeRise: 0.06 };
  foot = stepFoot(foot, heel, 1 / 60, true);
  expect(foot.contact).toBe('ankle');
  expect(foot.dx).toBeCloseTo(-0.05, 9);
  // In the air: released over a few frames, each a little less.
  const air = sample(0.05, 0, 0.08);
  const first = stepFoot(foot, air, 1 / 60, true);
  expect(first.down).toBe(false);
  expect(Math.abs(first.dx)).toBeLessThan(0.05);
  expect(Math.abs(first.dx)).toBeGreaterThan(0.03);
  let later = first;
  for (let i = 0; i < 30; i++) later = stepFoot(later, air, 1 / 60, true);
  expect(Math.abs(later.dx)).toBeLessThan(1e-3);
});

// --- noticing, walking up, touching ----------------------------------------------------------

// A 4 m square of floor about the origin.
const layout: RoomLayout = {
  floorY: 0,
  floor: [
    [-2, -2, 2, -2, 2, 2],
    [-2, -2, 2, 2, -2, 2],
  ],
  spots: [],
};
const body: BodyReach = { arm: 0.45, shoulderHeight: 0.93, shoulderHalf: 0.07 };
function live(target: (t: number) => Vec3 | undefined, seconds: number, dt = 1 / 60, from = startApproach(0, 0, 0)) {
  let state: ApproachState = from;
  const phases: ApproachPhase[] = [];
  const weights: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const at = target(t);
    state = stepApproach(state, { dt, layout, body, ...(at ? { target: at } : {}) });
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    weights.push(approachIntent(state, at).reachWeight);
  }
  return { state, phases, weights };
}

test('a thing appears: it is noticed, walked up to, faced, touched, and the body stands again', () => {
  const target: Vec3 = [1.2, 1.0, -0.8];
  const { state, phases } = live(() => target, 20);
  // (It notices in the first frame the thing is there.)
  expect(phases).toEqual(['notice', 'walk', 'settle', 'reach', 'hold', 'retract', 'recover', 'idle']);
  // It stands where a hand reaches the thing, facing it.
  const flat = Math.hypot(target[0] - state.mover.x, target[2] - state.mover.z);
  expect(flat).toBeCloseTo(standoff(target, body, 0), 1);
  const face = Math.atan2(target[0] - state.mover.x, target[2] - state.mover.z);
  expect(Math.abs(wrapAngle(face - state.mover.heading))).toBeLessThan(0.08);
  expect(state.mover.speed).toBe(0);
});

test('where it stands and which way it faces follow the target, wherever that is', () => {
  const ends = (
    [
      [1.2, 1.0, -0.8],
      [-1.0, 0.5, 1.1],
      [0.3, 1.2, 1.5],
    ] as Vec3[]
  ).map((target) => {
    const { state, phases } = live(() => target, 20);
    expect(phases).toContain('hold');
    // A low or high thing is stood closer to than one at the shoulder's height.
    expect(Math.hypot(target[0] - state.mover.x, target[2] - state.mover.z)).toBeLessThanOrEqual(body.arm);
    return state.mover;
  });
  expect(Math.hypot(ends[0]!.x - ends[1]!.x, ends[0]!.z - ends[1]!.z)).toBeGreaterThan(1);
  expect(Math.abs(wrapAngle(ends[0]!.heading - ends[1]!.heading))).toBeGreaterThan(1);
  expect(standoff([0, 0.4, 0], body, 0)).toBeLessThan(standoff([0, 0.93, 0], body, 0));
});

test('the thing moves while it is being walked to: the walk follows it', () => {
  const first: Vec3 = [1.5, 1.0, 0],
    second: Vec3 = [-1.2, 1.0, 1.2];
  const { state, phases } = live((t) => (t < 2.2 ? first : second), 25);
  expect(phases).toContain('hold');
  expect(Math.hypot(second[0] - state.mover.x, second[2] - state.mover.z)).toBeLessThanOrEqual(body.arm + 0.02);
});

test('the thing vanishes mid-reach: the hand comes back from where it was, without a jump', () => {
  const target: Vec3 = [0, 1.0, 0.9];
  let gone = Infinity;
  const { state, phases, weights } = live((t) => (t < gone ? target : undefined), 12);
  expect(phases).toContain('hold');
  // Again, taking it away a third of a second into the reach.
  const dt = 1 / 60;
  let s = startApproach(0, 0, 0);
  const seen: number[] = [];
  for (let t = 0; t < 12; t += dt) {
    const at = t < gone ? target : undefined;
    s = stepApproach(s, { dt, layout, body, ...(at ? { target: at } : {}) });
    if (s.phase === 'reach' && gone === Infinity && s.t - s.since > 0.33) gone = t + dt;
    seen.push(approachIntent(s, at).reachWeight);
  }
  expect(s.phase).toBe('idle');
  expect(Math.max(...seen)).toBeLessThan(0.9);
  for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(0.06);
  // The uninterrupted reach is smooth too, and ends at rest.
  for (let i = 1; i < weights.length; i++) expect(Math.abs(weights[i]! - weights[i - 1]!)).toBeLessThan(0.06);
  expect(state.phase).toBe('idle');
});

test('a thing no floor is near is looked at, not walked into; a touched thing is not touched twice', () => {
  const away = live(() => [9, 1, 9], 8);
  expect(away.phases).toEqual(['notice']);
  expect(Math.hypot(away.state.mover.x, away.state.mover.z)).toBe(0);
  expect(approachIntent(away.state, [9, 1, 9]).lookWeight).toBe(1);

  const target: Vec3 = [0, 1.0, 0.9];
  const once = live(() => target, 14);
  const again = live(() => target, 6, 1 / 60, once.state);
  expect(again.phases).toEqual(['idle']);
  // Moved, it is new again.
  const moved = live(() => [0.6, 1.0, 0.9], 14, 1 / 60, once.state);
  expect(moved.phases).toContain('hold');
});

test('with nothing to notice it goes and sits; a thing appearing gets it up, touched, and it sits again', () => {
  const seat = { x: 1.2, y: 0.45, z: -1.2, heading: Math.PI / 2, stand: [1.5, -1.2] as const };
  const target: Vec3 = [-0.8, 1.0, 0.6];
  let state = startApproach(0, 0, 0);
  const phases: ApproachPhase[] = [];
  const seated: number[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < 40; t += dt) {
    // The thing shows up once the body has been seated a while.
    const at =
      phases.includes('sit') && state.phase !== 'toSeat' && phases.filter((p) => p === 'sit').length < 2 && t > 12
        ? target
        : undefined;
    state = stepApproach(state, { dt, layout, body, seat, ...(at ? { target: at } : {}) });
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    seated.push(approachIntent(state, at).seated);
  }
  expect(phases.slice(0, 3)).toEqual(['toSeat', 'sitDown', 'sit']);
  // It sat down facing the way the seat faces, from the floor in front of it.
  expect(phases.join(' ')).toContain(
    'sit standUp idle notice walk settle reach hold retract recover idle toSeat sitDown sit',
  );
  expect(Math.hypot(state.mover.x - 1.5, state.mover.z + 1.2)).toBeLessThan(0.02);
  expect(Math.abs(wrapAngle(state.mover.heading - Math.PI / 2))).toBeLessThan(0.07);
  // Lowering and rising are gradual; it never walks while seated.
  for (let i = 1; i < seated.length; i++) expect(Math.abs(seated[i]! - seated[i - 1]!)).toBeLessThan(0.03);
  expect(approachIntent(state, undefined).pose).toBe('sit');
});
