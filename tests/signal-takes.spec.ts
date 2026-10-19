import { test, expect } from '@playwright/test';
import { createTakeSampler, parseSignalTake, takeDuration, TAKE_LIMITS, type SignalTake } from '../src/world/takes';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { WORLD_RUNTIME_VERSION, type WorldScene } from '../src/world/types';
import { defaultScrollOpacityRule } from '../src/signals/keyframes';
import { worldScenario } from './helpers/world-scenario';
import { parseTimelineCommand } from '../src/timeline/types';

export function sampleTake(): { take: SignalTake; scene: WorldScene } {
  const { scene, inputs } = worldScenario(6); scene.decorations.forEach((layer) => { layer.visible = true; layer.opacity = 1; }); scene.groups!.forEach((group) => { group.visible = true; group.opacity = 1; });
  scene.signalRules = [defaultScrollOpacityRule('image-0')];
  return { scene, take: parseSignalTake({ format: 'ww-signal-take', formatVersion: 1, runtimeVersion: WORLD_RUNTIME_VERSION, id: 'take-test', name: 'Take 1', siteId: 'youtube', initialState: initialWorldState(),
    inputs: inputs.map((input, index) => ({ ...input, signals: { ...input.signals, scroll: { x: 0, y: (index < 90 ? index / 90 : (180 - index) / 90) * 2000, maxX: 0, maxY: 2000 } } })) }) };
}
test('take JSON contains raw context, preserves events and never contains artwork or executable/private fields', () => {
  const { take } = sampleTake(); expect(parseSignalTake(JSON.stringify(take))).toEqual(take); expect(takeDuration(take)).toBe(2864);
  expect(JSON.stringify(take)).not.toMatch(/asset-|decorations|signalRules|https?:|cookie|authorization|innerHTML/);
  expect(take.inputs[0]!.signals.scroll).toEqual({ x: 0, y: 0, maxX: 0, maxY: 2000 });
  for (const value of [{ ...take, url: 'private' }, { ...take, script: 'alert(1)' }, { ...take, runtimeVersion: 'future' }, { ...take, inputs: [...take.inputs].reverse() },
    { ...take, inputs: Array(TAKE_LIMITS.samples + 1).fill(take.inputs[0]) }, { ...take, inputs: [{ ...take.inputs[0], signals: { ...take.inputs[0]!.signals, form: 'secret' } }] }]) expect(() => parseSignalTake(value)).toThrow();
  for (const value of [{ type: 'seek', timeMs: -1 }, { type: 'play', rate: 0 }, { type: 'preview', progress: 2 }, { type: 'record', script: 'alert(1)' }, { type: 'observe', value: 'true' }]) expect(() => parseTimelineCommand(value)).toThrow();
});
test('random seeks and reverse order restore the same complete Runtime frame as forward evaluation', () => {
  const { scene, take } = sampleTake(), frames = []; let state = take.initialState;
  for (const input of take.inputs) { const result = evaluateWorld(scene, state, input); state = result.state; frames.push(result); }
  const sampler = createTakeSampler(scene, take);
  for (const index of [179, 8, 90, 33, 0, 120, 89, 40, 32, 31, 0]) {
    const evaluated = sampler.at(take.inputs[index]!.timeMs - take.inputs[0]!.timeMs); expect(evaluated.frame).toEqual(frames[index]!.frame); expect(evaluated.state).toEqual(frames[index]!.state);
  }
  expect(sampler.checkpoints).toBeLessThan(8);
  const a = sampler.at(351.5), b = createTakeSampler(scene, take).at(351.5); expect(a).toEqual(b);
});
test('takes re-evaluate edited rules without pinning old artwork; layout and opacity remain deterministic', () => {
  const { scene, take } = sampleTake(), before = JSON.stringify(take);
  const old = createTakeSampler(scene, take).at(720);
  scene.signalRules![0]!.keyframes.forEach((key) => { key.value = .25; });
  const changed = createTakeSampler(scene, take).at(720); expect(changed.frame.layout.layers[0]!.layer.opacity).toBe(.25); expect(old.frame.layout.layers[0]!.layer.opacity).not.toBe(.25);
  expect(JSON.stringify(take)).toBe(before);
});
