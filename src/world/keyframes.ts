import type { SignalRule, SignalKeyframe, KeyframeEasing } from '../signals/keyframes';
import type { SignalSnapshot } from '../signals/types';
import type { WorldLayout, WorldInput } from './types';
import { signalValue, type PointerMemory } from './signals';
import { SIGNAL_REGISTRY } from '../signals/registry';
export { scrollProgress } from '../signals/registry';

export const clampUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export function ease(value: number, easing: KeyframeEasing): number {
  const x = clampUnit(value);
  return easing === 'ease-in'
    ? x * x
    : easing === 'ease-out'
      ? 1 - (1 - x) ** 2
      : easing === 'ease-in-out'
        ? x < 0.5
          ? 2 * x * x
          : 1 - (-2 * x + 2) ** 2 / 2
        : x;
}
/** The left key owns easing for the segment leaving it. Endpoint values clamp. */
export function sampleKeyframes(keys: readonly SignalKeyframe[], input: number): number {
  if (!keys.length) return 1;
  const x = clampUnit(input),
    first = keys[0]!;
  if (x <= first.input) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const right = keys[i]!,
      left = keys[i - 1]!;
    if (x <= right.input)
      return left.value + (right.value - left.value) * ease((x - left.input) / (right.input - left.input), left.easing);
  }
  return keys.at(-1)!.value;
}
export function ruleInput(
  rule: SignalRule,
  input: SignalSnapshot | WorldInput,
  layout?: WorldLayout,
  pointer?: PointerMemory,
): number {
  const value =
    'signals' in input
      ? signalValue(rule, input, layout, pointer)
      : SIGNAL_REGISTRY.numericValue(rule.source, { signals: input });
  return clampUnit(
    ((value ?? 0) - rule.source.inputRange[0]) / (rule.source.inputRange[1] - rule.source.inputRange[0]),
  );
}
