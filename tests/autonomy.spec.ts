import { test, expect } from '@playwright/test';
import {
  AUTONOMY,
  DEFAULT_PERSONALITY,
  evaluateAutonomy,
  initialAutonomy,
  parseAutonomyState,
  type AutonomyContext,
  type AutonomyState,
} from '../src/world/autonomy';
import { evaluateBodyMotion, type BodyContext } from '../src/world/body-motion';
import { startPage, type ModelState } from '../src/world/models';
import { createPageTracker } from '../src/host/page-identity';
import { youtubePage } from '../src/sites/youtube-page';
import { initialWorldState } from '../src/world/evaluate';
import type { WorldState } from '../src/world/types';

const H = 190;
const home = { x: 1000, y: 500 };
const base: AutonomyContext = {
  timeMs: 0,
  deltaMs: 16,
  home,
  heightPx: H,
  pointer: undefined,
  idleSeconds: 0,
  playing: true,
  personality: DEFAULT_PERSONALITY,
};
/** Frames at 60 fps; `pointer(t)` gives the pointer at each frame. */
function run(from: number, until: number, frame: (t: number) => Partial<AutonomyContext>, start?: AutonomyState) {
  let state = start;
  const frames: { t: number; state: AutonomyState; offset: { x: number; y: number }; doze: number }[] = [];
  for (let t = from; t <= until; t += 16) {
    const result = evaluateAutonomy(state, { ...base, timeMs: t, ...frame(t) });
    state = result.state;
    frames.push({ t, state, offset: result.output.offset, doze: result.output.doze });
  }
  return { state: state!, frames, last: frames.at(-1)! };
}
/** The pointer rushes in from the left at 2400 px/s and stops beside the character. */
const rush = (start: number) => (t: number) => ({
  pointer: { x: Math.min(home.x - 60, home.x - 900 + Math.max(0, t - start) * 2.4), y: home.y },
});

test('the same inputs give the same behaviour (no clock, no random)', () => {
  const a = run(0, 3000, rush(500)),
    b = run(0, 3000, rush(500));
  expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
});

test('a pointer rushing in startles it: it flees to the far side, then comes home once it is gone', () => {
  const scared = run(0, 1200, rush(200));
  expect(scared.frames.some((f) => f.state.behaviour === 'flee')).toBe(true);
  // Away from the pointer (which came from the left): to the right, about 1.4 heights.
  expect(scared.last.offset.x).toBeGreaterThan(0.8 * AUTONOMY.fleeHeights * H);
  // The pointer leaves; after a while it hops back home.
  const calm = run(1216, 6000, () => ({ pointer: { x: 100, y: 100 } }), scared.state);
  expect(calm.frames.some((f) => f.state.behaviour === 'return')).toBe(true);
  expect(Math.hypot(calm.last.offset.x, calm.last.offset.y)).toBeLessThan(1);
});

test('a slow pointer invites it: it edges a little closer, never onto the pointer', () => {
  // The pointer creeps in from the right at 120 px/s and rests there.
  const pointer = (t: number) => ({ pointer: { x: Math.max(home.x + 250, home.x + 420 - t * 0.12), y: home.y } });
  const curious = run(0, 6000, pointer, undefined);
  expect(curious.frames.some((f) => f.state.behaviour === 'approach')).toBe(true);
  expect(curious.last.offset.x).toBeGreaterThan(5);
  expect(curious.last.offset.x).toBeLessThanOrEqual(0.7 * H + 0.01);
  // Shy and incurious: it stays.
  const shy = run(0, 6000, (t) => ({ ...pointer(t), personality: { shyness: 1, curiosity: 0, sleepiness: 0 } }));
  expect(Math.abs(shy.last.offset.x)).toBeLessThan(0.3 * H);
});

test('memory: being startled again and again makes it jump more', () => {
  let state: AutonomyState | undefined;
  const alerts: number[] = [];
  for (let round = 0; round < 4; round++) {
    const start = round * 8000;
    const scared = run(start, start + 1000, rush(start + 100), state);
    alerts.push(Math.max(...scared.frames.map((f) => f.state.alert)));
    state = run(start + 1016, start + 7900, () => ({ pointer: { x: 0, y: 0 } }), scared.state).state;
  }
  expect(state!.startles).toBeGreaterThan(2);
  // Each startle adds more than the last (until the cap).
  expect(alerts[2]!).toBeGreaterThanOrEqual(alerts[0]!);
  const first = run(0, 1000, rush(100)).frames.find((f) => f.state.startles >= 1)!.state.alert;
  const later = run(0, 1000, rush(100), { ...initialAutonomy(), startles: 5 }).frames.find(
    (f) => f.state.startles >= 6,
  )!.state.alert;
  expect(later).toBeGreaterThan(first);
});

test('left alone for long it dozes off; a sleepy character sooner', () => {
  const quiet = (t: number) => ({ idleSeconds: t / 1000, pointer: undefined });
  const dozy = run(0, 90000, (t) => ({ ...quiet(t), personality: { shyness: 0.5, curiosity: 0.5, sleepiness: 1 } }));
  const alert = run(0, 90000, (t) => ({ ...quiet(t), personality: { shyness: 0.5, curiosity: 0.5, sleepiness: 0 } }));
  const dozedAt = (r: ReturnType<typeof run>) => r.frames.find((f) => f.state.behaviour === 'doze')?.t ?? Infinity;
  expect(dozedAt(dozy)).toBeLessThan(dozedAt(alert));
  expect(dozy.last.doze).toBeGreaterThan(0.9);
});

const body: BodyContext = {
  timeMs: 0,
  deltaMs: 16,
  seed: 7,
  posture: 'sit',
  authorActive: false,
  running: true,
  reducedMotion: false,
  position: home,
  heightPx: H,
  pointer: undefined,
  idleSeconds: 0,
  scrollY: 0,
  events: [],
  personality: DEFAULT_PERSONALITY,
};

test('held by G1.2 half-way through a flight, it keeps going (not frozen) and its body rests', () => {
  let state: ReturnType<typeof evaluateBodyMotion>['state'] | undefined;
  let t = 0;
  // Startled, then held after a few frames of the flight.
  for (; t < 400; t += 16) state = evaluateBodyMotion(state, { ...body, timeMs: t, ...rush(100)(t) }).state;
  const before = state!.autonomy!.offset.x;
  const held: number[] = [];
  for (; t < 1400; t += 16) {
    const result = evaluateBodyMotion(state, { ...body, timeMs: t, running: false, yielding: true, ...rush(100)(t) });
    state = result.state;
    held.push(result.pose.offset.x);
    expect(result.pose.bones).toEqual({});
  }
  expect(held.at(-1)!).toBeGreaterThan(before);
});

test('a new page: it is home at once, and what it remembered of the last page is gone', () => {
  let state: ReturnType<typeof evaluateBodyMotion>['state'] | undefined;
  let t = 0;
  // Startled and away from home on the last page.
  for (; t < 600; t += 16) state = evaluateBodyMotion(state, { ...body, timeMs: t, ...rush(100)(t) }).state;
  expect(state!.autonomy!.offset.x).toBeGreaterThan(50);
  expect(state!.autonomy!.startles).toBeGreaterThan(0);
  const model: ModelState = {
    clip: 0,
    timeMs: 1200,
    previousClip: null,
    previousTimeMs: 0,
    fadeElapsedMs: 0,
    fadeDurationMs: 0,
    yawDeg: 0,
    lookYaw: 0,
    lookPitch: 0,
    suspended: false,
    phase: 'idle',
  };
  const world: WorldState = {
    ...initialWorldState(),
    timeMs: t,
    models: { resident: { ...model, body: state! }, plain: model },
  };
  const next = startPage(world);
  // Only the autonomy goes: the clip, the body's own timing and every other model stay.
  const { autonomy: _gone, ...kept } = state!;
  expect(next.models!['resident']).toEqual({ ...model, body: kept });
  expect(next.models!['plain']).toBe(model);
  expect(next.timeMs).toBe(t);
  expect(world.models!['resident']!.body!.autonomy).toBeDefined();
  // The next frame draws it at home (no walk back across the new page), with no memory of startles.
  const after = evaluateBodyMotion(next.models!['resident']!.body, { ...body, timeMs: t, pointer: { x: 0, y: 0 } });
  expect(after.pose.offset).toEqual({ x: 0, y: 0 });
  expect(after.state.autonomy!.startles).toBe(0);
  // Nothing to forget: the same state object.
  const quiet = initialWorldState();
  expect(startPage(quiet)).toBe(quiet);
});

test("a new page is the adapter's page, not the address: YouTube keeps a video's page through t= and queries", () => {
  const steps = (tracker: ReturnType<typeof createPageTracker>, addresses: string[]) =>
    addresses.map((address) => tracker(address));
  const yt = 'https://www.youtube.com';
  // The first address is not a new page (nothing to forget); the same video's address changes
  // (t=, a playlist, a fragment, the parameter order) are not either.
  expect(
    steps(createPageTracker(youtubePage), [
      `${yt}/watch?v=AAAAAAAAAAA`,
      `${yt}/watch?v=AAAAAAAAAAA&t=7s`,
      `${yt}/watch?t=12&v=AAAAAAAAAAA&list=PL1`,
      `${yt}/watch?v=AAAAAAAAAAA#comments`,
    ]),
  ).toEqual([false, false, false, false]);
  // A search, another video, back and forward: each is a new page, as before.
  expect(
    steps(createPageTracker(youtubePage), [
      `${yt}/watch?v=AAAAAAAAAAA`,
      `${yt}/results?search_query=sea`,
      `${yt}/results?search_query=sea&sp=EgIQAQ`,
      `${yt}/results?search_query=mountain`,
      `${yt}/watch?v=BBBBBBBBBBB`,
      `${yt}/watch?v=AAAAAAAAAAA`,
      `${yt}/results?search_query=mountain`,
      `${yt}/watch?v=AAAAAAAAAAA&t=30`,
      `${yt}/shorts/CCCCCCCCCCC`,
      `${yt}/shorts/DDDDDDDDDDD`,
      `${yt}/`,
      `${yt}/@channel/videos`,
      `${yt}/@channel/videos?view=0`,
      `${yt}/playlist?list=PL1`,
      `${yt}/playlist?list=PL2`,
    ]),
  ).toEqual([false, true, false, true, true, true, true, true, true, true, true, true, false, true, true]);
  // A site without its own page identity: the address without its fragment, as before.
  expect(
    steps(createPageTracker(), [
      'https://example.test/a?x=1',
      'https://example.test/a?x=1#top',
      'https://example.test/a?x=2',
      '',
      '',
    ]),
  ).toEqual([false, false, true, true, false]);
  // The adapter's identity is asked only when the address changes.
  let asked = 0;
  const tracker = createPageTracker((url) => (asked++, url.pathname));
  steps(tracker, [
    'https://example.test/a',
    'https://example.test/a',
    'https://example.test/a',
    'https://example.test/b',
  ]);
  expect(asked).toBe(2);
});

test("the author's motion and reduced motion leave it at home", () => {
  for (const extra of [{ authorActive: true }, { reducedMotion: true }]) {
    let state: ReturnType<typeof evaluateBodyMotion>['state'] | undefined;
    let offset = { x: 0, y: 0 };
    for (let t = 0; t < 1500; t += 16) {
      const result = evaluateBodyMotion(state, { ...body, ...extra, timeMs: t, ...rush(100)(t) });
      state = result.state;
      offset = result.pose.offset;
    }
    expect(offset).toEqual({ x: 0, y: 0 });
  }
  // Autonomy off (no personality): no flight either.
  let state: ReturnType<typeof evaluateBodyMotion>['state'] | undefined;
  for (let t = 0; t < 1500; t += 16) {
    const { personality: _off, ...rest } = body;
    state = evaluateBodyMotion(state, { ...rest, timeMs: t, ...rush(100)(t) }).state;
  }
  expect(state!.autonomy).toBeUndefined();
});

test('recorded autonomy states read back exactly; malformed ones are refused', () => {
  const { state } = run(0, 2000, rush(100));
  expect(parseAutonomyState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(() => parseAutonomyState({ ...state, behaviour: 'walk' })).toThrow();
  expect(() => parseAutonomyState({ ...state, alert: 2 })).toThrow();
  expect(() => parseAutonomyState({ ...state, extra: 1 })).toThrow();
});
