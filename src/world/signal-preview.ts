import type { SignalRule, SignalSource } from '../signals/keyframes';
import type { WorldInput, WorldLayout } from './types';
import type { PointerMemory } from './signals';
import { SIGNAL_REGISTRY } from '../signals/registry';

/** Authoring preview synthesizes numeric inputs; it never dispatches page actions. */
export function previewSignalInput(
  original: WorldInput,
  rule: SignalRule | undefined,
  value: number,
  layout: WorldLayout,
): { input: WorldInput; pointer?: PointerMemory } {
  const input: WorldInput = { ...original, timeMs: 100, deltaMs: 0, events: [], signals: { ...original.signals } };
  const source: SignalSource = rule?.source ?? {
    signal: 'page.scroll.progress',
    space: 'page',
    axis: 'y',
    inputRange: [0, 1],
  };
  const preview = SIGNAL_REGISTRY.numericPreview(source, value, {
    signals: input.signals,
    geometry: input,
    layout,
    ...(rule ? { layerId: rule.target.layerId } : {}),
  });
  return { input: { ...input, signals: preview.signals }, ...(preview.pointer ? { pointer: preview.pointer } : {}) };
}
