import { test, expect } from '@playwright/test';
import {
  BODY_TIMING,
  REST_POSE,
  blinkAt,
  evaluateBodyMotion,
  initialBodyState,
  parseBodyState,
  type BodyContext,
  type BodyMotionState,
  type BodyPose,
} from '../src/world/body-motion';
import type { WorldEvent } from '../src/world/types';

const base: BodyContext = {
  timeMs: 0,
  deltaMs: 16,
  seed: 1234,
  posture: 'stand',
  authorActive: false,
  running: true,
  reducedMotion: false,
  position: { x: 500, y: 300 },
  heightPx: 190,
  pointer: { x: 900, y: 300 },
  idleSeconds: 0,
  scrollY: 0,
  events: [],
};
/** Runs frames at 60 fps from 0 to `until`, letting each frame override the context. */
function run(until: number, frame: (t: number) => Partial<BodyContext> = () => ({}), start?: BodyMotionState) {
  let state = start,
    pose: BodyPose = REST_POSE;
  const poses: { t: number; pose: BodyPose; state: BodyMotionState }[] = [];
  for (let t = 0; t <= until; t += 16) {
    const result = evaluateBodyMotion(state, { ...base, timeMs: t, ...frame(t) });
    state = result.state;
    pose = result.pose;
    poses.push({ t, pose, state });
  }
  return { state: state!, pose, poses };
}
const bone = (pose: BodyPose, name: string, axis: 0 | 1 | 2) =>
  (pose.bones as Record<string, number[]>)[name]?.[axis] ?? 0;

test('the same state and inputs give the same poses (deterministic, no clock or random)', () => {
  const frame = (t: number): Partial<BodyContext> => ({
    idleSeconds: t / 1000,
    events: t === 1600 ? [{ type: 'video.play' }] : [],
    scrollY: t > 3000 ? (t - 3000) * 5 : 0,
  });
  const a = run(6000, frame),
    b = run(6000, frame);
  expect(JSON.stringify(a.poses)).toBe(JSON.stringify(b.poses));
  // A different seed is a different character: its blinks fall elsewhere.
  const blinks = (seed: number) =>
    Array.from({ length: 400 }, (_, i) => blinkAt(i * 50, seed))
      .map((w) => (w > 0.5 ? 1 : 0))
      .join('');
  expect(blinks(1)).not.toBe(blinks(2));
});

test('reduced motion holds the rest pose, whatever happens', () => {
  const { poses } = run(3000, (t) => ({
    reducedMotion: true,
    idleSeconds: 10,
    events: t === 160 ? [{ type: 'video.play' }] : [],
  }));
  for (const { pose } of poses) expect(pose).toEqual(REST_POSE);
});

test('it breathes and blinks: the chest moves over a breath, the eyes close at least once in 8 s', () => {
  const { poses } = run(8000);
  const chest = poses.map(({ pose }) => bone(pose, 'chest', 0));
  expect(Math.max(...chest) - Math.min(...chest)).toBeGreaterThan(2);
  expect(Math.max(...poses.map(({ pose }) => pose.blink))).toBe(1);
  for (const { pose } of poses) {
    expect(pose.blink).toBeGreaterThanOrEqual(0);
    expect(pose.blink).toBeLessThanOrEqual(1);
  }
});

test("the author's motion comes first: only breathing and blinking are added", () => {
  const { poses } = run(6000, (t) => ({
    authorActive: true,
    posture: 'sit',
    idleSeconds: 10,
    events: t === 160 ? [{ type: 'video.play' }] : [],
    scrollY: t * 10,
  }));
  for (const { pose } of poses) {
    expect(Object.keys(pose.bones).sort()).toEqual(['chest', 'leftUpperArm', 'rightUpperArm', 'spine']);
    expect(bone(pose, 'chest', 1)).toBe(0);
    expect(pose.hips).toEqual([0, 0, 0]);
    expect(pose.yawDeg).toBe(0);
    expect(pose.offset).toEqual({ x: 0, y: 0 });
  }
});

test('left alone it looks around; when the pointer is in use it faces front again', () => {
  const alone = run(12000, () => ({ idleSeconds: 10 }));
  const yaws = alone.poses.map(({ pose }) => bone(pose, 'head', 1));
  expect(Math.max(...yaws.map(Math.abs))).toBeGreaterThan(5);
  const back = run(3000, () => ({ idleSeconds: 0.2, pointer: { x: 500, y: 100 } }), alone.state);
  expect(Math.abs(bone(back.pose, 'head', 1))).toBeLessThan(0.5);
});

test('when the person comes back after a while, it turns toward the pointer side', () => {
  const away = run(1000, () => ({ idleSeconds: 8 }));
  const back = run(600, () => ({ idleSeconds: 0.1, pointer: { x: 1400, y: 300 } }), away.state);
  expect(back.pose.yawDeg).toBeGreaterThan(5);
  expect(bone(back.pose, 'head', 1)).toBeGreaterThan(10);
  const left = run(600, () => ({ idleSeconds: 0.1, pointer: { x: 10, y: 300 } }), away.state);
  expect(left.pose.yawDeg).toBeLessThan(-5);
});

test('sitting: the legs swing, the body turns to a three-quarter view, the seat sits on the edge', () => {
  const { poses, pose } = run(4000, () => ({ posture: 'sit' }));
  const swing = poses.map(({ pose: p }) => bone(p, 'leftLowerLeg', 0));
  expect(Math.max(...swing) - Math.min(...swing)).toBeGreaterThan(5);
  // The two legs swing out of step.
  const mid = poses[60]!.pose;
  expect(Math.sign(bone(mid, 'leftLowerLeg', 0))).toBe(-Math.sign(bone(mid, 'rightLowerLeg', 0)));
  expect(pose.yawDeg).toBeGreaterThan(20);
  expect(pose.seat).toBe(true);
  // Standing: none of that.
  const stand = run(4000).pose;
  expect(bone(stand, 'leftLowerLeg', 0)).toBe(0);
  expect(stand.seat).toBe(false);
});

test('the video starting makes it hop: a crouch with the feet planted, up, then land', () => {
  const play: WorldEvent[] = [{ type: 'video.play' }];
  const { poses } = run(1200, (t) => ({ events: t === 160 ? play : [] }));
  const at = (ms: number) => poses.find(({ t }) => t >= 160 + ms)!.pose;
  expect(at(80).hips[1]).toBeLessThan(0);
  expect(at(80).plantFeet).toBe(true);
  expect(at(320).hips[1]).toBeGreaterThan(0.05);
  expect(at(320).plantFeet).toBe(false);
  expect(at(BODY_TIMING.hopMs + 100).hips[1]).toBe(0);
});

test('the video pausing makes it look down toward the video for a moment', () => {
  const { poses } = run(4000, (t) => ({ events: t === 160 ? [{ type: 'video.pause' }] : [] }));
  const pitch = (ms: number) => bone(poses.find(({ t }) => t >= 160 + ms)!.pose, 'head', 0);
  expect(pitch(1000)).toBeGreaterThan(8);
  expect(Math.abs(pitch(3500))).toBeLessThan(3);
});

test('a sudden fast scroll makes it shiver, briefly', () => {
  const { poses } = run(2000, (t) => ({ scrollY: t < 400 ? 0 : t < 432 ? 600 : 600 }));
  const shake = (ms: number) => Math.abs(bone(poses.find(({ t }) => t >= ms)!.pose, 'spine', 2));
  const during = poses.filter(({ t }) => t > 420 && t < 900).map(({ pose }) => Math.abs(bone(pose, 'spine', 2)));
  expect(Math.max(...during)).toBeGreaterThan(0.8);
  // Standing, nothing else tilts the spine sideways: once the shiver is over it is exactly level.
  expect(shake(1800)).toBe(0);
  // A slow scroll does nothing of the kind.
  const slow = run(2000, (t) => ({ scrollY: t * 0.5 }));
  expect(slow.poses.every(({ state }) => state.shiverUntilMs === 0)).toBe(true);
});

test('moving without walking: a short move hops along an arc, a long one blinks out and in', () => {
  const near = run(1000, (t) => ({ position: t < 200 ? { x: 500, y: 300 } : { x: 600, y: 300 } }));
  const after = (ms: number) => near.poses.find(({ t }) => t >= 200 + ms)!.pose;
  expect(after(0).offset.x).toBeCloseTo(-100, 0);
  expect(after(200).offset.y).toBeLessThan(-20);
  expect(after(BODY_TIMING.hopMoveMs + 50).offset).toEqual({ x: 0, y: 0 });
  expect(near.poses.every(({ pose }) => pose.opacity === 1)).toBe(true);
  const far = run(1000, (t) => ({ position: t < 200 ? { x: 500, y: 300 } : { x: 1500, y: 300 } }));
  const opacity = far.poses.filter(({ t }) => t >= 200).map(({ pose }) => pose.opacity);
  expect(Math.min(...opacity)).toBeLessThan(0.1);
  expect(far.pose.opacity).toBe(1);
  expect(far.pose.offset).toEqual({ x: 0, y: 0 });
  // The author's own path moves it: no hops, no blinking out.
  const authored = run(1000, (t) => ({ authorActive: true, position: { x: 500 + t, y: 300 } }));
  expect(authored.poses.every(({ pose }) => pose.offset.x === 0 && pose.opacity === 1)).toBe(true);
});

test('held (hidden page, approached control): the body rests but keeps the seat', () => {
  const sitting = run(1000, () => ({ posture: 'sit' }));
  const held = evaluateBodyMotion(sitting.state, { ...base, timeMs: 1100, posture: 'sit', running: false });
  expect(held.pose.bones).toEqual({});
  expect(held.pose.seat).toBe(true);
  expect(held.pose.yawDeg).toBe(0);
});

test('one frame not drawn (its part missing for a moment) keeps where the autonomy was: no jump home', () => {
  // Startled on its part's top: the pointer rushes at it, it flees (docs/characters/mirdo.md 10.).
  const personality = { shyness: 1, curiosity: 0, sleepiness: 0 };
  const rush = (t: number) => (t < 400 ? { x: 1100, y: 300 } : { x: 1100 - (t - 400) * 4, y: 300 });
  const fled = run(700, (t) => ({ personality, pointer: rush(t) }));
  const before = fled.state.autonomy!;
  expect(Math.hypot(before.offset.x, before.offset.y)).toBeGreaterThan(20);
  // A frame where it is not drawn, then drawn again with the pointer gone.
  const held = evaluateBodyMotion(fled.state, { ...base, timeMs: 716, personality, running: false });
  const after = evaluateBodyMotion(held.state, { ...base, timeMs: 732, personality, pointer: undefined });
  expect(after.state.autonomy!.offset.x).toBeCloseTo(before.offset.x, 0);
  expect(after.state.autonomy!.offset.y).toBeCloseTo(before.offset.y, 0);
  expect(after.state.autonomy!.startles).toBeGreaterThan(0);
});

test('recorded body states read back exactly, and malformed ones are refused', () => {
  const { state } = run(2000, (t) => ({ idleSeconds: 5, events: t === 160 ? [{ type: 'video.play' }] : [] }));
  const copy = JSON.parse(JSON.stringify(state));
  expect(parseBodyState(copy)).toEqual(state);
  expect(parseBodyState(initialBodyState())).toEqual(initialBodyState());
  expect(() => parseBodyState({ ...copy, extra: 1 })).toThrow();
  expect(() => parseBodyState({ ...copy, lookYaw: 1e9 })).toThrow();
  expect(() => parseBodyState({ ...copy, moveKind: 'walk' })).toThrow();
});

test('sitting down and standing up take a moment: the seat weight moves, never jumps', () => {
  // Standing, then sitting from 1 s, standing again from 2 s.
  const frames = run(3000, (t) => ({ posture: t >= 1000 && t < 2000 ? 'sit' : 'stand' })).poses;
  const weight = (p: BodyPose) => (p.seat ? (p.seatWeight ?? 1) : 0);
  const steps = frames.slice(1).map((f, i) => Math.abs(weight(f.pose) - weight(frames[i]!.pose)));
  // At most one frame's share of the blend per frame.
  for (const step of steps) expect(step).toBeLessThanOrEqual(16 / BODY_TIMING.seatBlendMs + 1e-3);
  expect(weight(frames.find((f) => f.t === 1008 + 16 * 22)!.pose)).toBe(1);
  expect(weight(frames.find((f) => f.t === 2000 + 16 * 22)!.pose)).toBe(0);
  // Half way down, the pose says how far (the renderer lowers the hips by that much).
  const half = frames.find((f) => f.t === 1008 + 16 * 10)!;
  expect(half.pose.seatWeight).toBeGreaterThan(0.3);
  expect(half.pose.seatWeight).toBeLessThan(1);
  // Standing again, nothing is kept: the state is as before.
  expect(frames.at(-1)!.state.seatWeight).toBeUndefined();
  // Recorded with the weight, read back exactly.
  expect(parseBodyState(JSON.parse(JSON.stringify(half.state)))).toEqual(half.state);
});
