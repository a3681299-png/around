import type { SignalRule } from '../signals/keyframes';
import type { WorldInput, WorldLayout } from './types';
import { signalContext, type PointerMemory } from './signals';

/** Authoring preview synthesizes numeric inputs; it never dispatches page actions. */
export function previewSignalInput(
  original: WorldInput,
  rule: SignalRule | undefined,
  value: number,
  layout: WorldLayout,
): { input: WorldInput; pointer?: PointerMemory } {
  const input: WorldInput = { ...original, timeMs: 100, deltaMs: 0, events: [], signals: { ...original.signals } };
  if (!rule || rule.source.signal === 'page.scroll.progress') {
    const maxY = Math.max(1, original.signals.scroll?.maxY ?? 1);
    input.signals.scroll = { x: 0, y: value * maxY, maxX: 0, maxY };
    return { input };
  }
  const context = signalContext(layout, rule.target.layerId),
    source = rule.source;
  const frame = source.space === 'viewport' ? { left: 0, top: 0, ...input.viewport } : context.frame;
  if (!frame) {
    input.signals.pointer = undefined;
    return { input };
  }
  const target =
    source.space === 'layer' ? context.target : { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  const point = { ...(original.signals.pointer ?? target ?? { x: 0, y: 0 }) };
  if (source.signal === 'pointer.x') point.x = frame.left + value * frame.width;
  else if (source.signal === 'pointer.y') point.y = frame.top + value * frame.height;
  else if (source.signal === 'pointer.distance' && target) {
    point.x = target.x - Math.max(0, value) * Math.hypot(frame.width, frame.height);
    point.y = target.y;
  } else if (source.signal === 'pointer.angle' && target) {
    const angle = (value * Math.PI) / 180;
    point.x = target.x - Math.cos(angle) * 100;
    point.y = target.y - Math.sin(angle) * 100;
  }
  input.signals.pointer = point;
  input.signals.pointerTimeMs = 100;
  return {
    input,
    ...(source.signal === 'pointer.speed'
      ? { pointer: { point: { x: point.x - Math.max(0, value) * 0.05, y: point.y }, timeMs: 50, speed: 0 } }
      : {}),
  };
}
