import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { defaultModelSettings } from '../src/models/types';
import { defaultFollowMotion } from '../src/signals/motion';
import { initialWorldState, evaluateWorld } from '../src/world/evaluate';
import { createWorldRecorder, parseWorldInput, replayWorld } from '../src/world/recording';
import { createTakeSampler, parseSignalTake, takeInput } from '../src/world/takes';
import type { ModelDecoration } from '../src/design/types';
import type { WorldInput, WorldScene } from '../src/world/types';
import { modelFixture } from './helpers/model-fixture';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { readFileSync } from 'node:fs';

test('G1.2: a take carries no Host restriction, and its recording format never accepts one', () => {
  const { at } = preG12Take();
  const live = { ...at(50), environment: { ...at(50).environment, approach: { layers: { rig: [] } } } };
  // A take is the creator's signals; restrictions are applied live when it plays.
  expect(takeInput(live).environment).toEqual({ hidden: false, reducedMotion: false });
  expect(takeInput(at(10))).toEqual(at(10));
  expect(() => parseWorldInput(JSON.parse(JSON.stringify(live)))).toThrow();
});

test('G1.2: a held root plays its take at rest; every other layer keeps the take values, and history stays clean', () => {
  const { scene, at } = preG12Take(),
    recorder = createWorldRecorder();
  let state = initialWorldState();
  recorder.start(scene, state);
  for (let n = 0; n < 120; n++) {
    const i = takeInput(at(n));
    recorder.capture(scene, i);
    state = evaluateWorld(scene, state, i).state;
  }
  const recording = recorder.stop()!;
  const take = parseSignalTake({
    format: 'around-signal-take',
    formatVersion: 1,
    runtimeVersion: state.runtimeVersion,
    id: 'g12-mix',
    name: 'Mix',
    siteId: 'youtube',
    initialState: recording.initialState,
    inputs: recording.inputs,
  });
  const sampler = createTakeSampler(scene, take),
    position = 1500;
  const free = sampler.at(position);
  const mixed = sampler.at(position, { layers: { petal: [] } });
  const layer = (result: typeof free, id: string) => result.frame.layout.layers.find((e) => e.layer.id === id)!;
  expect(layer(free, 'petal').layer.opacity).not.toBe(1);
  expect(layer(mixed, 'petal').layer.opacity).toBe(1);
  expect(layer(mixed, 'rig')).toEqual(layer(free, 'rig'));
  expect(mixed.frame.models).toEqual(free.frame.models);
  // The restriction applies to the returned frame only; checkpoints replay as before.
  expect(createTakeSampler(scene, take).at(position)).toEqual(free);
  expect(sampler.at(position)).toEqual(free);
});

test('G1.2: a take recorded before G1.2 replays the same frames, its whole-page restriction included', () => {
  // Written by the pre-G1.2 code from preG12Take() (tests/fixtures/takes/provenance.json).
  const fixture = JSON.parse(readFileSync('tests/fixtures/takes/pre-g12-take.json', 'utf8')) as {
    take: unknown;
    expected: { positionMs: number; result: unknown }[];
  };
  const sampler = createTakeSampler(preG12Take().scene, parseSignalTake(fixture.take));
  for (const { positionMs, result } of fixture.expected)
    expect(JSON.parse(JSON.stringify(sampler.at(positionMs)))).toEqual(result);
});

function scenario() {
  const source = inspectAsset(modelFixture()).model!,
    model = defaultModelSettings(source);
  model.locomotion = { ...model.locomotion, enabled: true, idle: 0, walk: 1, run: 2, runSpeed: 200 };
  const layer: ModelDecoration = {
    kind: 'model3d',
    id: 'rig',
    name: 'Rig',
    assetId: `asset-${'f'.repeat(64)}`,
    source,
    model,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    placement: { anchor: { kind: 'viewport' }, x: 0.2, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 25 },
    motion: defaultFollowMotion(),
  };
  const scene: WorldScene = { decorations: [layer] };
  const input = (n: number, fps = 60): WorldInput => ({
    timeMs: (n * 1000) / fps,
    deltaMs: n ? 1000 / fps : 0,
    viewport: { width: 1000, height: 800 },
    anchors: {},
    events: [],
    environment: { hidden: false, reducedMotion: false },
    signals: { playing: true, pointer: { x: 850, y: 400 }, pointerTimeMs: (n * 1000) / fps },
  });
  return { scene, layer, input };
}
test('G1.2: a held 3D layer pauses where it is and resumes from the same time; the whole-page restriction still restarts it', () => {
  const { scene, layer, input } = scenario();
  // One authored clip: a gait change on release would start a new clip by design.
  layer.model.locomotion = { ...layer.model.locomotion, enabled: false };
  let state = initialWorldState();
  for (let n = 0; n < 40; n++) state = evaluateWorld(scene, state, input(n)).state;
  const before = state.models!['rig']!;
  expect(before.timeMs).toBeGreaterThan(0);
  const hold = (n: number) => ({
    ...input(n),
    environment: { hidden: false, reducedMotion: false, approach: { layers: { rig: [] } } },
  });
  let held = evaluateWorld(scene, state, hold(40));
  for (let n = 41; n < 50; n++) held = evaluateWorld(scene, held.state, hold(n));
  // Paused in place: the same clip and time, suspended, its spring dynamics reset once more each frame.
  expect(held.state.models!['rig']).toMatchObject({
    clip: before.clip,
    timeMs: before.timeMs,
    phase: before.phase,
    suspended: true,
  });
  expect(held.frame.models![0]).toMatchObject({ resetDynamics: true, suspended: true });
  // Released, it continues from that time instead of starting the clip again.
  const resumed = evaluateWorld(scene, evaluateWorld(scene, held.state, input(50)).state, input(51));
  expect(resumed.state.models!['rig']!.timeMs).toBeGreaterThan(before.timeMs);
  // Old takes and reduced motion keep the former whole-page restriction: back to the start.
  const whole = evaluateWorld(scene, state, {
    ...input(40),
    environment: { hidden: false, reducedMotion: false, safeInteraction: true },
  });
  expect(whole.state.models!['rig']!.timeMs).toBe(0);
});

test('shared pursuit accelerates into configured run, stops into idle and turns in 3D without changing artwork roll', () => {
  const { scene, input } = scenario(),
    before = JSON.stringify(scene),
    phases = new Set<string>();
  let state = initialWorldState(),
    last;
  for (let n = 0; n <= 420; n++) {
    const r = evaluateWorld(scene, state, input(n));
    state = r.state;
    last = r.frame;
    phases.add(r.frame.models![0]!.phase);
    expect(r.frame.layout.layers[0]!.layer.placement.rotationDeg).toBe(25);
  }
  expect([...phases].sort()).toEqual(['idle', 'run', 'walk']);
  expect(last!.models![0]).toMatchObject({ phase: 'idle', clip: 0, speedPx: 0 });
  expect(Math.hypot(last!.layout.layers[0]!.position!.x - 850, last!.layout.layers[0]!.position!.y - 400)).toBeCloseTo(
    48,
    1,
  );
  expect(last!.models![0]!.yawDeg).toBeCloseTo(90, 1);
  expect(JSON.stringify(scene)).toBe(before);
});
/** A walking rig and a scroll-faded image, recorded while the pointer approached a control
 * (the whole-page restriction, frames 40-69) before G1.2. */
function preG12Take() {
  const { layer, input } = scenario();
  const image = {
    kind: 'image' as const,
    id: 'petal',
    name: 'Petal',
    assetId: `asset-${'e'.repeat(64)}`,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    placement: { anchor: { kind: 'viewport' as const }, x: 0.7, y: 0.3, widthPx: 120, heightPx: 90, rotationDeg: 0 },
    motion: { ...defaultFollowMotion(), mode: 'smooth' as const },
  };
  const full: WorldScene = { decorations: [layer, image], signalRules: [defaultScrollOpacityRule('petal')] };
  const at = (n: number): WorldInput => ({
    ...input(n),
    signals: { ...input(n).signals, scroll: { x: 0, y: (n * 9) % 1000, maxX: 0, maxY: 1000 } },
    environment: { hidden: false, reducedMotion: false, ...(n >= 40 && n < 70 ? { safeInteraction: true } : {}) },
  });
  return { scene: full, at };
}

test('pursuit and clip/heading histories replay and reverse-seek exactly, including frozen frames', () => {
  const { scene, input } = scenario(),
    recorder = createWorldRecorder();
  let state = initialWorldState();
  recorder.start(scene, state);
  const frames = Array.from({ length: 180 }, (_, n) => {
    const i = input(n);
    if (n > 70 && n < 90) i.environment.hidden = true;
    recorder.capture(scene, i);
    const r = evaluateWorld(scene, state, i);
    state = r.state;
    return r.frame;
  });
  const recording = recorder.stop()!;
  expect(replayWorld(recording)).toEqual({ state, frames });
  const take = parseSignalTake({
      format: 'around-signal-take',
      formatVersion: 1,
      runtimeVersion: state.runtimeVersion,
      id: 'model-pursuit',
      name: 'Rig',
      siteId: 'youtube',
      initialState: recording.initialState,
      inputs: recording.inputs,
    }),
    sampler = createTakeSampler(scene, take);
  for (const n of [179, 50, 80, 0, 140]) expect(sampler.at(take.inputs[n]!.timeMs).frame).toEqual(frames[n]);
  expect(frames[80]!.models![0]!.timeMs).toBe(frames[79]!.models![0]!.timeMs);
});

test('authored bone look uses shared pointer/anchor coordinates, clamps, smooths and deterministically freezes', () => {
  const { scene, layer, input } = scenario();
  delete layer.motion;
  layer.model.playing = false;
  layer.model.locomotion.enabled = false;
  layer.model.look = { enabled: true, bone: 3, yawLimit: 35, pitchLimit: 20, lagMs: 160 };
  let state = initialWorldState(),
    result = evaluateWorld(scene, state, input(0));
  state = result.state;
  expect(result.frame.models![0]!.lookYaw).toBe(0);
  for (let n = 1; n <= 120; n++) {
    result = evaluateWorld(scene, state, input(n));
    state = result.state;
  }
  expect(Math.abs(result.frame.models![0]!.lookYaw)).toBeLessThanOrEqual(35);
  expect(result.frame.models![0]!.lookYaw).toBeGreaterThan(10);
  expect(Math.abs(result.frame.models![0]!.lookPitch)).toBeLessThanOrEqual(20);
  expect(result.frame.needsFrame).toBe(false);
  const frozen = evaluateWorld(scene, state, { ...input(130), environment: { hidden: true, reducedMotion: false } });
  expect(frozen.frame.models![0]!.lookYaw).toBe(result.frame.models![0]!.lookYaw);
  const restored = evaluateWorld(scene, state, input(130));
  expect(restored).toEqual(evaluateWorld(scene, state, input(130)));
});
