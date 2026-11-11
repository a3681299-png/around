import { test, expect } from '@playwright/test';
import { DEFAULT_LIMITS, stepMover, wrapAngle, type Mover, type Path } from '../src/characters/locomotion';
import { footAtRest, stepFoot, STEP_DRIFT_M, type FootSample, type FootState } from '../src/characters/foot-plant';
import {
  approachIntent,
  reachCurve,
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
  // (Since the acting was added, a walk begins with a small sinking, the wind-up.)
  expect(phases).toEqual(['notice', 'windup', 'walk', 'settle', 'reach', 'hold', 'retract', 'recover', 'idle']);
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
  // (The hand now goes out quickly on purpose, about a tenth of the way in its fastest frame;
  // a jump would be several times that.)
  for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i]! - seen[i - 1]!)).toBeLessThan(0.12);
  // The uninterrupted reach is smooth too, and ends at rest.
  for (let i = 1; i < weights.length; i++) expect(Math.abs(weights[i]! - weights[i - 1]!)).toBeLessThan(0.12);
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
    'sit standUp idle notice windup walk settle reach hold retract recover idle toSeat sitDown sit',
  );
  expect(Math.hypot(state.mover.x - 1.5, state.mover.z + 1.2)).toBeLessThan(0.02);
  expect(Math.abs(wrapAngle(state.mover.heading - Math.PI / 2))).toBeLessThan(0.07);
  // Lowering and rising are gradual; it never walks while seated.
  for (let i = 1; i < seated.length; i++) expect(Math.abs(seated[i]! - seated[i - 1]!)).toBeLessThan(0.03);
  expect(approachIntent(state, undefined).pose).toBe('sit');
});

// --- acting: the same approach, played by mood ------------------------------------------------

const speeds: BodyReach = { ...body, walkSpeed: 0.64, runSpeed: 1.85 };
function play(mood: 'calm' | 'interest', target: Vec3, seconds = 20, seed = 1, cheerAt = Infinity) {
  let state = startApproach(0, 0, 0);
  const dt = 1 / 60;
  const phases: ApproachPhase[] = [];
  const frames: { t: number; phase: ApproachPhase; speed: number; intent: ReturnType<typeof approachIntent> }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    state = stepApproach(state, { dt, layout, body: speeds, mood, seed, target, cheer: t >= cheerAt ? 1 : 0 });
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    frames.push({ t, phase: state.phase, speed: state.mover.speed, intent: approachIntent(state, target) });
  }
  const at = (phase: ApproachPhase) => frames.find((f) => f.phase === phase)?.t ?? Infinity;
  return { state, phases, frames, at };
}

test('interest meets a thing behind it with a start, a wind-up, a hop round, a dart and a hard stop', () => {
  const behind: Vec3 = [-0.6, 1.0, -1.4];
  const eager = play('interest', behind);
  const calm = play('calm', behind);
  expect(eager.phases).toEqual([
    'notice',
    'windup',
    'pivot',
    'walk',
    'settle',
    'reach',
    'hold',
    'retract',
    'recover',
    'idle',
  ]);
  // A calm body steps round as it walks: it never leaves the floor.
  expect(calm.phases).not.toContain('pivot');
  expect(calm.frames.every((f) => f.intent.hop === undefined)).toBe(true);
  // The start: the ears' moment is at the notice and is over before the body moves.
  const notice = eager.frames.filter((f) => f.phase === 'notice');
  expect(notice[0]!.intent.alert).toBeGreaterThan(0.9);
  expect(notice[notice.length - 1]!.intent.alert).toBe(0);
  // The wind-up sinks all the way for interest, a little for calm, and nothing moves meanwhile.
  const sunk = (run: typeof eager) =>
    Math.max(...run.frames.filter((f) => f.phase === 'windup').map((f) => f.intent.crouch));
  expect(sunk(eager)).toBeGreaterThan(0.9);
  expect(sunk(calm)).toBeGreaterThan(0.2);
  expect(sunk(calm)).toBeLessThan(0.5);
  expect(eager.frames.filter((f) => f.phase === 'windup').every((f) => f.speed === 0)).toBe(true);
  // The hop round goes up and comes down, and ends facing the way to go.
  const hop = eager.frames.filter((f) => f.phase === 'pivot').map((f) => f.intent.hop!);
  expect(hop[0]!).toBeLessThan(0.1);
  expect(hop[hop.length - 1]!).toBeGreaterThan(0.9);
  // The dart: several times the calm walk's pace, there far sooner, and at rest at the end.
  const peak = (run: typeof eager) => Math.max(...run.frames.map((f) => f.speed));
  expect(peak(eager)).toBeGreaterThan(peak(calm) * 2.5);
  expect(eager.at('hold')).toBeLessThan(calm.at('hold') - 1.5);
  expect(eager.state.mover.speed).toBe(0);
  // Both end where a hand reaches the thing.
  for (const run of [eager, calm])
    expect(Math.hypot(behind[0] - run.state.mover.x, behind[2] - run.state.mover.z)).toBeLessThanOrEqual(body.arm);
});

test('the hand draws back, goes out past the thing and comes to rest on it', () => {
  for (const eager of [false, true]) {
    const curve = Array.from({ length: 101 }, (_, i) => reachCurve(i / 100, eager));
    expect(curve[0]).toBe(0);
    expect(Math.min(...curve)).toBeLessThan(-0.05);
    expect(Math.max(...curve)).toBeGreaterThan(1.01);
    expect(Math.max(...curve)).toBeLessThan(1.2);
    expect(curve[100]).toBeCloseTo(1, 6);
  }
  // Eagerness presses further.
  const most = (eager: boolean) => Math.max(...Array.from({ length: 101 }, (_, i) => reachCurve(i / 100, eager)));
  expect(most(true)).toBeGreaterThan(most(false));
});

test('gladness: two hops with a sinking before each, then standing again; never in mid-walk', () => {
  const target: Vec3 = [0.9, 0.9, 0.9];
  // Asked for while it is still walking: it waits for the touch.
  const early = play('interest', target, 12, 1, 1.2);
  expect(early.phases.indexOf('cheer')).toBeGreaterThan(early.phases.indexOf('hold'));
  const cheer = early.frames.filter((f) => f.phase === 'cheer');
  expect(cheer.every((f) => f.speed === 0)).toBe(true);
  // Two separate times off the floor.
  let hops = 0;
  for (let i = 1; i < cheer.length; i++)
    if (cheer[i]!.intent.hop !== undefined && cheer[i - 1]!.intent.hop === undefined) hops++;
  expect(hops).toBe(2);
  expect(Math.max(...cheer.map((f) => f.intent.joy))).toBe(1);
  expect(Math.max(...cheer.map((f) => f.intent.crouch))).toBeGreaterThan(0.8);
  expect(early.state.phase).toBe('idle');
  expect(approachIntent(early.state, target).joy).toBe(0);
  // The thing it was glad about is done with: it is not gone to again.
  expect(early.phases.filter((p) => p === 'notice')).toHaveLength(1);
});

test('the beats vary from one seed to another, within bounds, and a seed always plays the same', () => {
  const target: Vec3 = [1.2, 1.0, -0.8];
  const noticeFor = (seed: number) => {
    const run = play('calm', target, 6, seed);
    return run.at('windup') - run.at('notice');
  };
  const lengths = [1, 2, 3, 4, 5, 6].map(noticeFor);
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.08);
  for (const seconds of lengths) {
    expect(seconds).toBeGreaterThan(0.85 * 0.8 - 0.03);
    expect(seconds).toBeLessThan(0.85 * 1.25 + 0.03);
  }
  const a = play('interest', target, 8, 7),
    b = play('interest', target, 8, 7);
  expect(a.frames.map((f) => [f.phase, f.speed])).toEqual(b.frames.map((f) => [f.phase, f.speed]));
});

test('an eager walk leaves in a curve where a calm one turns first', () => {
  // The way to go is a quarter turn off: with a wide turn-first angle the body is already moving
  // while it still faces well off the way.
  const side: Path = [[2, 0]];
  const moving = (turnFirst: number | undefined) => {
    let mover = still(0),
      path = side;
    for (let i = 0; i < 600; i++) {
      const result = stepMover(mover, path, 1 / 60, { ...DEFAULT_LIMITS, ...(turnFirst ? { turnFirst } : {}) });
      mover = result.mover;
      path = result.path;
      if (Math.hypot(mover.x, mover.z) > 0.05) return Math.abs(wrapAngle(Math.PI / 2 - mover.heading));
    }
    return 0;
  };
  expect(moving(undefined)).toBeLessThan(Math.PI / 3);
  expect(moving(1.9)).toBeGreaterThan(moving(undefined) + 0.2);
});
