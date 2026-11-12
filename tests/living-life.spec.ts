import { test, expect } from '@playwright/test';
import {
  approachIntent,
  startApproach,
  stepApproach,
  DIVE,
  RISE_S,
  type ApproachPhase,
  type BodyReach,
  type Seat,
} from '../src/characters/approach';
import { wrapAngle } from '../src/characters/locomotion';
import { phoneIntent, startPhone, stepPhone, type PhonePhase, type PhoneState } from '../src/characters/phone-routine';
import { cordLength, makeCord, stepCord, type Cord } from '../src/characters/cord';
import { CHAIR, startChair, stepChair } from '../src/living-room/chair-give';
import type { Vec3 } from '../src/characters/two-bone-ik';
import type { RoomLayout } from '../src/world/room-life';

// The everyday life of the room (docs/living-life.md): lying on the bed, the phone and its
// earphones, the chair that gives. Behaviour and physics only (pure, fixed clocks); the page
// draws it.

const layout: RoomLayout = {
  floorY: 0,
  floor: [
    [-2, -2, 2, -2, 2, 2],
    [-2, -2, 2, 2, -2, 2],
  ],
  spots: [],
};
const body: BodyReach = { arm: 0.45, shoulderHeight: 0.93, shoulderHalf: 0.07 };

// --- the bed: a dive, lying, getting up -------------------------------------------------------

// A bed along +X of the floor: the body stands beside it, dives on and lies with its head to -Z.
const bed: Seat = {
  x: 1.2,
  y: 0.5,
  z: -0.6,
  heading: -Math.PI / 2,
  stand: [0.5, -0.6],
  lie: { x: 1.35, y: 0.55, z: -0.9, heading: Math.PI },
};

function day(seconds: number, seat: (t: number) => Seat | undefined, dt = 1 / 60) {
  let state = startApproach(0.5, -0.2, 0);
  const phases: ApproachPhase[] = [];
  const frames: ReturnType<typeof approachIntent>[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const s = seat(t);
    state = stepApproach(state, { dt, layout, body, ...(s ? { seat: s } : {}) });
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    frames.push(approachIntent(state, undefined));
  }
  return { state, phases, frames };
}

test('a bed to lie on: it walks beside it, dives on, and lies where the bed says, head first', () => {
  const { state, phases, frames } = day(8, () => bed);
  expect(phases).toEqual(['toSeat', 'dive', 'lie']);
  // Lying on the spot the bed gives, facing (head) its way.
  expect(Math.hypot(state.mover.x - bed.lie!.x, state.mover.z - bed.lie!.z)).toBeLessThan(0.02);
  expect(Math.abs(wrapAngle(state.mover.heading - bed.lie!.heading))).toBeLessThan(0.05);
  const last = frames[frames.length - 1]!;
  expect(last.pose).toBe('lie');
  expect(last.lie).toBe(1);
  expect(last.lieAt).toEqual([bed.lie!.x, bed.lie!.y, bed.lie!.z]);
  // The dive leaves the floor (an arc), and the body turns flat in the air, not on the bed.
  const dive = frames.filter((f) => f.pose === 'dive');
  expect(Math.max(...dive.map((f) => ((f.hop ?? 0) > 0 ? f.hopHeight : 0)))).toBeGreaterThan(0.2);
  const landing = dive.findIndex((f) => f.landed > 0);
  expect(landing).toBeGreaterThan(0);
  expect(dive[landing]!.lie).toBeGreaterThan(0.85);
  // Nothing jumps from one frame to the next.
  for (let i = 1; i < frames.length; i++) {
    expect(Math.abs(frames[i]!.lie - frames[i - 1]!.lie)).toBeLessThan(0.08);
    expect(Math.hypot(frames[i]!.x - frames[i - 1]!.x, frames[i]!.z - frames[i - 1]!.z)).toBeLessThan(0.06);
  }
  // Settled, the legs swing (the lying loop's own play).
  expect(Math.max(...frames.slice(-60).map((f) => f.kickLegs))).toBeGreaterThan(0.5);
});

test('the bed taken away: it gets up and stands beside the bed again', () => {
  const { state, phases, frames } = day(14, (t) => (t < 7 ? bed : undefined));
  expect(phases).toEqual(['toSeat', 'dive', 'lie', 'rise', 'idle']);
  expect(Math.hypot(state.mover.x - bed.stand[0], state.mover.z - bed.stand[1])).toBeLessThan(0.02);
  const rising = frames.filter((f) => f.pose === 'rise').map((f) => f.lie);
  expect(rising.length).toBeGreaterThan(RISE_S * 50);
  for (let i = 1; i < rising.length; i++) expect(rising[i]!).toBeLessThanOrEqual(rising[i - 1]! + 1e-9);
  expect(rising[rising.length - 1]!).toBeLessThan(0.05);
});

test('sent from the chair to the bed: it stands up, walks round, dives on; and back to sit again', () => {
  const chair: Seat = { x: -1, y: 0.45, z: 0.8, heading: Math.PI, stand: [-1, 0.45] };
  const { state, phases } = day(26, (t) => (t < 8 ? chair : t < 16 ? bed : chair));
  expect(phases).toEqual([
    'toSeat',
    'sitDown',
    'sit',
    'standUp',
    'idle',
    'toSeat',
    'dive',
    'lie',
    'rise',
    'idle',
    'toSeat',
    'sitDown',
    'sit',
  ]);
  expect(Math.hypot(state.mover.x - chair.stand[0], state.mover.z - chair.stand[1])).toBeLessThan(0.02);
});

test('the dive is the same at any frame rate', () => {
  const at = (dt: number) => day(DIVE.end + 3, () => bed, dt).state.mover;
  const slow = at(1 / 30),
    fast = at(1 / 144);
  expect(Math.hypot(slow.x - fast.x, slow.z - fast.z)).toBeLessThan(0.01);
});

// --- the phone ----------------------------------------------------------------------------

function phone(
  seconds: number,
  want: (t: number) => { use: boolean; buds: boolean; hold?: boolean },
  dt = 1 / 60,
  from?: PhoneState,
) {
  let s = from ?? startPhone();
  const phases: PhonePhase[] = [];
  const frames: ReturnType<typeof phoneIntent>[] = [];
  for (let t = 0; t < seconds; t += dt) {
    s = stepPhone(s, { dt, ...want(t) });
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    frames.push(phoneIntent(s));
  }
  return { s, phases, frames };
}

test('taking up the phone with its earphones: picked up, raised, both buds to the ears, then used', () => {
  const { s, phases, frames } = phone(14, () => ({ use: true, buds: true }));
  expect(phases).toEqual(['pick', 'raise', 'budOnL', 'budOnR', 'look']);
  expect(s.budL).toBe('ear');
  expect(s.budR).toBe('ear');
  const last = frames[frames.length - 1]!;
  expect(last.phone).toBe('hand');
  expect(last.screen).toBe(1);
  // The right hand holds the phone; the left handles the buds.
  for (const f of frames.filter((f) => f.phase === 'budOnL' || f.phase === 'budOnR')) {
    expect(f.right.to).toBe('view');
    expect(f.right.weight).toBe(1);
  }
  // Hands move, never jump.
  for (let i = 1; i < frames.length; i++)
    for (const hand of ['left', 'right'] as const) {
      expect(Math.abs(frames[i]![hand].weight - frames[i - 1]![hand].weight)).toBeLessThan(0.1);
      if (frames[i]![hand].to === frames[i - 1]![hand].to && frames[i]![hand].from === frames[i - 1]![hand].from)
        expect(Math.abs(frames[i]![hand].k - frames[i - 1]![hand].k)).toBeLessThan(0.1);
    }
  // A bud is held by the hand only between being taken and being put on.
  const held = frames.filter((f) => f.budL === 'hand');
  expect(held.length).toBeGreaterThan(10);
  expect(held.every((f) => f.phase === 'budOnL')).toBe(true);
  // Used, the thumb taps now and then and the eyes are on it.
  const look = frames.filter((f) => f.phase === 'look');
  expect(look.filter((f, i) => i > 0 && f.thumb > 0.5 && look[i - 1]!.thumb <= 0.5).length).toBeGreaterThan(2);
  expect(look.every((f) => f.look === 1)).toBe(true);
});

test('put away: the buds come out, the phone goes back down, the screen goes dark', () => {
  const on = phone(14, () => ({ use: true, buds: true }));
  const { s, phases, frames } = phone(10, () => ({ use: false, buds: true }), 1 / 60, on.s);
  // (A second hand on the phone lets go first: the look may last a moment longer.)
  expect(withoutLeadingLook(phases)).toEqual(['budOffR', 'budOffL', 'lower', 'put', 'away']);
  expect([s.budL, s.budR]).toEqual(['phone', 'phone']);
  const last = frames[frames.length - 1]!;
  expect(last.phone).toBe('rest');
  expect(last.screen).toBe(0);
  expect(last.right.weight).toBe(0);
  expect(last.left.weight).toBe(0);
});

test('without earphones there are no bud moves; asking for them while in use puts them on then', () => {
  const plain = phone(8, () => ({ use: true, buds: false }));
  expect(plain.phases).toEqual(['pick', 'raise', 'look']);
  const later = phone(8, () => ({ use: true, buds: true }), 1 / 60, plain.s);
  expect(withoutLeadingLook(later.phases)).toEqual(['budOnL', 'budOnR', 'look']);
  const off = phone(8, () => ({ use: true, buds: false }), 1 / 60, later.s);
  expect(withoutLeadingLook(off.phases)).toEqual(['budOffR', 'budOffL', 'look']);
});

const withoutLeadingLook = (phases: PhonePhase[]) => (phases[0] === 'look' ? phases.slice(1) : phases);

test('kept in hand to go elsewhere: carried at the side with the buds in, then used again or put down', () => {
  const on = phone(14, () => ({ use: true, buds: true }));
  const carry = phone(4, () => ({ use: false, buds: true, hold: true }), 1 / 60, on.s);
  expect(withoutLeadingLook(carry.phases)).toEqual(['carry']);
  const last = carry.frames[carry.frames.length - 1]!;
  expect([last.phone, last.budL, last.budR]).toEqual(['hand', 'ear', 'ear']);
  expect(last.right.weight).toBe(0);
  expect(last.right.grip).toBe(1);
  expect(last.screen).toBe(0);
  // Up again from the side where it is: no trip by the rest.
  const again = phone(4, () => ({ use: true, buds: true }), 1 / 60, carry.s);
  // (The carry has settled: it comes up in the first frame.)
  expect(again.phases).toEqual(['raise', 'look']);
  expect(again.frames.every((f) => f.right.from !== 'rest')).toBe(true);
  // Or put down there: raised to take the buds out first, then down on the rest.
  const down = phone(10, () => ({ use: false, buds: true }), 1 / 60, carry.s);
  expect(down.phases).toEqual(['raise', 'budOffR', 'budOffL', 'lower', 'put', 'away']);
  for (let i = 1; i < again.frames.length; i++)
    expect(Math.abs(again.frames[i]!.right.weight - again.frames[i - 1]!.right.weight)).toBeLessThan(0.1);
});

test('the phone routine is the same at any frame rate', () => {
  const run = (dt: number) => phone(20, (t) => ({ use: t < 14, buds: true }), dt);
  const a = run(1 / 30),
    b = run(1 / 144);
  expect(a.phases).toEqual(b.phases);
});

// --- the earphone cord -------------------------------------------------------------------

const ends = (c: Cord): [Vec3, Vec3, Vec3] => [c.node(c.jack), c.node(c.budL), c.node(c.budR)];

test('the cord hangs between the phone and the ears without stretching or going through the bed', () => {
  const jack: Vec3 = [0, 0.8, 0];
  const cord = makeCord(jack, { main: 0.45, branch: 0.32 });
  const pins = (): Map<number, Vec3> =>
    new Map([
      [cord.jack, jack],
      [cord.budL, [-0.08, 1.25, 0.1]],
      [cord.budR, [0.08, 1.25, 0.1]],
    ]);
  const ground = () => 0.7;
  for (let i = 0; i < 300; i++) stepCord(cord, 1 / 60, pins(), ground);
  const [j, l, r] = ends(cord);
  expect(j).toEqual(jack);
  expect(l).toEqual([-0.08, 1.25, 0.1]);
  expect(r).toEqual([0.08, 1.25, 0.1]);
  expect(cordLength(cord)).toBeLessThan((0.45 + 0.32 * 2) * 1.04);
  for (let i = 0; i < cord.count; i++) expect(cord.node(i)[1]).toBeGreaterThanOrEqual(0.7 - 1e-6);
  // The splitter hangs below the ears (gravity), not on a straight line between the pins.
  expect(cord.node(cord.splitter)[1]).toBeLessThan(1.15);
});

test('the cord is the same at any frame rate', () => {
  const run = (dt: number) => {
    const cord = makeCord([0, 1, 0], { main: 0.45, branch: 0.32 });
    for (let t = 0; t < 3; t += dt)
      stepCord(
        cord,
        dt,
        new Map([
          [cord.jack, [Math.sin(t) * 0.2, 1, 0]],
          [cord.budL, [-0.1, 1.4, 0]],
          [cord.budR, [0.1, 1.4, 0]],
        ]),
        () => 0,
      );
    return cord.node(cord.splitter);
  };
  const a = run(1 / 30),
    b = run(1 / 144);
  expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.03);
});

// --- the chair that gives ------------------------------------------------------------------

function chair(seconds: number, seated: (t: number) => number, impactAt: number[] = [], dt = 1 / 60) {
  let s = startChair();
  const frames: ReturnType<typeof stepChair>[] = [];
  const kicked = new Set<number>();
  for (let t = 0; t < seconds; t += dt) {
    const impact = impactAt.find((at) => t >= at && !kicked.has(at));
    if (impact !== undefined) kicked.add(impact);
    s = stepChair(s, { dt, seated: seated(t), ...(impact !== undefined ? { impact: 1 } : {}) });
    frames.push(s);
  }
  return frames;
}

test('dropping onto the chair: the seat sinks past its rest, springs back, the chair rocks and settles', () => {
  const frames = chair(4, (t) => (t < 0.5 ? 0 : Math.min(1, (t - 0.5) / 0.2)), [0.6]);
  const sinks = frames.map((f) => f.sink);
  expect(Math.max(...sinks)).toBeGreaterThan(1.08);
  expect(Math.abs(sinks[sinks.length - 1]! - 1)).toBeLessThan(0.02);
  // The back gives with it, and the whole chair rocks, then is still.
  expect(Math.max(...frames.map((f) => f.recline))).toBeGreaterThan(0.3);
  expect(Math.max(...frames.map((f) => Math.abs(f.rock)))).toBeGreaterThan(0.02);
  expect(Math.abs(frames[frames.length - 1]!.rock)).toBeLessThan(0.003);
  // The seat's drop in metres is what the sitter rides.
  expect(frames[frames.length - 1]!.drop).toBeCloseTo(CHAIR.seatDepth, 2);
});

test('getting up: the seat comes back up, without bouncing far below its rest', () => {
  const frames = chair(6, (t) => (t < 2 ? 1 : Math.max(0, 1 - (t - 2) / 0.4)));
  const after = frames.slice(Math.round(2.4 * 60)).map((f) => f.sink);
  expect(Math.min(...after)).toBeGreaterThan(-0.15);
  expect(Math.abs(after[after.length - 1]!)).toBeLessThan(0.01);
});
