import type { SignalRule } from '../signals/keyframes';
import type { SignalTake, GhostKeyframe } from './takes';
import type { WorldScene, WorldLayout } from './types';
import { evaluateLayout } from './layout';
import { pointerMemory, signalValue, type PointerMemory } from './signals';
import { clampUnit, sampleKeyframes } from './keyframes';

export interface SignalSample {
  timeMs: number;
  input?: number;
  value?: number;
  raw?: number;
}
/** Recorded raw pointer coordinates/times remain reusable with a different rule. */
export function takeSignalSeries(take: SignalTake, rule: SignalRule, scene?: WorldScene): SignalSample[] {
  let pointer: PointerMemory | undefined = take.initialState.motion?.pointer,
    prepared: WorldLayout | undefined,
    geometry = '';
  return take.inputs.map((input) => {
    const signature = JSON.stringify([input.viewport, input.anchors]);
    if (scene && (!prepared || geometry !== signature)) {
      prepared = evaluateLayout(scene, input);
      geometry = signature;
    }
    pointer = pointerMemory(pointer, input);
    const raw = signalValue(rule, input, prepared, pointer);
    if (raw === undefined) return { timeMs: input.timeMs - take.inputs[0]!.timeMs };
    const x = clampUnit((raw - rule.source.inputRange[0]) / (rule.source.inputRange[1] - rule.source.inputRange[0]));
    return { timeMs: input.timeMs - take.inputs[0]!.timeMs, raw, input: x, value: sampleKeyframes(rule.keyframes, x) };
  });
}
/** Display projections only; exact runtime playback uses the full input history. */
export function projectNumericGhosts(series: readonly SignalSample[], rule: SignalRule, limit = 4096): GhostKeyframe[] {
  const ghosts: GhostKeyframe[] = [],
    seen = new Set<string>();
  const add = (keyId: string, input: number, timeMs: number) => {
    const signature = `${keyId}:${timeMs.toFixed(3)}`;
    if (ghosts.length < limit && !seen.has(signature)) {
      seen.add(signature);
      ghosts.push({ keyId, input, timeMs });
    }
  };
  for (const key of rule.keyframes) {
    if (series[0]?.input === key.input) add(key.id, key.input, 0);
    const rawKey = rule.source.inputRange[0] + key.input * (rule.source.inputRange[1] - rule.source.inputRange[0]);
    for (let i = 1; i < series.length && ghosts.length < limit; i++) {
      const a = series[i - 1]!,
        b = series[i]!;
      if (
        a.raw === undefined ||
        b.raw === undefined ||
        a.raw === b.raw ||
        (rule.source.signal === 'pointer.angle' && Math.abs(b.raw - a.raw) > 180)
      )
        continue;
      const amount = (rawKey - a.raw) / (b.raw - a.raw);
      if (amount >= 0 && amount <= 1) add(key.id, key.input, a.timeMs + (b.timeMs - a.timeMs) * amount);
    }
  }
  return ghosts.sort((a, b) => a.timeMs - b.timeMs);
}
