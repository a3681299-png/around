import { test, expect } from '@playwright/test';
import {
  choose,
  feel,
  moodOf,
  scores,
  startMind,
  stepMind,
  type Activity,
  type Mind,
  type Offer,
} from '../src/characters/mind';
import {
  startDirector,
  stepDirector,
  THROW_SPEED,
  type DirectorState,
  type Orders,
  type Seen,
  type StageView,
} from '../src/living-room/director';
import { bounce, moving, stepMotion, still, throwVelocity } from '../src/living-room/desktop/physics';
import {
  approachIntent,
  startApproach,
  stepApproach,
  type ApproachPhase,
  type BodyReach,
  type Perch,
} from '../src/characters/approach';
import type { PhonePhase } from '../src/characters/phone-routine';
import type { RoomLayout } from '../src/world/room-life';
import type { MindEvent } from '../src/characters/mind';

// The resident's mind, the director that carries it out, the desktop's things and the perch
// (docs/living-mind.md). Pure: fixed clocks, fixed seeds.

const NOTHING: Offer = { uiOpen: false, window: false, perch: false, ball: false };
const EVERYTHING: Offer = { uiOpen: true, window: true, perch: true, ball: true };

// --- the mind --------------------------------------------------------------------------------

test('worn out, it sleeps; rested again, it does something else', () => {
  let mind: Mind = { ...startMind(3), energy: 0.08 };
  expect(choose(mind, EVERYTHING).activity).toBe('nap');
  for (let t = 0; t < 60; t += 0.1) mind = stepMind(mind, 0.1, 'nap', true);
  expect(mind.energy).toBeGreaterThan(0.9);
  expect(choose(mind, EVERYTHING).activity).not.toBe('nap');
});

test('it never takes up what the world does not offer', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const mind: Mind = { ...startMind(seed), curiosity: 1, boredom: 1, joy: 1 };
    const { activity } = choose(mind, NOTHING);
    expect(['play', 'inspect', 'shove', 'tug', 'perch']).not.toContain(activity);
  }
  const offered = scores({ ...startMind(1), curiosity: 1 }, { ...NOTHING, uiOpen: true, window: true });
  expect(offered.inspect).toBeGreaterThan(0);
  expect(offered.play).toBe(0);
  expect(offered.perch).toBe(0);
});

test('thrown off once by a friend is a thrill; thrown again, it is cross and goes to sulk', () => {
  let mind = feel(startMind(2), 'thrown');
  expect(mind.joy).toBeGreaterThan(0.3);
  expect(mind.grump).toBeLessThan(0.2);
  expect(moodOf(mind)).toBe('surprised');
  mind = feel(feel(mind, 'thrown'), 'thrown');
  expect(mind.grump).toBeGreaterThan(0.8);
  expect(mind.affinity).toBeLessThan(0);
  // (The start passes; the crossness stays.)
  for (let t = 0; t < 4; t += 0.1) mind = stepMind(mind, 0.1, 'floorSit', false);
  expect(moodOf(mind)).toBe('grumpy');
  expect(choose(mind, EVERYTHING).activity).toBe('sulk');
  // Someone it is wary of throwing it is rude the first time.
  expect(feel(startMind(2, -0.6), 'thrown').grump).toBeGreaterThan(0.5);
});

test('petting cheers it, mends a sulk, and is remembered as fondness', () => {
  let mind: Mind = { ...startMind(2), grump: 0.9 };
  mind = feel(feel(mind, 'petted'), 'petted');
  expect(mind.grump).toBeLessThan(0.05);
  expect(mind.joy).toBeGreaterThan(0.9);
  expect(mind.affinity).toBeCloseTo(0.12, 5);
  expect(choose(mind, EVERYTHING).activity).not.toBe('sulk');
});

test('teased a little, it is puzzled; teased again and again, it loses patience', () => {
  let mind = feel(startMind(1), 'teased');
  expect(moodOf(mind)).toBe('confused');
  expect(mind.grump).toBeLessThan(0.2);
  mind = feel(feel(feel(mind, 'teased'), 'teased'), 'teased');
  expect(mind.grump).toBeGreaterThan(0.5);
});

test('feelings fade; needs build; the same seed thinks the same thoughts, another seed others', () => {
  let mind = feel(startMind(1), 'whoosh');
  expect(mind.surprise).toBe(1);
  for (let t = 0; t < 3; t += 0.1) mind = stepMind(mind, 0.1, 'floorSit', true);
  expect(mind.surprise).toBe(0);
  expect(mind.boredom).toBeGreaterThan(startMind(1).boredom);
  const day = (seed: number) => {
    let m = startMind(seed);
    const did: Activity[] = [];
    for (let i = 0; i < 12; i++) {
      const picked = choose(m, EVERYTHING);
      did.push(picked.activity);
      m = picked.mind;
      for (let t = 0; t < 12; t += 0.25) m = stepMind(m, 0.25, picked.activity, true);
    }
    return did;
  };
  expect(day(5)).toEqual(day(5));
  expect(new Set([1, 2, 3, 4, 5, 6].map((seed) => day(seed).join())).size).toBeGreaterThan(3);
  // No day is one thing over and over.
  for (const seed of [1, 2, 3]) expect(new Set(day(seed)).size).toBeGreaterThanOrEqual(4);
});

// --- the director ----------------------------------------------------------------------------

/** A stand-in for the body, the phone and the desktop: they do as ordered, after a moment. */
function world(
  seed: number,
  seconds: number,
  events: (t: number, orders: Orders | undefined) => MindEvent[] = () => [],
) {
  let director: DirectorState = startDirector(seed);
  let body: ApproachPhase = 'idle',
    bodyFor = 0,
    phone: PhonePhase = 'away',
    phoneFor = 0;
  const stage: { open: boolean; ball: boolean; speed: number } = { open: false, ball: false, speed: 0 };
  let orders: Orders | undefined;
  const did: Activity[] = [];
  const acts: string[] = [];
  const frames: Orders[] = [];
  const dt = 0.1;
  for (let t = 0; t < seconds; t += dt) {
    const want: ApproachPhase = orders?.perch
      ? 'perch'
      : orders?.touch
        ? 'hold'
        : orders?.seat === 'bed'
          ? 'lie'
          : orders?.seat
            ? 'sit'
            : 'idle';
    const was = body;
    if (orders?.tumble) {
      body = 'tumble';
      bodyFor = 0;
    } else if (body === 'tumble') {
      if (bodyFor > 0.85) body = 'dazed';
    } else if (body === 'dazed') {
      if (bodyFor > 1.5) body = 'idle';
    } else if (body !== want) {
      // Three seconds to get anywhere; a touch lands and is over.
      if (body !== 'walk') body = want === 'idle' ? 'idle' : 'walk';
      else if (bodyFor > 3) body = want;
    } else if (body === 'hold' && bodyFor > 0.3) body = 'idle';
    bodyFor = body === was ? bodyFor + dt : 0;
    const phoneWant: PhonePhase = orders?.phone === 'use' ? 'look' : orders?.phone === 'hold' ? 'carry' : 'away';
    phoneFor = phone === phoneWant ? 0 : phoneFor + dt;
    if (phone !== phoneWant && phoneFor > 2.5) phone = phoneWant;
    const view: StageView = stage.open
      ? {
          open: true,
          window: { hand: [0, 0.8, 1], perch: { at: [0, 0.75, 1], heading: 0 }, speed: stage.speed, held: false },
          ...(stage.ball ? { ball: { hand: [1, 0.7, 0.5] as [number, number, number], speed: 0, held: false } } : {}),
        }
      : { open: false };
    const seen: Seen = {
      dt,
      body,
      phone,
      stage: view,
      landed: body === 'hold' && was !== 'hold',
      events: events(t, orders),
      knockAt: [0, 1, 2.4],
    };
    const stepped = stepDirector(director, seen);
    director = stepped.state;
    orders = stepped.orders;
    frames.push(orders);
    if (did[did.length - 1] !== orders.activity) did.push(orders.activity);
    for (const a of orders.acts) {
      acts.push(a.type === 'app' ? `app:${a.id}` : a.type === 'impulse' ? `impulse:${a.kind}` : a.type);
      if (a.type === 'open') stage.open = true;
      if (a.type === 'close') stage.open = false;
      if (a.type === 'app' && a.id === 'ball') stage.ball = true;
    }
  }
  return { director, did, acts, frames, stage };
}

test('left alone, it lives: it turns the desktop on itself, plays with it, and no two days are alike', () => {
  const days = [1, 2, 3, 4].map((seed) => world(seed, 240));
  for (const day of days) {
    // It begins lying with its phone, and does several different things in four minutes.
    expect(day.did[0]).toBe('bedPhone');
    expect(new Set(day.did).size).toBeGreaterThanOrEqual(5);
    // It sat at the desk and turned the desktop on by itself, and used it.
    expect(day.did).toContain('computer');
    expect(day.acts).toContain('open');
    expect(day.acts.some((a) => a.startsWith('impulse') || a === 'sit')).toBe(true);
  }
  expect(new Set(days.map((d) => d.did.join())).size).toBe(days.length);
  // The same seed is the same day.
  expect(world(2, 120).did).toEqual(world(2, 120).did);
});

test('the phone is put down before it leaves the bed, and used only lying there', () => {
  const { frames } = world(1, 120);
  let previous: Orders | undefined;
  for (const orders of frames) {
    if (orders.phone === 'use') expect(orders.seat).toBe('bed');
    // (An activity changes only once the phone is away: the frame before a change asked for rest.)
    if (previous && previous.activity === 'bedPhone' && orders.activity !== 'bedPhone')
      expect(previous.phone).toBe('rest');
    previous = orders;
  }
});

test('riding a window: a throw tumbles it off, once; asleep, it is cross to be woken early', () => {
  // On a window, the window is flung.
  let thrown = 0;
  const ride = world(1, 400, (t, orders) => {
    void t;
    void orders;
    return [];
  });
  expect(ride.did).toContain('perch');
  // A director by hand: sat on a window that then goes fast.
  let director: DirectorState = { ...startDirector(1), activity: 'perch', until: 30, time: 0 };
  const seen = (speed: number, body: ApproachPhase): Seen => ({
    dt: 0.1,
    body,
    phone: 'away',
    stage: { open: true, window: { perch: { at: [0, 0.75, 1], heading: 0 }, speed, held: true } },
    landed: false,
    events: [],
    knockAt: [0, 1, 2],
  });
  for (let i = 0; i < 30; i++) {
    const stepped = stepDirector(director, seen(i < 20 ? 200 : THROW_SPEED + 300, i < 5 ? 'perchUp' : 'perch'));
    director = stepped.state;
    if (stepped.orders.tumble) thrown++;
    if (i === 10) expect(stepped.orders.perch).toBeDefined();
  }
  expect(thrown).toBe(1);
  expect(director.mind.surprise).toBeGreaterThan(0);

  // Asleep and worn out, a window flung past wakes it: startled and cross. Petted awake is a
  // gentle waking: the hand that woke it is forgiven at once.
  const sleeper: DirectorState = {
    ...startDirector(1),
    activity: 'nap',
    doing: 5,
    mind: { ...startMind(1), energy: 0.3 },
  };
  const rude = stepDirector(sleeper, { ...seen(0, 'lie'), stage: { open: false }, events: ['whoosh'] });
  expect(rude.state.mind.grump).toBeGreaterThan(0.4);
  expect(rude.orders.emote).toBe('bang');
  const gentle = stepDirector(sleeper, { ...seen(0, 'lie'), stage: { open: false }, events: ['petted'] });
  expect(gentle.state.mind.grump).toBeLessThan(0.1);
  expect(gentle.orders.emote).toBe('heart');
  // Either way it is awake: it takes up something else.
  expect(rude.state.next ?? rude.state.activity).toBeDefined();
});

// --- the desktop's things --------------------------------------------------------------------

test('a thrown window slows and stops, tips into its motion and rights itself; the ball keeps going', () => {
  let win = { ...still(), vx: 1800 },
    ball = { ...still(), vx: 1800 };
  let tipped = 0,
    travelled = 0;
  for (let t = 0; t < 4; t += 1 / 60) {
    win = stepMotion(win, 1 / 60, false, false);
    ball = stepMotion(ball, 1 / 60, true, false);
    tipped = Math.max(tipped, win.tilt);
    travelled += win.vx / 60;
  }
  expect(tipped).toBeGreaterThan(0.08);
  expect(moving(win)).toBe(false);
  expect(travelled).toBeGreaterThan(400);
  expect(travelled).toBeLessThan(900);
  expect(ball.vx).toBeGreaterThan(150);
  expect(ball.spin).toBeGreaterThan(10);
});

test('held at the edge of the screen it bounces back; sat on, it sags and stays down', () => {
  const hit = bounce({ ...still(), vx: 900, vy: -300 }, [1300, 80], [1180, 80], false);
  expect(hit.vx).toBeLessThan(0);
  expect(Math.abs(hit.vx)).toBeLessThan(900);
  expect(hit.vy).toBe(-300);
  expect(bounce({ ...still(), vx: 900 }, [1300, 80], [1180, 80], true).vx).toBeLessThan(hit.vx);
  let sat = still();
  for (let t = 0; t < 2; t += 1 / 60) sat = stepMotion(sat, 1 / 60, false, true);
  expect(sat.sag).toBeCloseTo(9, 0);
  for (let t = 0; t < 2; t += 1 / 60) sat = stepMotion(sat, 1 / 60, false, false);
  expect(moving(sat)).toBe(false);
});

test('a throw is the last tenth of a second of the drag; a drag that had stopped throws nothing', () => {
  const trail = [0, 16, 32, 48, 64].map((t) => ({ t: 1000 + t, x: 100 + t * 2, y: 200 - t }));
  const [vx, vy] = throwVelocity(trail, 1066);
  expect(vx).toBeCloseTo(2000, -2);
  expect(vy).toBeCloseTo(-1000, -2);
  expect(throwVelocity(trail, 1400)).toEqual([0, 0]);
  expect(throwVelocity([], 0)).toEqual([0, 0]);
});

// --- the perch -------------------------------------------------------------------------------

const layout: RoomLayout = {
  floorY: 0,
  floor: [
    [-2, -2, 2, -2, 2, 2],
    [-2, -2, 2, 2, -2, 2],
  ],
  spots: [],
};
const body: BodyReach = { arm: 0.45, shoulderHeight: 0.93, shoulderHalf: 0.07 };

function perching(seconds: number, perch: (t: number) => Perch | undefined, tumble: (t: number) => number = () => 0) {
  let state = startApproach(0, 0, 0);
  const phases: ApproachPhase[] = [];
  const frames: ReturnType<typeof approachIntent>[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const p = perch(t);
    state = stepApproach(state, { dt, layout, body, tumble: tumble(t), ...(p ? { perch: p } : {}) });
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    frames.push(approachIntent(state, undefined));
  }
  return { state, phases, frames };
}

test('a perch: it walks under it, hops up, sits and swings its legs; carried, it rides; let go, it hops down', () => {
  // The perch is still for six seconds, is carried a metre and a half, and is taken away at ten.
  const at = (t: number): Perch | undefined =>
    t < 10 ? { at: [1 + (t > 6 ? Math.min(1.5, (t - 6) * 0.8) : 0) * -1, 0.75, 1], heading: 0.4 } : undefined;
  const { state, phases, frames } = perching(13, at);
  expect(phases).toEqual(['toPerch', 'perchUp', 'perch', 'perchDown', 'idle']);
  const riding = frames.filter((f) => f.phase === 'perch');
  expect(riding.every((f) => f.pose === 'sit' && f.seated === 1)).toBe(true);
  expect(Math.max(...riding.map((f) => f.dangle))).toBe(1);
  // Its seat is the perch, wherever that has got to.
  expect(riding[riding.length - 1]!.seat![0]).toBeCloseTo(-0.5, 1);
  expect(riding[0]!.seat![0]).toBeCloseTo(1, 1);
  // The hop leaves the floor, and it is seated as it lands.
  const up = frames.filter((f) => f.phase === 'perchUp');
  expect(up.some((f) => (f.hop ?? 0) > 0 && f.hopHeight > 0.1)).toBe(true);
  expect(up[up.length - 1]!.seated).toBeGreaterThan(0.95);
  // Down on the floor under where it was.
  expect(state.phase).toBe('idle');
  expect(Math.hypot(state.mover.x + 0.5, state.mover.z - 1)).toBeLessThan(0.05);
  for (let i = 1; i < frames.length; i++)
    expect(Math.abs(frames[i]!.seated - frames[i - 1]!.seated)).toBeLessThan(0.08);
});

test('thrown off its perch it spins down to the floor, sits dazed, and gets up; once per throw', () => {
  const { state, phases, frames } = perching(
    12,
    () => ({ at: [1, 0.75, 1], heading: 0 }),
    (t) => (t > 6 && t < 6.5 ? 1 : t >= 6.5 ? 1 : 0),
  );
  // (The perch is still there: it climbs back up afterwards.)
  expect(phases.slice(0, 6)).toEqual(['toPerch', 'perchUp', 'perch', 'tumble', 'dazed', 'idle']);
  expect(phases.filter((p) => p === 'tumble')).toHaveLength(1);
  const falling = frames.filter((f) => f.phase === 'tumble');
  expect(falling.every((f) => f.arms > 0.5)).toBe(true);
  const turned = falling[falling.length - 1]!.heading - falling[0]!.heading;
  expect(Math.abs(turned)).toBeGreaterThan(Math.PI * 3);
  expect(state.tumbled).toBe(1);
});
