import { emptyEffectState, evaluateEffects, type WorldEffectTarget } from './effects';
import { evaluateLayout } from './layout';
import { WORLD_RUNTIME_VERSION, type WorldScene, type WorldState, type WorldInput, type WorldLayout, type WorldFrame } from './types';
import { evaluateRuleLayout } from './keyframes';
import type { SignalRule } from '../signals/keyframes';

export const initialWorldState = (): WorldState => ({ runtimeVersion: WORLD_RUNTIME_VERSION, timeMs: null,
  effects: emptyEffectState(), machine: { video: 'paused', events: [] } });
export function layoutEffectTargets(layout: WorldLayout): WorldEffectTarget[] {
  return [...layout.groups, ...layout.layers].map((value) => ({ layer: value.layer, renderable: value.renderable,
    frame: value.frame, ...('parentId' in value && value.parentId ? { parentId: value.parentId } : {}) }));
}
/** All clocks, environment and geometry are inputs. No host or renderer calls. */
export function evaluateWorld(scene: WorldScene, previous: WorldState, input: WorldInput): { state: WorldState; frame: WorldFrame } {
  return evaluatePreparedWorld(evaluateLayout(scene, input), previous, input, scene.signalRules);
}
/** Static layout can be reused until the host changes artwork or geometry. */
export function evaluatePreparedWorld(prepared: WorldLayout, previous: WorldState, input: WorldInput, rules: readonly SignalRule[] = []): { state: WorldState; frame: WorldFrame } {
  if (previous.runtimeVersion !== WORLD_RUNTIME_VERSION) throw new Error('Unsupported World Runtime version.');
  if (!Number.isFinite(input.timeMs) || !Number.isFinite(input.deltaMs) || input.timeMs < 0 || input.deltaMs < 0
    || previous.timeMs !== null && input.timeMs < previous.timeMs) throw new Error('World Runtime requires monotonic finite time.');
  const effects = input.events.some((event) => event.type === 'host.lifecycle') ? emptyEffectState() : previous.effects;
  const layout = rules.length ? evaluateRuleLayout(prepared, rules, input) : prepared;
  const evaluated = evaluateEffects(layoutEffectTargets(layout), effects, input);
  const machine = { video: input.signals.playing ? 'playing' as const : 'paused' as const,
    events: input.events.map((event) => event.type === 'pointer.click' ? { ...event, point: { ...event.point } } : { ...event }) };
  return { state: { runtimeVersion: WORLD_RUNTIME_VERSION, timeMs: input.timeMs, effects: evaluated.state, machine },
    frame: { timeMs: input.timeMs, layout, effects: evaluated.effects, machine, needsFrame: evaluated.needsFrame, subscriptions: evaluated.subscriptions } };
}
