import { test, expect } from '@playwright/test';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultSignalRule, defaultScrollOpacityRule, type SignalSource } from '../src/signals/keyframes';
import { defaultFollowMotion, parseMotion } from '../src/signals/motion';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { centre } from '../src/world/geometry';
import { signalValue, pointerMemory } from '../src/world/signals';
import { evaluateLayout } from '../src/world/layout';
import { createWorldRecorder, replayWorld, parseWorldState } from '../src/world/recording';
import { createTakeSampler, parseSignalTake } from '../src/world/takes';
import type { WorldInput, WorldScene } from '../src/world/types';
import { worldScenario } from './helpers/world-scenario';
import { previewSignalInput } from '../src/world/signal-preview';
import { takeSignalSeries } from '../src/world/take-signals';
import { projectGhosts } from '../src/world/takes';
import { parseTimelineCommand } from '../src/timeline/types';
import { groupLayers, ungroupLayers } from '../src/editor/groups';

function setup() {
  const { scene: source, inputs } = worldScenario(2);
  const scene: WorldScene = {
    decorations: source.decorations.map((entry, i) => ({
      ...entry,
      visible: true,
      opacity: 1,
      locked: false,
      effects: [],
      placement: { ...entry.placement, anchor: { kind: 'viewport' }, x: 0.25 + i * 0.1, y: 0.5, rotationDeg: 20 },
    })),
  };
  const input = (timeMs: number, x = 900, y = 400): WorldInput => ({
    ...inputs[0]!,
    viewport: { width: 1000, height: 800 },
    anchors: { player: { left: 100, top: 100, width: 600, height: 400 } },
    timeMs,
    deltaMs: 1000 / 60,
    events: [],
    environment: { hidden: false, reducedMotion: false },
    signals: { pointer: { x, y }, pointerTimeMs: timeMs, playing: true },
  });
  return { scene, input };
}

test('saved v9-v11 motions reject coerced modes on both layers and groups', () => {
  const { scene } = worldScenario(2);
  const motion = defaultFollowMotion();
  for (const version of [9, 10, 11]) {
    const doc = { ...emptyDesign('youtube', null), ...scene, schemaVersion: version };
    for (const mode of ['direct', 'smooth', 'pursuit']) {
      expect(
        parseDesign({
          ...doc,
          decorations: scene.decorations.map((layer) => ({ ...layer, motion: { ...motion, mode } })),
        }).decorations[0]!.motion?.mode,
      ).toBe(mode);
    }
    for (const mode of [
      ['smooth'],
      ['direct'],
      ['pursuit'],
      new String('smooth'),
      { toString: () => 'smooth' },
      null,
      1,
    ]) {
      const invalid = { ...motion, mode };
      expect(() => parseMotion(invalid)).toThrow();
      expect(() =>
        parseDesign({ ...doc, decorations: scene.decorations.map((layer) => ({ ...layer, motion: invalid })) }),
      ).toThrow();
      expect(() =>
        parseDesign({ ...doc, groups: scene.groups!.map((group) => ({ ...group, motion: invalid })) }),
      ).toThrow();
    }
    const json = JSON.stringify({
      ...doc,
      decorations: scene.decorations.map((layer) => ({ ...layer, motion: { ...motion, mode: ['smooth'] } })),
    });
    expect(() => parseDesign(JSON.parse(json))).toThrow();
  }
});

test('numeric signals share viewport/anchor/base-layer coordinates; missing anchors and zero ranges are safe', () => {
  const { scene, input } = setup(),
    i = input(0, 250, 400),
    layout = evaluateLayout(scene, i),
    rule = defaultScrollOpacityRule('image-0');
  const source = (signal: SignalSource['signal'], space: SignalSource['space']) => ({
    ...rule,
    source: { signal, axis: 'x' as const, space, inputRange: [0, 1] as [number, number] },
  });
  expect(signalValue(source('pointer.x', 'viewport'), i, layout)).toBe(0.25);
  expect(signalValue(source('pointer.y', 'viewport'), i, layout)).toBe(0.5);
  expect(signalValue(source('pointer.distance', 'layer'), i, layout)).toBe(0);
  expect(signalValue(source('pointer.distance', 'anchor'), i, layout)).toBeCloseTo(250 / Math.hypot(1000, 800));
  scene.decorations[0]!.placement.anchor = { kind: 'surface', target: 'player' };
  const anchored = evaluateLayout(scene, i);
  expect(signalValue(source('pointer.x', 'anchor'), i, anchored)).toBe(0.25);
  expect(signalValue(source('pointer.y', 'anchor'), i, anchored)).toBe(0.75);
  expect(signalValue(source('pointer.x', 'anchor'), i, evaluateLayout(scene, { ...i, anchors: {} }))).toBeUndefined();
  const p = pointerMemory(undefined, i)!,
    next = pointerMemory(p, input(100, 350, 400))!;
  expect(next.speed).toBe(1000);
  expect(pointerMemory(next, { ...input(110), signals: { ...i.signals, pointerTimeMs: 100 } })).toBe(next);
  expect(signalValue(source('pointer.speed', 'viewport'), input(201), layout, next)).toBe(0);
});

test('X/Y/rotation are offsets, opacity remains replacement; base data and prepared scene remain untouched', () => {
  const { scene, input } = setup();
  scene.signalRules = ['position.x', 'position.y', 'rotation', 'opacity'].map((property, index) => {
    const rule = defaultSignalRule('image-0', property as 'position.x', {
      signal: 'pointer.x',
      axis: 'x',
      space: 'viewport',
      inputRange: [0, 1],
    });
    rule.keyframes.forEach((key) => {
      key.value = [100, -50, 45, 0.7][index]!;
    });
    return rule;
  });
  const before = JSON.stringify(scene),
    result = evaluateWorld(scene, initialWorldState(), input(0));
  const layer = result.frame.layout.layers[0]!;
  expect(layer.position).toEqual({ x: 350, y: 350 });
  expect(layer.layer.placement.rotationDeg).toBe(65);
  expect(layer.layer.opacity).toBe(0.7);
  expect(JSON.stringify(scene)).toBe(before);
  const doc = parseDesign({ ...emptyDesign('youtube', null), ...scene });
  expect(parseDesign(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  expect(() =>
    parseDesign({ ...doc, signalRules: [...doc.signalRules!, { ...doc.signalRules![0]!, id: 'duplicate' }] }),
  ).toThrow(/1本/);
  expect(() => parseDesign({ ...doc, schemaVersion: 8 })).toThrow();
});

test('pursuit accelerates, caps speed, stops near cursor, faces travel, and does not jump on initialization', () => {
  const { scene, input } = setup();
  scene.decorations[0]!.motion = defaultFollowMotion();
  let state = initialWorldState(),
    last = { x: 250, y: 400 },
    distance = 650;
  for (let index = 0; index <= 600; index++) {
    const result = evaluateWorld(scene, state, input((index * 1000) / 60));
    state = result.state;
    const p = result.frame.layout.layers[0]!.position!,
      speed = Math.hypot(state.motion!.bodies['image-0']!.velocity.x, state.motion!.bodies['image-0']!.velocity.y);
    expect(speed).toBeLessThanOrEqual(400.00001);
    if (!index) expect(p).toEqual(last);
    expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThanOrEqual(400 / 60 + 0.001);
    const next = Math.hypot(900 - p.x, 400 - p.y);
    expect(next).toBeLessThanOrEqual(distance + 0.001);
    distance = next;
    last = p;
  }
  expect(distance).toBeCloseTo(48, 1);
  expect(state.motion!.bodies['image-0']!.heading).toBe(0);
  const hidden = evaluateWorld(scene, state, { ...input(20000), environment: { hidden: true, reducedMotion: false } });
  expect(hidden.frame.layout.layers[0]!.position).toEqual(last);
  expect(hidden.frame.needsFrame).toBe(false);
});

test('30/60/144Hz pursuit and exponential lag remain close; long gaps have bounded work', () => {
  const { scene, input } = setup();
  for (const mode of ['pursuit', 'smooth'] as const) {
    scene.decorations[0]!.motion = { ...defaultFollowMotion(), mode };
    const points = [30, 60, 144].map((fps) => {
      let state = initialWorldState(),
        point = { x: 0, y: 0 };
      for (let n = 0; n <= fps; n++) {
        const i = { ...input((n * 1000) / fps), deltaMs: n ? 1000 / fps : 0 },
          result = evaluateWorld(scene, state, i);
        state = result.state;
        point = result.frame.layout.layers[0]!.position!;
      }
      return point;
    });
    expect(Math.abs(points[0]!.x - points[2]!.x)).toBeLessThan(2);
    const gap = evaluateWorld(scene, initialWorldState(), { ...input(1e8), deltaMs: 1e8 });
    expect(Number.isFinite(gap.frame.layout.layers[0]!.position!.x)).toBe(true);
  }
});

test('group motion composes child offsets, rotations and opacity, using the existing effect stage', () => {
  const { scene, input } = setup();
  scene.groups = [
    {
      kind: 'group',
      id: 'group-0',
      name: 'Group',
      opacity: 0.5,
      visible: true,
      locked: false,
      zIndex: 0,
      children: ['image-0', 'image-1'],
      motion: { ...defaultFollowMotion(), mode: 'direct', stopRadius: 0, orientToMovement: false },
    },
  ];
  const r = defaultSignalRule('group-0', 'rotation', {
    signal: 'pointer.x',
    axis: 'x',
    space: 'viewport',
    inputRange: [0, 1],
  });
  r.keyframes.forEach((key) => {
    key.value = 90;
  });
  scene.signalRules = [r];
  const result = evaluateWorld(scene, initialWorldState(), input(0));
  const a = result.frame.layout.layers[0]!,
    b = result.frame.layout.layers[1]!;
  expect(a.position!.x).toBeCloseTo(900);
  expect(b.position!.x).toBeCloseTo(900);
  expect(b.position!.y - a.position!.y).toBeCloseTo(100);
  expect(a.layer.placement.rotationDeg).toBe(110);
  expect(a.effectiveOpacity).toBe(0.5);
});

test('record/replay and backward seeking reproduce every motion state at recorded samples', () => {
  const { scene, input } = setup();
  scene.decorations[0]!.motion = defaultFollowMotion();
  let state = initialWorldState();
  const recorder = createWorldRecorder();
  recorder.start(scene, state);
  const frames = Array.from({ length: 120 }, (_, n) => {
    const i = input((n * 1000) / 60, 500 + Math.sin(n / 20) * 300, 400 + Math.cos(n / 20) * 150);
    i.deltaMs = n ? 1000 / 60 : 0;
    recorder.capture(scene, i);
    const r = evaluateWorld(scene, state, i);
    state = r.state;
    return r.frame;
  });
  const recording = recorder.stop()!;
  expect(replayWorld(JSON.stringify(recording))).toEqual({ state, frames });
  expect(parseWorldState(state)).toEqual(state);
  const take = parseSignalTake({
      format: 'ww-signal-take',
      formatVersion: 1,
      runtimeVersion: '1.2.0',
      id: 'test-take',
      name: 'Motion',
      siteId: 'youtube',
      initialState: recording.initialState,
      inputs: recording.inputs,
    }),
    sampler = createTakeSampler(scene, take);
  for (const index of [119, 5, 90, 1, 60, 119])
    expect(sampler.at(take.inputs[index]!.timeMs).frame).toEqual(frames[index]);
  expect(centre(scene.decorations[0]!.placement, input(0).anchors['player']!)).toEqual({ x: 250, y: 300 });
});

test('v8 artwork and Runtime 1.1 takes migrate without mutation; malformed motions and executable drivers fail', () => {
  const { scene, input } = setup(),
    doc = {
      ...emptyDesign('youtube', null),
      ...scene,
      schemaVersion: 8,
      signalRules: [defaultScrollOpacityRule('image-0')],
    },
    before = JSON.stringify(doc);
  expect(parseDesign(doc).schemaVersion).toBe(13);
  expect(JSON.stringify(doc)).toBe(before);
  const old = {
    format: 'ww-signal-take',
    formatVersion: 1,
    runtimeVersion: '1.1.0',
    id: 'old-take',
    name: 'v1',
    siteId: 'youtube',
    initialState: { ...initialWorldState(), runtimeVersion: '1.1.0' },
    inputs: [input(0)],
  };
  expect(parseSignalTake(old).runtimeVersion).toBe('1.3.0');
  for (const motion of [
    { ...defaultFollowMotion(), maxSpeed: Infinity },
    { ...defaultFollowMotion(), acceleration: 0 },
    { ...defaultFollowMotion(), stopRadius: -1 },
    { ...defaultFollowMotion(), script: 'alert(1)' },
  ])
    expect(() =>
      parseDesign({ ...doc, schemaVersion: 11, decorations: [{ ...scene.decorations[0]!, motion }] }),
    ).toThrow();
  expect(() =>
    parseDesign({ ...doc, decorations: [{ ...scene.decorations[0]!, motion: defaultFollowMotion() }] }),
  ).toThrow();
  expect(() =>
    parseTimelineCommand({
      type: 'track',
      rule: { ...defaultScrollOpacityRule('image-0'), source: { signal: 'window.eval' } },
    }),
  ).toThrow();
});

test('mouse ghost projections use raw normalized values and skip angle wrap; signal preview does not alter recorded inputs', () => {
  const { scene, input } = setup(),
    rule = defaultSignalRule('image-0', 'position.x', {
      signal: 'pointer.x',
      axis: 'x',
      space: 'viewport',
      inputRange: [0, 1],
    });
  rule.keyframes.splice(1, 0, { id: 'middle', input: 0.5, value: 0, easing: 'ease-in' });
  const inputs = [input(0, 100), input(100, 900), input(200, 100)],
    take = parseSignalTake({
      format: 'ww-signal-take',
      formatVersion: 1,
      runtimeVersion: '1.2.0',
      id: 'mouse-take',
      name: 'Mouse',
      siteId: 'youtube',
      initialState: initialWorldState(),
      inputs,
    });
  const series = takeSignalSeries(take, rule, scene);
  expect(series.map((point) => point.input)).toEqual([0.1, 0.9, 0.1]);
  expect(
    projectGhosts(take, rule, scene)
      .filter((key) => key.keyId === 'middle')
      .map((key) => key.timeMs),
  ).toEqual([50, 150]);
  const before = JSON.stringify(take);
  const preview = previewSignalInput(
    inputs[0]!,
    { ...rule, source: { signal: 'pointer.distance', axis: 'y', space: 'layer', inputRange: [0, 1] } },
    0.25,
    evaluateLayout(scene, inputs[0]!),
  );
  expect(preview.input.signals.pointer).not.toEqual(inputs[0]!.signals.pointer);
  expect(JSON.stringify(take)).toBe(before);
});

test('group ungrouping protects an active transform controller and retains base placement after disabling it', () => {
  const { scene } = setup(),
    doc = structuredClone(
      groupLayers(parseDesign({ ...emptyDesign('youtube', null), ...scene }), ['image-0', 'image-1'], 'group-0'),
    );
  doc.groups![0]!.motion = defaultFollowMotion();
  expect(() => ungroupLayers(doc, 'group-0')).toThrow(/OFF/);
  doc.groups![0]!.motion!.enabled = false;
  const rule = defaultSignalRule('group-0', 'position.x', {
    signal: 'pointer.x',
    axis: 'x',
    space: 'viewport',
    inputRange: [0, 1],
  });
  doc.signalRules = [rule];
  expect(() => ungroupLayers(doc, 'group-0')).toThrow(/OFF/);
  rule.enabled = false;
  expect(ungroupLayers(doc, 'group-0').decorations.map((layer) => layer.placement)).toEqual(
    scene.decorations.map((layer) => layer.placement),
  );
});
