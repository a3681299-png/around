import { test, expect } from '@playwright/test';
import { modelFixture } from './helpers/model-fixture';
import { inspectAsset } from '../src/assets/inspect';
import { defaultModelSettings } from '../src/models/types';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { createWorldRecorder, replayWorld, parseWorldState } from '../src/world/recording';
import { createTakeSampler, parseSignalTake } from '../src/world/takes';
import type { ModelDecoration } from '../src/design/types';
import type { WorldInput, WorldScene } from '../src/world/types';

export function modelScene() {
  const source = inspectAsset(modelFixture()).model!, layer: ModelDecoration = { kind: 'model3d', id: 'character', assetId: `asset-${'a'.repeat(64)}`, name: 'Rig', source, model: defaultModelSettings(source),
    opacity: 1, visible: true, locked: false, zIndex: 0, placement: { anchor: { kind: 'viewport' }, x: .25, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 0 } };
  const scene: WorldScene = { decorations: [layer] };
  const input = (timeMs: number, deltaMs = 100): WorldInput => ({ timeMs, deltaMs, viewport: { width: 1000, height: 800 }, anchors: {}, signals: { pointer: { x: 800, y: 400 }, pointerTimeMs: timeMs, playing: true }, events: [], environment: { hidden: false, reducedMotion: false } });
  return { scene, layer, input };
}
test('clip clocks, pause, rate, crossfade and non-loop end are numeric and deterministic', () => {
  const { scene, layer, input } = modelScene(); let result = evaluateWorld(scene, initialWorldState(), input(0));
  expect(result.frame.models![0]!.timeMs).toBe(0);
  result = evaluateWorld(scene, result.state, input(500, 500)); expect(result.frame.models![0]!.timeMs).toBe(500);
  layer.model.playing = false; result = evaluateWorld(scene, result.state, input(1000, 500)); expect(result.frame.models![0]!.timeMs).toBe(500); expect(result.frame.needsFrame).toBe(false);
  layer.model.playing = true; layer.model.speed = 2; layer.model.clip = 1;
  result = evaluateWorld(scene, result.state, input(1100)); expect(result.frame.models![0]).toMatchObject({ clip: 1, timeMs: 0, previousClip: 0, blend: 0 });
  result = evaluateWorld(scene, result.state, input(1225, 125)); expect(result.frame.models![0]).toMatchObject({ clip: 1, timeMs: 250, previousClip: 0, blend: .5 });
  result = evaluateWorld(scene, result.state, input(1350, 125)); expect(result.frame.models![0]).toMatchObject({ previousClip: null, blend: 1 });
  layer.model.loop = false; result = evaluateWorld(scene, result.state, input(5350, 4000)); expect(result.frame.models![0]!.timeMs).toBe(2000); expect(result.frame.needsFrame).toBe(false);
  const hidden = evaluateWorld(scene, result.state, { ...input(6000), environment: { hidden: true, reducedMotion: false } }); expect(hidden.frame.models![0]!.timeMs).toBe(2000);
});
test('model state records/replays and backward seeks exactly; old runtimes migrate; invalid state rejected', () => {
  const { scene, input } = modelScene(), recorder = createWorldRecorder(); recorder.start(scene, initialWorldState()); let state = initialWorldState();
  const frames = Array.from({ length: 90 }, (_, n) => { const i = input(n * 1000 / 60, n ? 1000 / 60 : 0); recorder.capture(scene, i); const r = evaluateWorld(scene, state, i); state = r.state; return r.frame; });
  const recording = recorder.stop()!; expect(replayWorld(recording)).toEqual({ state, frames }); expect(parseWorldState(state, scene)).toEqual(state);
  const take = parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: state.runtimeVersion, id: 'rig-take', name: 'Rig', siteId: 'youtube', initialState: recording.initialState, inputs: recording.inputs });
  const sampler = createTakeSampler(scene, take); for (const n of [89, 20, 70, 0]) expect(sampler.at(take.inputs[n]!.timeMs).frame).toEqual(frames[n]);
  expect(JSON.stringify(take)).not.toMatch(/asset-|clips|bones|https?:/);
  expect(parseWorldState({ ...initialWorldState(), runtimeVersion: '1.2.0' }).runtimeVersion).toBe(state.runtimeVersion);
  const invalid = structuredClone(state); invalid.models!['character']!.timeMs = Infinity; expect(() => parseWorldState(invalid)).toThrow();
});
