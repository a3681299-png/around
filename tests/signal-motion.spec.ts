import { test, expect } from '@playwright/test';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultSignalRule, defaultScrollOpacityRule, type SignalSource } from '../src/signals/keyframes';
import { defaultFollowMotion } from '../src/signals/motion';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { centre } from '../src/world/geometry';
import { signalValue, pointerMemory } from '../src/world/signals';
import { evaluateLayout } from '../src/world/layout';
import { createWorldRecorder, replayWorld, parseWorldState } from '../src/world/recording';
import { createTakeSampler, parseSignalTake } from '../src/world/takes';
import type { WorldInput, WorldScene } from '../src/world/types';
import { worldScenario } from './helpers/world-scenario';

function setup() {
  const { scene: source, inputs } = worldScenario(2);
  const scene: WorldScene = { decorations: source.decorations.map((entry, i) => ({ ...entry, visible: true, opacity: 1, locked: false, effects: [], placement: { ...entry.placement, anchor: { kind: 'viewport' }, x: .25 + i * .1, y: .5, rotationDeg: 20 } })) };
  const input = (timeMs: number, x = 900, y = 400): WorldInput => ({ ...inputs[0]!, viewport: { width: 1000, height: 800 }, anchors: { player: { left: 100, top: 100, width: 600, height: 400 } }, timeMs, deltaMs: 1000 / 60, events: [], environment: { hidden: false, reducedMotion: false }, signals: { pointer: { x, y }, pointerTimeMs: timeMs, playing: true } });
  return { scene, input };
}

test('numeric signals share viewport/anchor/base-layer coordinates; missing anchors and zero ranges are safe', () => {
  const { scene, input } = setup(), i = input(0, 250, 400), layout = evaluateLayout(scene, i), rule = defaultScrollOpacityRule('image-0');
  const source = (signal: SignalSource['signal'], space: SignalSource['space']) => ({ ...rule, source: { signal, axis: 'x' as const, space, inputRange: [0, 1] as [number, number] } });
  expect(signalValue(source('pointer.x', 'viewport'), i, layout)).toBe(.25);
  expect(signalValue(source('pointer.y', 'viewport'), i, layout)).toBe(.5);
  expect(signalValue(source('pointer.distance', 'layer'), i, layout)).toBe(0);
  expect(signalValue(source('pointer.distance', 'anchor'), i, layout)).toBeCloseTo(250 / Math.hypot(1000, 800));
  scene.decorations[0]!.placement.anchor = { kind: 'surface', target: 'player' };
  const anchored = evaluateLayout(scene, i);
  expect(signalValue(source('pointer.x', 'anchor'), i, anchored)).toBe(.25);
  expect(signalValue(source('pointer.y', 'anchor'), i, anchored)).toBe(.75);
  expect(signalValue(source('pointer.x', 'anchor'), i, evaluateLayout(scene, { ...i, anchors: {} }))).toBeUndefined();
  const p = pointerMemory(undefined, i)!, next = pointerMemory(p, input(100, 350, 400))!;
  expect(next.speed).toBe(1000); expect(pointerMemory(next, { ...input(110), signals: { ...i.signals, pointerTimeMs: 100 } })).toBe(next);
  expect(signalValue(source('pointer.speed', 'viewport'), input(201), layout, next)).toBe(0);
});

test('X/Y/rotation are offsets, opacity remains replacement; base data and prepared scene remain untouched', () => {
  const { scene, input } = setup();
  scene.signalRules = ['position.x', 'position.y', 'rotation', 'opacity'].map((property, index) => {
    const rule = defaultSignalRule('image-0', property as 'position.x', { signal: 'pointer.x', axis: 'x', space: 'viewport', inputRange: [0, 1] });
    rule.keyframes.forEach((key) => { key.value = [100, -50, 45, .7][index]!; }); return rule;
  });
  const before = JSON.stringify(scene), result = evaluateWorld(scene, initialWorldState(), input(0));
  const layer = result.frame.layout.layers[0]!;
  expect(layer.position).toEqual({ x: 350, y: 350 }); expect(layer.layer.placement.rotationDeg).toBe(65); expect(layer.layer.opacity).toBe(.7);
  expect(JSON.stringify(scene)).toBe(before);
  const doc = parseDesign({ ...emptyDesign('youtube', null), ...scene }); expect(parseDesign(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  expect(() => parseDesign({ ...doc, signalRules: [...doc.signalRules!, { ...doc.signalRules![0]!, id: 'duplicate' }] })).toThrow(/1本/);
  expect(() => parseDesign({ ...doc, schemaVersion: 8 })).toThrow();
});

test('pursuit accelerates, caps speed, stops near cursor, faces travel, and does not jump on initialization', () => {
  const { scene, input } = setup(); scene.decorations[0]!.motion = defaultFollowMotion();
  let state = initialWorldState(), last = { x: 250, y: 400 }, distance = 650;
  for (let index = 0; index <= 600; index++) {
    const result = evaluateWorld(scene, state, input(index * 1000 / 60)); state = result.state;
    const p = result.frame.layout.layers[0]!.position!, speed = Math.hypot(state.motion!.bodies['image-0']!.velocity.x, state.motion!.bodies['image-0']!.velocity.y);
    expect(speed).toBeLessThanOrEqual(400.00001);
    if (!index) expect(p).toEqual(last);
    expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThanOrEqual(400 / 60 + .001);
    const next = Math.hypot(900 - p.x, 400 - p.y); expect(next).toBeLessThanOrEqual(distance + .001); distance = next; last = p;
  }
  expect(distance).toBeCloseTo(48, 1); expect(state.motion!.bodies['image-0']!.heading).toBe(0);
  const hidden = evaluateWorld(scene, state, { ...input(20000), environment: { hidden: true, reducedMotion: false } });
  expect(hidden.frame.layout.layers[0]!.position).toEqual(last); expect(hidden.frame.needsFrame).toBe(false);
});

test('30/60/144Hz pursuit and exponential lag remain close; long gaps have bounded work', () => {
  const { scene, input } = setup();
  for (const mode of ['pursuit', 'smooth'] as const) {
    scene.decorations[0]!.motion = { ...defaultFollowMotion(), mode };
    const points = [30, 60, 144].map((fps) => {
      let state = initialWorldState(), point = { x: 0, y: 0 };
      for (let n = 0; n <= fps; n++) { const i = { ...input(n * 1000 / fps), deltaMs: n ? 1000 / fps : 0 }, result = evaluateWorld(scene, state, i); state = result.state; point = result.frame.layout.layers[0]!.position!; }
      return point;
    });
    expect(Math.abs(points[0]!.x - points[2]!.x)).toBeLessThan(2);
    const gap = evaluateWorld(scene, initialWorldState(), { ...input(1e8), deltaMs: 1e8 }); expect(Number.isFinite(gap.frame.layout.layers[0]!.position!.x)).toBe(true);
  }
});

test('group motion composes child offsets, rotations and opacity, using the existing effect stage', () => {
  const { scene, input } = setup();
  scene.groups = [{ kind: 'group', id: 'group-0', name: 'Group', opacity: .5, visible: true, locked: false, zIndex: 0, children: ['image-0', 'image-1'], motion: { ...defaultFollowMotion(), mode: 'direct', stopRadius: 0, orientToMovement: false } }];
  const r = defaultSignalRule('group-0', 'rotation', { signal: 'pointer.x', axis: 'x', space: 'viewport', inputRange: [0, 1] }); r.keyframes.forEach((key) => { key.value = 90; }); scene.signalRules = [r];
  const result = evaluateWorld(scene, initialWorldState(), input(0));
  const a = result.frame.layout.layers[0]!, b = result.frame.layout.layers[1]!;
  expect(a.position!.x).toBeCloseTo(900); expect(b.position!.x).toBeCloseTo(900); expect(b.position!.y - a.position!.y).toBeCloseTo(100); expect(a.layer.placement.rotationDeg).toBe(110); expect(a.effectiveOpacity).toBe(.5);
});

test('record/replay and backward seeking reproduce every motion state at recorded samples', () => {
  const { scene, input } = setup(); scene.decorations[0]!.motion = defaultFollowMotion();
  let state = initialWorldState(); const recorder = createWorldRecorder(); recorder.start(scene, state);
  const frames = Array.from({ length: 120 }, (_, n) => { const i = input(n * 1000 / 60, 500 + Math.sin(n / 20) * 300, 400 + Math.cos(n / 20) * 150); i.deltaMs = n ? 1000 / 60 : 0; recorder.capture(scene, i); const r = evaluateWorld(scene, state, i); state = r.state; return r.frame; });
  const recording = recorder.stop()!; expect(replayWorld(JSON.stringify(recording))).toEqual({ state, frames }); expect(parseWorldState(state)).toEqual(state);
  const take = parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: '1.2.0', id: 'test-take', name: 'Motion', siteId: 'youtube', initialState: recording.initialState, inputs: recording.inputs }), sampler = createTakeSampler(scene, take);
  for (const index of [119, 5, 90, 1, 60, 119]) expect(sampler.at(take.inputs[index]!.timeMs).frame).toEqual(frames[index]);
  expect(centre(scene.decorations[0]!.placement, input(0).anchors['player']!)).toEqual({ x: 250, y: 300 });
});
