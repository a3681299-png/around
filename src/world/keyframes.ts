import type { SignalRule, SignalKeyframe, KeyframeEasing } from '../signals/keyframes';
import type { SignalSnapshot } from '../signals/types';
import type { WorldLayout, WorldInput } from './types';
import { signalValue, type PointerMemory } from './signals';

export const clampUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export function scrollProgress(signals: SignalSnapshot): number {
  const scroll = signals.scroll;
  return scroll && scroll.maxY > 0 ? clampUnit(scroll.y / scroll.maxY) : 0;
}
export function ease(value: number, easing: KeyframeEasing): number {
  const x = clampUnit(value);
  return easing === 'ease-in' ? x * x : easing === 'ease-out' ? 1 - (1 - x) ** 2 : easing === 'ease-in-out' ? x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2 : x;
}
/** The left key owns easing for the segment leaving it. Endpoint values clamp. */
export function sampleKeyframes(keys: readonly SignalKeyframe[], input: number): number {
  if (!keys.length) return 1;
  const x = clampUnit(input), first = keys[0]!;
  if (x <= first.input) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const right = keys[i]!, left = keys[i - 1]!;
    if (x <= right.input) return left.value + (right.value - left.value) * ease((x - left.input) / (right.input - left.input), left.easing);
  }
  return keys.at(-1)!.value;
}
export function ruleInput(rule: SignalRule, input: SignalSnapshot | WorldInput, layout?: WorldLayout, pointer?: PointerMemory): number {
  const value = 'signals' in input ? signalValue(rule, input, layout, pointer) : rule.source.signal === 'page.scroll.progress' ? scrollProgress(input) : undefined;
  return clampUnit(((value ?? 0) - rule.source.inputRange[0]) / (rule.source.inputRange[1] - rule.source.inputRange[0]));
}
/** Copies only evaluated state. Saved layers and cached placement geometry stay intact. */
export function evaluateRuleLayout(layout: WorldLayout, rules: readonly SignalRule[], input: WorldInput): WorldLayout {
  const values = new Map(rules.filter((rule) => rule.enabled).map((rule) => [rule.target.layerId, sampleKeyframes(rule.keyframes, ruleInput(rule, input.signals))]));
  if (!values.size) return layout;
  const groups = layout.groups.map((group) => values.has(group.layer.id) ? { ...group, layer: { ...group.layer, opacity: values.get(group.layer.id)! } } : { ...group });
  const parents = new Map(groups.map((group) => [group.layer.id, group]));
  const layers = layout.layers.map((entry) => {
    const layer = values.has(entry.layer.id) ? { ...entry.layer, opacity: values.get(entry.layer.id)! } : entry.layer;
    const parent = entry.parentId ? parents.get(entry.parentId) : undefined, bounds = entry.bounds;
    const effectiveOpacity = layer.opacity * (parent?.layer.opacity ?? 1);
    return { ...entry, layer, effectiveOpacity, renderable: Boolean(entry.visible && bounds && effectiveOpacity > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < input.viewport.width && bounds.top < input.viewport.height) };
  });
  for (const group of groups) group.renderable = group.visible && group.layer.opacity > 0 && layers.some((layer) => layer.parentId === group.layer.id && layer.renderable);
  return { ...layout, groups, layers };
}
