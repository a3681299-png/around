import { test, expect } from '@playwright/test';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { sampleKeyframes, scrollProgress } from '../src/world/keyframes';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { createWorldRecorder, replayWorld, parseWorldRecording } from '../src/world/recording';
import { deleteDocumentLayers, duplicateDocumentLayers, ungroupLayers } from '../src/editor/groups';
import { worldScenario } from './helpers/world-scenario';

function scenario() {
  const base = worldScenario(2), scene = { ...base.scene, signalRules: [defaultScrollOpacityRule('image-0')] };
  scene.decorations.forEach((layer) => { layer.visible = true; layer.opacity = 1; layer.locked = false; }); scene.groups!.forEach((group) => { group.visible = true; group.locked = false; group.opacity = 1; });
  const input = (progress: number, timeMs = 0) => ({ ...base.inputs[0]!, timeMs, signals: { pointer: { x: 200, y: 250 }, playing: true, scroll: { x: 0, y: progress * 2000, maxX: 0, maxY: 2000 } } });
  return { scene, input };
}
test('scroll space is independent of recording time, speed and direction; clamped/no-scroll pages are finite', () => {
  const { scene, input } = scenario();
  for (const [progress, opacity] of [[0, 0], [.25, .5], [.5, 1], [.75, .5], [1, 0], [.25, .5]]) {
    for (const time of [0, 3000, 10000]) expect(evaluateWorld(scene, initialWorldState(), input(progress!, time)).frame.layout.layers[0]!.layer.opacity).toBeCloseTo(opacity!, 10);
  }
  expect(scrollProgress({ playing: false, pointer: undefined, scroll: { x: 0, y: 100, maxY: 0, maxX: 0 } })).toBe(0);
  expect(scrollProgress(input(-1).signals)).toBe(0); expect(scrollProgress(input(2).signals)).toBe(1);
  const keys = defaultScrollOpacityRule('image-0').keyframes; keys[0]!.easing = 'ease-in';
  expect(sampleKeyframes(keys, .25)).toBe(.25); expect(sampleKeyframes(keys, .5)).toBe(1);
});
test('groups, child rules and masks compose without mutating cached artwork; zero base opacity can be driven visible', () => {
  const { scene, input } = scenario(); scene.decorations[0]!.opacity = 0;
  const group = defaultScrollOpacityRule('group-0'); group.keyframes.forEach((key) => { key.value = .5; }); scene.signalRules.push(group);
  const before = JSON.stringify(scene), result = evaluateWorld(scene, initialWorldState(), input(.5));
  expect(result.frame.layout.layers[0]!.layer.opacity).toBe(1); expect(result.frame.layout.layers[0]!.effectiveOpacity).toBe(.5);
  expect(result.frame.layout.layers[0]!.renderable).toBe(true); expect(result.frame.effects[0]!.mask).toBeDefined(); expect(JSON.stringify(scene)).toBe(before);
});
test('validated rules roundtrip and reject unknown fields, targets, duplicates, modes, executable values and huge curves', () => {
  const { scene } = scenario(), design = { ...emptyDesign('youtube', null), ...scene }, parsed = parseDesign(design);
  expect(parsed.schemaVersion).toBe(10); expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  const rule = scene.signalRules[0]!;
  const malformed = [
    { ...rule, script: 'alert(1)' }, { ...rule, target: { layerId: 'missing', property: 'opacity' } },
    { ...rule, source: { ...rule.source, signal: 'window.eval' } }, { ...rule, evaluation: { mode: 'once', smoothing: { kind: 'none' } } },
    { ...rule, keyframes: [...rule.keyframes, rule.keyframes[0]] }, { ...rule, keyframes: Array(65).fill(rule.keyframes[0]) },
    { ...rule, keyframes: [{ ...rule.keyframes[0], input: NaN }] }, { ...rule, source: { ...rule.source, inputRange: [1, 0] } },
  ];
  for (const bad of malformed) expect(() => parseDesign({ ...design, signalRules: [bad] })).toThrow();
  expect(() => parseDesign({ ...design, signalRules: [rule, { ...rule, id: 'another' }] })).toThrow(/1本/);
  expect(() => parseDesign({ ...design, schemaVersion: 7 })).toThrow();
});
test('rule references follow duplication, deletion and ungrouping without duplicating assets', () => {
  const { scene } = scenario(), design = parseDesign({ ...emptyDesign('youtube', null), ...scene });
  let serial = 0; const copied = duplicateDocumentLayers(design, ['group-0'], () => `copy-${++serial}`, () => ({ left: 0, top: 0, width: 1000, height: 800 })).doc;
  expect(copied.signalRules).toHaveLength(2); expect(copied.signalRules![1]!.target.layerId).not.toBe('image-0');
  expect(new Set(copied.decorations.map((layer) => layer.assetId)).size).toBe(1);
  const removed = deleteDocumentLayers(design, ['group-0']); expect(removed.decorations).toHaveLength(0); expect(removed.signalRules ?? []).toHaveLength(0);
  const groupRule = defaultScrollOpacityRule('group-0'); design.signalRules!.push(groupRule);
  const ungrouped = ungroupLayers(design, 'group-0'); expect(ungrouped.signalRules).toHaveLength(1); expect(ungrouped.signalRules![0]!.target.layerId).toBe('image-0');
});
test('same recorded raw inputs reproduce group/mask/opacity frames, including backward scroll', () => {
  const { scene, input } = scenario(), recorder = createWorldRecorder(); let state = initialWorldState(); recorder.start(scene, state);
  const frames = [0, .25, .5, .75, 1, .5, .25, 0].map((progress, index) => { const value = input(progress, index * 50); recorder.capture(scene, value); const result = evaluateWorld(scene, state, value); state = result.state; return result.frame; });
  const recording = recorder.stop()!; expect(replayWorld(JSON.stringify(recording))).toEqual({ state, frames });
  const old = { ...recording, formatVersion: 2, runtimeVersion: '1.0.0', initialState: { ...recording.initialState, runtimeVersion: '1.0.0' }, scene: { decorations: scene.decorations, groups: scene.groups } };
  expect(parseWorldRecording(old).runtimeVersion).toBe('1.2.0');
});
