import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { defaultModelSettings } from '../src/models/types';
import { defaultFollowMotion } from '../src/signals/motion';
import { initialWorldState, evaluateWorld } from '../src/world/evaluate';
import { createWorldRecorder, replayWorld } from '../src/world/recording';
import { createTakeSampler, parseSignalTake } from '../src/world/takes';
import type { ModelDecoration } from '../src/design/types';
import type { WorldInput, WorldScene } from '../src/world/types';
import { modelFixture } from './helpers/model-fixture';

function scenario() {
  const source = inspectAsset(modelFixture()).model!, model = defaultModelSettings(source);
  model.locomotion = { ...model.locomotion, enabled: true, idle: 0, walk: 1, run: 2, runSpeed: 200 };
  const layer: ModelDecoration = { kind: 'model3d', id: 'rig', name: 'Rig', assetId: `asset-${'f'.repeat(64)}`, source, model,
    opacity: 1, visible: true, locked: false, zIndex: 0, placement: { anchor: { kind: 'viewport' }, x: .2, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 25 }, motion: defaultFollowMotion() };
  const scene: WorldScene = { decorations: [layer] };
  const input = (n: number, fps = 60): WorldInput => ({ timeMs: n * 1000 / fps, deltaMs: n ? 1000 / fps : 0, viewport: { width: 1000, height: 800 }, anchors: {}, events: [], environment: { hidden: false, reducedMotion: false }, signals: { playing: true, pointer: { x: 850, y: 400 }, pointerTimeMs: n * 1000 / fps } });
  return { scene, layer, input };
}
test('shared pursuit accelerates into configured run, stops into idle and turns in 3D without changing artwork roll', () => {
  const { scene, input } = scenario(), before = JSON.stringify(scene), phases = new Set<string>(); let state = initialWorldState(), last;
  for (let n = 0; n <= 420; n++) { const r = evaluateWorld(scene, state, input(n)); state = r.state; last = r.frame; phases.add(r.frame.models![0]!.phase); expect(r.frame.layout.layers[0]!.layer.placement.rotationDeg).toBe(25); }
  expect([...phases].sort()).toEqual(['idle', 'run', 'walk']); expect(last!.models![0]).toMatchObject({ phase: 'idle', clip: 0, speedPx: 0 });
  expect(Math.hypot(last!.layout.layers[0]!.position!.x - 850, last!.layout.layers[0]!.position!.y - 400)).toBeCloseTo(48, 1);
  expect(last!.models![0]!.yawDeg).toBeCloseTo(90, 1); expect(JSON.stringify(scene)).toBe(before);
});
test('pursuit and clip/heading histories replay and reverse-seek exactly, including frozen frames', () => {
  const { scene, input } = scenario(), recorder = createWorldRecorder(); let state = initialWorldState(); recorder.start(scene, state);
  const frames = Array.from({ length: 180 }, (_, n) => { const i = input(n); if (n > 70 && n < 90) i.environment.hidden = true; recorder.capture(scene, i); const r = evaluateWorld(scene, state, i); state = r.state; return r.frame; });
  const recording = recorder.stop()!; expect(replayWorld(recording)).toEqual({ state, frames });
  const take = parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: state.runtimeVersion, id: 'model-pursuit', name: 'Rig', siteId: 'youtube', initialState: recording.initialState, inputs: recording.inputs }), sampler = createTakeSampler(scene, take);
  for (const n of [179, 50, 80, 0, 140]) expect(sampler.at(take.inputs[n]!.timeMs).frame).toEqual(frames[n]);
  expect(frames[80]!.models![0]!.timeMs).toBe(frames[79]!.models![0]!.timeMs);
});

test('authored bone look uses shared pointer/anchor coordinates, clamps, smooths and deterministically freezes', () => {
  const { scene, layer, input } = scenario(); delete layer.motion; layer.model.playing = false; layer.model.locomotion.enabled = false;
  layer.model.look = { enabled: true, bone: 3, yawLimit: 35, pitchLimit: 20, lagMs: 160 };
  let state = initialWorldState(), result = evaluateWorld(scene, state, input(0)); state = result.state;
  expect(result.frame.models![0]!.lookYaw).toBe(0);
  for (let n = 1; n <= 120; n++) { result = evaluateWorld(scene, state, input(n)); state = result.state; }
  expect(Math.abs(result.frame.models![0]!.lookYaw)).toBeLessThanOrEqual(35); expect(result.frame.models![0]!.lookYaw).toBeGreaterThan(10);
  expect(Math.abs(result.frame.models![0]!.lookPitch)).toBeLessThanOrEqual(20); expect(result.frame.needsFrame).toBe(false);
  const frozen = evaluateWorld(scene, state, { ...input(130), environment: { hidden: true, reducedMotion: false } });
  expect(frozen.frame.models![0]!.lookYaw).toBe(result.frame.models![0]!.lookYaw);
  const restored = evaluateWorld(scene, state, input(130)); expect(restored).toEqual(evaluateWorld(scene, state, input(130)));
});
