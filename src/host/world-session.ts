import { createSignalSources } from './signals';
import { createWorldDevtools } from './world-devtools';
import type { PlaybackSource } from '../signals/types';
import { effectActive, maskOf, neededSignals, wantsPointerFrame, type WorldEffectTarget } from '../world/effects';
import { evaluatePreparedWorld, evaluateWorld, initialWorldState } from '../world/evaluate';
import { evaluateLayout } from '../world/layout';
import type { WorldEvent, WorldFrame, WorldGeometry, WorldInput, WorldLayout, WorldScene, WorldState } from '../world/types';

export interface WorldHostContext { scene: WorldScene; geometry: WorldGeometry; layout?: WorldLayout }
/** Browser inputs/scheduling only. The renderer receives data through apply(). */
export function createWorldSession(doc: Document, playback: PlaybackSource | undefined, apply: (frame: WorldFrame) => void,
  compare?: (scene: WorldScene, previous: WorldState, input: WorldInput, result: ReturnType<typeof evaluateWorld>) => void) {
  const view = doc.defaultView!, reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let targets: readonly WorldEffectTarget[] = [], context: WorldHostContext | undefined;
  let prepared: WorldLayout | undefined;
  let state = initialWorldState();
  let lifecyclePending = false;
  let lastFrame: WorldFrame | undefined, devtools: ReturnType<typeof createWorldDevtools>;
  let raf: number | undefined, listening = false;
  let subscribed = { pointer: false, video: false };
  const active = (target: WorldEffectTarget) => effectActive(target, targets, state.effects);
  const sources = createSignalSources(doc, playback, (source) => {
    if (source === 'pointer.position' && !devtools?.active && !wantsPointerFrame(targets, state.effects, sources.snapshot, view.performance.now())) return;
    schedule();
  }, () => { if (devtools?.active) schedule(); });
  const cancel = () => { if (raf !== undefined) view.cancelAnimationFrame(raf); raf = undefined; };
  const syncSources = (refresh = false) => {
    const needed = devtools?.active && !doc.hidden ? { pointer: true, video: true } : neededSignals(targets, state.effects, doc.hidden);
    if (refresh || needed.pointer !== subscribed.pointer || needed.video !== subscribed.video) { subscribed = needed; sources.configure(needed); }
  };
  const paint = (time: number) => {
    if (!context || !prepared) return;
    // Multiple browser callbacks may carry an earlier RAF timestamp in one frame.
    const timeMs = Math.max(state.timeMs ?? 0, time);
    const events: WorldEvent[] = [...(lifecyclePending ? [{ type: 'host.lifecycle' as const }] : []), ...sources.takeEvents(), ...(devtools?.takeEvents() ?? [])].slice(-64); lifecyclePending = false;
    const input: WorldInput = { ...context.geometry, timeMs, deltaMs: state.timeMs === null ? 0 : timeMs - state.timeMs,
      signals: { ...sources.snapshot }, events, environment: { hidden: doc.hidden, reducedMotion: reduced.matches } };
    const result = evaluatePreparedWorld(prepared, state, input);
    compare?.(context.scene, state, input, result);
    devtools?.capture(context.scene, input);
    state = result.state; lastFrame = result.frame;
    apply(result.frame);
    syncSources();
    syncListening();
    if (result.frame.needsFrame) schedule();
  };
  function schedule() {
    if (!doc.hidden && raf === undefined && (devtools?.active || targets.some(active))) raf = view.requestAnimationFrame((time) => { raf = undefined; paint(time); });
  }
  const enabledTargets = () => targets.filter((target) => target.renderable && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0);
  const syncListening = () => {
    const needed = Boolean(enabledTargets().length || devtools?.active);
    if (listening !== needed) {
      listening = needed;
      if (listening) { doc.addEventListener('visibilitychange', lifecycle); reduced.addEventListener('change', lifecycle); }
      else { doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); }
    }
  };
  const reconcile = () => {
    syncSources(true);
    syncListening();
    if (!enabledTargets().length && !devtools?.active || doc.hidden) cancel();
    paint(view.performance.now());
  };
  function lifecycle() { cancel(); lifecyclePending = true; reconcile(); }
  devtools = createWorldDevtools(doc, { scene: () => context?.scene, state: () => state, frame: () => lastFrame, refresh: reconcile, schedule });
  return {
    update(next: readonly WorldEffectTarget[], nextContext: WorldHostContext) {
      targets = next; context = nextContext; prepared = nextContext.layout ?? evaluateLayout(nextContext.scene, nextContext.geometry); reconcile();
    },
    destroy() {
      cancel(); sources.destroy();
      devtools?.destroy(); devtools = undefined; lastFrame = undefined;
      doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); listening = false;
      targets = []; context = undefined; prepared = undefined; state = initialWorldState(); subscribed = { pointer: false, video: false };
    },
  };
}
