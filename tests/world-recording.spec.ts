import { test, expect } from '@playwright/test';
import {
  createWorldRecorder,
  parseWorldInput,
  parseWorldRecording,
  parseWorldScene,
  RECORDING_LIMITS,
  replayWorld,
} from '../src/world/recording';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { worldScenario } from './helpers/world-scenario';

test('recording is opt-in, records copied evaluation inputs only, and replays the same numeric frames', () => {
  const { scene: raw, inputs } = worldScenario(6),
    scene = parseWorldScene(raw),
    recorder = createWorldRecorder();
  expect(recorder.active).toBe(false);
  expect(recorder.capture(scene, inputs[0]!)).toBe(false);
  expect(recorder.stop()).toBeUndefined();
  let state = initialWorldState();
  recorder.start(scene, state);
  const frames = inputs.map((input) => {
    recorder.capture(scene, input);
    const result = evaluateWorld(scene, state, input);
    state = result.state;
    return result.frame;
  });
  const recording = recorder.stop()!,
    text = JSON.stringify(recording);
  expect(replayWorld(text)).toEqual({ state, frames });
  expect(JSON.stringify(replayWorld(text))).toBe(JSON.stringify(replayWorld(text)));
  expect(parseWorldRecording(text)).toEqual(recording);
  expect(text).not.toMatch(/https?:|cookie|authorization|innerHTML|textContent|keyCode|data:image|base64/);
  inputs[0]!.signals.playing = false;
  raw.decorations[0]!.name = 'changed later';
  expect(recording.inputs[0]!.signals.playing).toBe(true);
  expect(recording.scene.decorations[0]!.name).toBe('world-0.png');
});

test('recording can begin mid-fade with an explicit initial state and survive a JSON reload', () => {
  const { scene: raw, inputs } = worldScenario(8),
    scene = parseWorldScene(raw),
    recorder = createWorldRecorder();
  let state = initialWorldState();
  for (const input of inputs.slice(0, 36)) state = evaluateWorld(scene, state, input).state;
  recorder.start(scene, state);
  const frames = inputs.slice(36, 70).map((input) => {
    recorder.capture(scene, input);
    const result = evaluateWorld(scene, state, input);
    state = result.state;
    return result.frame;
  });
  expect(replayWorld(JSON.stringify(recorder.stop()))).toEqual({ state, frames });
});

test('capacity and artwork changes stop a recording without changing the scene or saved data', () => {
  const { scene, inputs } = worldScenario(4),
    recorder = createWorldRecorder(2);
  recorder.start(scene, initialWorldState());
  recorder.capture(scene, inputs[0]!);
  recorder.capture(scene, inputs[1]!);
  expect(recorder.status()).toEqual({ active: false, frames: 2, reason: 'capacity' });
  expect(recorder.capture(scene, inputs[2]!)).toBe(false);
  expect(recorder.stop()!.inputs).toHaveLength(2);
  recorder.start(scene, initialWorldState());
  recorder.capture(scene, inputs[0]!);
  const changed = structuredClone(scene);
  changed.decorations[0]!.opacity = 0.2;
  expect(recorder.capture(changed, inputs[1]!)).toBe(false);
  expect(recorder.status().reason).toBe('scene-changed');
  expect(recorder.stop()!.scene.decorations[0]!.opacity).toBe(scene.decorations[0]!.opacity);
  recorder.clear();
  expect(recorder.stop()).toBeUndefined();
  expect(recorder.active).toBe(false);
});

test('recordings reject private/executable fields, unknown events, bad seeds, geometry and versions', () => {
  const { scene, inputs } = worldScenario(4),
    recorder = createWorldRecorder();
  recorder.start(scene, initialWorldState());
  recorder.capture(scene, inputs[0]!);
  const recording = recorder.stop()!,
    input = recording.inputs[0]!;
  for (const value of [
    { ...input, url: 'https://private.example' },
    { ...input, cookie: 'secret' },
    { ...input, form: { value: 'secret' } },
    { ...input, signals: { ...input.signals, pageText: 'secret' } },
    { ...input, events: [{ type: 'keypress', key: 'secret' }] },
    { ...input, events: [{ type: 'pointer.click', point: { x: 1, y: 2, text: 'secret' } }] },
    { ...input, anchors: { player: { left: 0, top: 0, width: 0, height: 1 } } },
    { ...input, viewport: { width: 0, height: 10 } },
    { ...input, anchors: JSON.parse('{"__proto__":{"left":0,"top":0,"width":1,"height":1}}') },
    { ...input, seed: 1.5 },
    { ...input, seed: 0x100000000 },
    { ...input, timeMs: Infinity },
    { ...input, deltaMs: -1 },
    { ...input, events: Array(RECORDING_LIMITS.events + 1).fill({ type: 'video.play' }) },
  ])
    expect(() => parseWorldInput(value)).toThrow();
  for (const value of [
    { ...recording, runtimeVersion: 'future' },
    { ...recording, formatVersion: 4 },
    { ...recording, script: 'alert(1)' },
    { ...recording, scene: { ...scene, script: 'alert(1)' } },
    { ...recording, inputs: Array(RECORDING_LIMITS.frames + 1).fill(input) },
    { ...recording, initialState: { ...recording.initialState, random: 'Math.random()' } },
    {
      ...recording,
      initialState: {
        ...recording.initialState,
        effects: { fades: { missing: { from: 0, to: 1, start: 0, duration: 1 } }, visibility: {} },
      },
    },
    {
      ...recording,
      inputs: [
        { ...input, timeMs: 10 },
        { ...input, timeMs: 5 },
      ],
    },
    { ...recording, inputs: [input, { ...input, timeMs: RECORDING_LIMITS.durationMs + 1 }] },
  ])
    expect(() => parseWorldRecording(value)).toThrow();
});

test('click occurrences and lifecycle resets are deterministic data, not page commands', () => {
  const { scene, inputs } = worldScenario(4),
    recorder = createWorldRecorder();
  recorder.start(scene, initialWorldState());
  const input = {
    ...inputs[0]!,
    events: [{ type: 'pointer.click' as const, point: { x: 200, y: 150 } }, { type: 'host.lifecycle' as const }],
  };
  recorder.capture(scene, input);
  const replay = replayWorld(recorder.stop());
  expect(replay.frames[0]!.machine.events).toEqual(input.events);
  expect(replay.frames[0]!.machine.video).toBe('playing');
  expect(replay.frames[0]!.layout.layers).toHaveLength(4);
});
