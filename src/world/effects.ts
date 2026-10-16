import type { LayerState } from '../design/types';
import type { SignalSnapshot } from '../signals/types';
import type { PlacementFrame, Point } from './geometry';
import { evaluateMask, fadeValue, retargetFade, type Fade } from './masks';

export interface WorldEffectTarget { layer: LayerState; frame: PlacementFrame | undefined; renderable: boolean; parentId?: string }
export interface EffectState { fades: Record<string, Fade>; visibility: Record<string, boolean> }
export interface MaskEvaluation { center: Point; radiusPx: number; featherPx: number; intensity: number }
export interface EffectEvaluation { id: string; visible: boolean; mask?: MaskEvaluation }
export const emptyEffectState = (): EffectState => ({ fades: {}, visibility: {} });
const own = <T>(values: Record<string, T>, id: string) => Object.hasOwn(values, id) ? values[id] : undefined;
export const maskOf = (target: WorldEffectTarget) => target.layer.effects?.find((effect) => effect.kind === 'mask' && effect.enabled);
const parentVisible = (target: WorldEffectTarget, targets: readonly WorldEffectTarget[], state: EffectState) => !target.parentId
  || (own(state.visibility, target.parentId) ?? targets.find((parent) => parent.layer.id === target.parentId)?.renderable ?? false);
export const effectActive = (target: WorldEffectTarget, targets: readonly WorldEffectTarget[], state: EffectState) => Boolean(target.renderable
  && parentVisible(target, targets, state) && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0);
export function neededSignals(targets: readonly WorldEffectTarget[], state: EffectState, hidden: boolean) {
  const active = hidden ? [] : targets.filter((target) => effectActive(target, targets, state));
  return { pointer: active.some((target) => maskOf(target)!.bindings.some((binding) => binding.source === 'pointer.position')),
    video: active.some((target) => maskOf(target)!.bindings.some((binding) => binding.source === 'video.playing')) };
}
export function wantsPointerFrame(targets: readonly WorldEffectTarget[], state: EffectState, signals: SignalSnapshot, timeMs: number): boolean {
  return targets.some((target) => {
    const mask = maskOf(target), fade = own(state.fades, target.layer.id);
    return effectActive(target, targets, state) && mask?.bindings.some((binding) => binding.source === 'pointer.position')
      && (!mask.bindings.some((binding) => binding.source === 'video.playing') || signals.playing || fade && fadeValue(fade, timeMs) > 0);
  });
}

/** Parent-first composition, exactly the same mask stage for groups and media. */
export function evaluateEffects(targets: readonly WorldEffectTarget[], previous: EffectState,
  input: { timeMs: number; signals: SignalSnapshot; environment: { hidden: boolean; reducedMotion: boolean } }) {
  const state = emptyEffectState(), ids = new Set(targets.map((target) => target.layer.id));
  for (const [id, visible] of Object.entries(previous.visibility)) if (ids.has(id)) state.visibility[id] = visible;
  const effects: EffectEvaluation[] = [];
  let moving = false;
  for (const target of targets) {
    const { layer, frame } = target, mask = maskOf(target);
    let evaluation: EffectEvaluation;
    if (!mask) evaluation = { id: layer.id, visible: target.renderable && parentVisible(target, targets, state) };
    else if (!frame || !effectActive(target, targets, state)) evaluation = { id: layer.id, visible: false,
      mask: { center: { x: layer.placement.widthPx / 2, y: layer.placement.heightPx / 2 }, radiusPx: mask.radiusPx, featherPx: mask.featherPx, intensity: 0 } };
    else {
      const value = evaluateMask(mask, layer.placement, frame, input.signals);
      const fade = retargetFade(own(previous.fades, layer.id), value.gate, input.timeMs, input.environment.hidden || input.environment.reducedMotion ? 0 : value.fadeMs);
      state.fades[layer.id] = fade;
      const intensity = mask.intensity * fadeValue(fade, input.timeMs);
      evaluation = { id: layer.id, visible: target.renderable && intensity > 0,
        mask: { center: value.center, radiusPx: mask.radiusPx, featherPx: mask.featherPx, intensity } };
      moving ||= fade.from !== fade.to && input.timeMs < fade.start + fade.duration;
    }
    state.visibility[layer.id] = evaluation.visible; effects.push(evaluation);
  }
  return { state, effects, needsFrame: !input.environment.hidden && moving, subscriptions: neededSignals(targets, state, input.environment.hidden) };
}
