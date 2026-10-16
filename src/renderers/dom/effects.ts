import { createSignalSources } from '../../host/signals';
import { WORLD_MODE } from '../../host/world-options';
import type { PlaybackSource } from '../../signals/types';
import { effectActive, maskOf, neededSignals, wantsPointerFrame, type WorldEffectTarget } from '../../world/effects';
import { evaluateWorld, initialWorldState } from '../../world/evaluate';
import type { WorldEvent, WorldGeometry, WorldInput, WorldScene } from '../../world/types';
import { maskGradient } from './mask';
import { createLegacyEffectController } from './legacy-effects';
import { legacyWorld } from './legacy-evaluation';
import { assertWorldParity } from './parity';

export interface EffectTarget extends WorldEffectTarget { element: HTMLElement; visibility(value: boolean): void }
export interface WorldHostContext { scene: WorldScene; geometry: WorldGeometry }

/** Browser scheduling and DOM application; the numeric evaluation lives in world/. */
export function createEffectController(doc: Document, playback?: PlaybackSource) {
  if (WORLD_MODE === 'legacy') {
    const legacy = createLegacyEffectController(doc, playback);
    return { update(next: readonly EffectTarget[], _context: WorldHostContext) { legacy.update(next); }, destroy: legacy.destroy };
  }
  const view = doc.defaultView!, reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let targets: readonly EffectTarget[] = [], context: WorldHostContext | undefined;
  let state = initialWorldState();
  let lifecyclePending = false;
  let raf: number | undefined, listening = false;
  let subscribed = { pointer: false, video: false };
  const active = (target: EffectTarget) => effectActive(target, targets, state.effects);
  const sources = createSignalSources(doc, playback, (source) => {
    if (source === 'pointer.position' && !wantsPointerFrame(targets, state.effects, sources.snapshot, view.performance.now())) return;
    schedule();
  });
  const cancel = () => { if (raf !== undefined) view.cancelAnimationFrame(raf); raf = undefined; };
  const clear = (element: HTMLElement) => { element.style.removeProperty('mask-image'); element.removeAttribute('data-mask-intensity'); };
  const syncSources = (refresh = false) => {
    const needed = neededSignals(targets, state.effects, doc.hidden);
    if (refresh || needed.pointer !== subscribed.pointer || needed.video !== subscribed.video) { subscribed = needed; sources.configure(needed); }
  };
  const paint = (time: number) => {
    if (!context) return;
    // Multiple browser callbacks may carry an earlier RAF timestamp in one frame.
    const timeMs = Math.max(state.timeMs ?? 0, time);
    const events: WorldEvent[] = [...(lifecyclePending ? [{ type: 'host.lifecycle' as const }] : []), ...sources.takeEvents()]; lifecyclePending = false;
    const input: WorldInput = { ...context.geometry, timeMs, deltaMs: state.timeMs === null ? 0 : timeMs - state.timeMs,
      signals: { ...sources.snapshot }, events, environment: { hidden: doc.hidden, reducedMotion: reduced.matches } };
    const result = evaluateWorld(context.scene, state, input);
    if (WORLD_MODE === 'compare') assertWorldParity(result, legacyWorld(context.scene, state, input), 'world');
    state = result.state;
    const byId = new Map(result.frame.effects.map((effect) => [effect.id, effect]));
    for (const target of targets) {
      const value = byId.get(target.layer.id)!;
      if (value.mask) {
        target.element.style.maskImage = maskGradient({ ...value.mask, intensity: 1 }, value.mask.center, value.mask.intensity);
        target.element.dataset.maskIntensity = String(value.mask.intensity);
      } else clear(target.element);
      target.visibility(value.visible);
    }
    syncSources();
    if (result.frame.needsFrame) schedule();
  };
  function schedule() {
    if (!doc.hidden && raf === undefined && targets.some(active)) raf = view.requestAnimationFrame((time) => { raf = undefined; paint(time); });
  }
  const reconcile = () => {
    const enabled = targets.filter((target) => target.renderable && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0);
    syncSources(true);
    if (listening !== Boolean(enabled.length)) {
      listening = Boolean(enabled.length);
      if (listening) { doc.addEventListener('visibilitychange', lifecycle); reduced.addEventListener('change', lifecycle); }
      else { doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); }
    }
    if (!enabled.length || doc.hidden) cancel();
    paint(view.performance.now());
  };
  function lifecycle() { cancel(); lifecyclePending = true; reconcile(); }
  return {
    update(next: readonly EffectTarget[], nextContext: WorldHostContext) {
      const ids = new Set(next.map((target) => target.layer.id));
      for (const old of targets) if (!ids.has(old.layer.id)) clear(old.element);
      targets = next; context = nextContext; reconcile();
    },
    destroy() {
      cancel(); sources.destroy();
      doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); listening = false;
      targets.forEach((target) => clear(target.element)); targets = []; context = undefined; state = initialWorldState(); subscribed = { pointer: false, video: false };
    },
  };
}
