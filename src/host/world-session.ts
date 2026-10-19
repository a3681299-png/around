import { createSignalSources } from './signals';
import { createWorldDevtools } from './world-devtools';
import type { PlaybackSource } from '../signals/types';
import { effectActive, maskOf, neededSignals, wantsPointerFrame, type WorldEffectTarget } from '../world/effects';
import { evaluatePreparedWorld, evaluateWorld, initialWorldState, layoutEffectTargets } from '../world/evaluate';
import { evaluateLayout } from '../world/layout';
import type { WorldEvent, WorldFrame, WorldGeometry, WorldInput, WorldLayout, WorldScene, WorldState } from '../world/types';
import type { TimelineHost } from './timeline';

export interface WorldHostContext { scene: WorldScene; geometry: WorldGeometry; layout?: WorldLayout; holdTransforms?: boolean }
/** Browser inputs/scheduling only. The renderer receives data through apply(). */
export function createWorldSession(doc: Document, playback: PlaybackSource | undefined, apply: (frame: WorldFrame) => void,
  compare?: (scene: WorldScene, previous: WorldState, input: WorldInput, result: ReturnType<typeof evaluateWorld>) => void, timeline?: TimelineHost) {
  const view = doc.defaultView!, reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let targets: readonly WorldEffectTarget[] = [], context: WorldHostContext | undefined;
  let evaluatedTargets: readonly WorldEffectTarget[] = [];
  let prepared: WorldLayout | undefined;
  let state = initialWorldState();
  let lifecyclePending = false;
  let lastFrame: WorldFrame | undefined, devtools: ReturnType<typeof createWorldDevtools>;
  let raf: number | undefined, listening = false;
  let subscribed = { pointer: false, video: false, scroll: false };
  let heldSignals: WorldInput['signals'] | undefined;
  const motionActive = () => Boolean(prepared && [...prepared.groups, ...prepared.layers].some((entry) => entry.visible && entry.layer.motion?.enabled));
  const pointerRuleActive = () => Boolean(context?.scene.signalRules?.some((rule) => rule.enabled && rule.source.signal.startsWith('pointer.')));
  const ruleActive = () => Boolean(context?.scene.signalRules?.some((rule) => rule.enabled)) || motionActive();
  const active = (target: WorldEffectTarget) => effectActive(target, evaluatedTargets, state.effects);
  const sources = createSignalSources(doc, playback, (source) => {
    if (source === 'pointer.position' && !devtools?.active && !timeline?.observing && !timeline?.recording && !pointerRuleActive() && !motionActive() && !wantsPointerFrame(evaluatedTargets, state.effects, sources.snapshot, view.performance.now())) return;
    schedule();
  }, () => { if (devtools?.active || timeline?.recording) schedule(); });
  const cancel = () => { if (raf !== undefined) view.cancelAnimationFrame(raf); raf = undefined; };
  const syncSources = (refresh = false) => {
    const authoring = timeline?.observing || timeline?.recording;
    const masks = neededSignals(evaluatedTargets, state.effects, doc.hidden);
    const needed = timeline?.overriding ? { pointer: false, video: false, scroll: false } : { pointer: !doc.hidden && (masks.pointer || Boolean(devtools?.active || authoring) || pointerRuleActive() || motionActive()), video: !doc.hidden && (masks.video || Boolean(devtools?.active || authoring)), scroll: !doc.hidden && (Boolean(context?.scene.signalRules?.some((rule) => rule.enabled && rule.source.signal === 'page.scroll.progress')) || Boolean(devtools?.active) || Boolean(authoring)) };
    sources.recordClicks(Boolean(timeline?.recording && !doc.hidden));
    if (refresh || needed.pointer !== subscribed.pointer || needed.video !== subscribed.video || needed.scroll !== subscribed.scroll) { subscribed = needed; sources.configure(needed); }
  };
  const paint = (time: number) => {
    if (!context || !prepared) return;
    if (sources.overflowed && timeline?.recording) timeline.abortRecording('イベント数の上限に達したため録画を停止しました。');
    // Multiple browser callbacks may carry an earlier RAF timestamp in one frame.
    const timeMs = Math.max(state.timeMs ?? 0, time);
    const events: WorldEvent[] = [...(lifecyclePending ? [{ type: 'host.lifecycle' as const }] : []), ...sources.takeEvents(), ...(devtools?.takeEvents() ?? [])].slice(-64); lifecyclePending = false;
    if (context.holdTransforms) heldSignals ??= { ...sources.snapshot }; else heldSignals = undefined;
    const input: WorldInput = { ...context.geometry, timeMs, deltaMs: state.timeMs === null ? 0 : timeMs - state.timeMs,
      signals: { ...heldSignals ?? sources.snapshot }, events, environment: { hidden: doc.hidden, reducedMotion: reduced.matches, ...(context.holdTransforms ? { holdTransforms: true } : {}) } };
    const overridden = timeline?.preview(context.scene), result = overridden ?? evaluatePreparedWorld(prepared, state, input, context.scene.signalRules);
    if (!overridden) { if (!context.scene.signalRules?.length && !motionActive()) compare?.(context.scene, state, input, result); devtools?.capture(context.scene, input); timeline?.capture(context.scene, state, input, result); }
    state = result.state; lastFrame = result.frame; evaluatedTargets = context.scene.signalRules?.length || motionActive() ? layoutEffectTargets(result.frame.layout) : targets;
    apply(result.frame);
    syncSources();
    syncListening();
    // An overridden input has its own clock. A paused fade must not spin RAF,
    // and playing takes advance only when that clock requests another sample.
    if (result.frame.needsFrame && !overridden) schedule();
  };
  function schedule() {
    if (!doc.hidden && raf === undefined && (devtools?.active || ruleActive() || timeline?.recording || timeline?.playing || timeline?.observing || evaluatedTargets.some(active))) raf = view.requestAnimationFrame((time) => { raf = undefined; paint(time); });
  }
  const enabledTargets = () => evaluatedTargets.filter((target) => target.renderable && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0);
  const syncListening = () => {
    const needed = Boolean(enabledTargets().length || devtools?.active || ruleActive() || timeline?.recording || timeline?.playing || timeline?.observing);
    if (listening !== needed) {
      listening = needed;
      if (listening) { doc.addEventListener('visibilitychange', lifecycle); reduced.addEventListener('change', lifecycle); }
      else { doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); }
    }
  };
  const reconcile = () => {
    cancel();
    syncSources(true);
    syncListening();
    // A scene geometry refresh already includes any pending signal callback.
    // Cancel before paint, which may schedule the next frame of a real fade.
    cancel();
    paint(view.performance.now());
  };
  function lifecycle() { cancel(); lifecyclePending = true; reconcile(); }
  devtools = createWorldDevtools(doc, { scene: () => context?.scene, state: () => state, frame: () => lastFrame, refresh: reconcile, schedule });
  const detachTimeline = timeline?.attach({ refresh: reconcile, reset() { state = initialWorldState(); } });
  return {
    update(next: readonly WorldEffectTarget[], nextContext: WorldHostContext) {
      targets = next; evaluatedTargets = next; context = nextContext; prepared = nextContext.layout ?? evaluateLayout(nextContext.scene, nextContext.geometry); reconcile();
    },
    destroy() {
      detachTimeline?.(); cancel(); sources.destroy();
      devtools?.destroy(); devtools = undefined; lastFrame = undefined;
      doc.removeEventListener('visibilitychange', lifecycle); reduced.removeEventListener('change', lifecycle); listening = false;
      targets = []; evaluatedTargets = []; context = undefined; prepared = undefined; state = initialWorldState(); subscribed = { pointer: false, video: false, scroll: false };
    },
  };
}
