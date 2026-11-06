import { createSignalSources } from './signals';
import { createWorldDevtools } from './world-devtools';
import type { PlaybackSource } from '../signals/types';
import { effectActive, maskOf, neededSignals, wantsPointerFrame, type WorldEffectTarget } from '../world/effects';
import { evaluatePreparedWorld, evaluateWorld, initialWorldState, layoutEffectTargets } from '../world/evaluate';
import { evaluateLayout } from '../world/layout';
import { startPage } from '../world/models';
import type {
  WorldEvent,
  WorldFrame,
  WorldGeometry,
  WorldInput,
  WorldLayout,
  WorldScene,
  WorldState,
} from '../world/types';
import type { TimelineHost } from './timeline';
import { rebaseWorldClock } from '../world/clock';
import { SIGNAL_REGISTRY } from '../signals/registry';
import type { OperationGuardHost } from './operation-guard';

export interface WorldHostContext {
  scene: WorldScene;
  geometry: WorldGeometry;
  layout?: WorldLayout;
  holdTransforms?: boolean;
  safety?: OperationGuardHost;
}
/** Browser inputs/scheduling only. The renderer receives data through apply(). */
export function createWorldSession(
  doc: Document,
  playback: PlaybackSource | undefined,
  apply: (frame: WorldFrame) => void,
  compare?: (
    scene: WorldScene,
    previous: WorldState,
    input: WorldInput,
    result: ReturnType<typeof evaluateWorld>,
  ) => void,
  timeline?: TimelineHost,
) {
  const view = doc.defaultView!,
    reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let targets: readonly WorldEffectTarget[] = [],
    context: WorldHostContext | undefined;
  let evaluatedTargets: readonly WorldEffectTarget[] = [];
  let prepared: WorldLayout | undefined;
  let state = initialWorldState();
  let wasPreview = false;
  let lifecyclePending = false;
  /** The address the last frame was painted for (startPage). */
  let page: string | undefined;
  let lastFrame: WorldFrame | undefined, devtools: ReturnType<typeof createWorldDevtools>;
  let raf: number | undefined,
    listening = false;
  let subscribed = { pointer: false, video: false, scroll: false };
  let heldSignals: WorldInput['signals'] | undefined;
  const motionActive = () =>
    Boolean(
      prepared &&
      [...prepared.groups, ...prepared.layers].some((entry) => entry.visible && entry.layer.motion?.enabled),
    );
  const modelActive = () =>
    Boolean(
      prepared?.layers.some(
        (entry) =>
          entry.renderable &&
          entry.layer.kind === 'model3d' &&
          (entry.layer.model.playing || entry.layer.model.look.enabled),
      ),
    );
  /** A shown character's computed motion reads the common signals (src/world/body-motion.ts):
   * the pointer (turning), the main video's play/pause (hop, look down) and scrolling (shiver). */
  const bodyActive = () =>
    Boolean(
      prepared?.layers.some(
        (entry) =>
          entry.renderable &&
          entry.layer.kind === 'model3d' &&
          Boolean(entry.layer.character) &&
          Boolean(entry.layer.source.vrm),
      ),
    );
  const lookActive = () =>
    Boolean(
      prepared?.layers.some(
        (entry) =>
          entry.renderable &&
          entry.layer.kind === 'model3d' &&
          entry.layer.model.look.enabled &&
          entry.layer.model.look.bone !== null,
      ),
    );
  const ruleSubscriptions = () =>
    SIGNAL_REGISTRY.subscriptions(
      context?.scene.signalRules?.filter((rule) => rule.enabled).map((rule) => rule.source.signal) ?? [],
    );
  const pointerRuleActive = () => ruleSubscriptions().pointer;
  const ruleActive = () =>
    Boolean(context?.scene.signalRules?.some((rule) => rule.enabled)) || motionActive() || modelActive();
  const active = (target: WorldEffectTarget) => effectActive(target, evaluatedTargets, state.effects);
  const sources = createSignalSources(
    doc,
    playback,
    (source, frameTime) => {
      if (
        SIGNAL_REGISTRY.requires(source, 'pointer') &&
        !devtools?.active &&
        !timeline?.observing &&
        !timeline?.recording &&
        !pointerRuleActive() &&
        !motionActive() &&
        !lookActive() &&
        !wantsPointerFrame(evaluatedTargets, state.effects, sources.snapshot, view.performance.now())
      )
        return;
      if (frameTime !== undefined && !doc.hidden) {
        // Scroll sampling already runs in RAF. Paint before this frame is presented.
        cancel();
        paint(frameTime);
      } else schedule();
    },
    () => {
      if (devtools?.active || timeline?.recording) schedule();
    },
  );
  const cancel = () => {
    if (raf !== undefined) view.cancelAnimationFrame(raf);
    raf = undefined;
  };
  const syncSources = (refresh = false) => {
    const authoring = timeline?.observing || timeline?.recording;
    const masks = neededSignals(evaluatedTargets, state.effects, doc.hidden);
    const rules = ruleSubscriptions();
    const needed = timeline?.overriding
      ? { pointer: false, video: false, scroll: false }
      : {
          pointer:
            !doc.hidden &&
            (masks.pointer ||
              Boolean(devtools?.active || authoring) ||
              rules.pointer ||
              motionActive() ||
              lookActive() ||
              bodyActive()),
          video: !doc.hidden && (masks.video || rules.video || Boolean(devtools?.active || authoring) || bodyActive()),
          scroll: !doc.hidden && (rules.scroll || Boolean(devtools?.active) || Boolean(authoring) || bodyActive()),
        };
    sources.recordClicks(Boolean(timeline?.recording && !doc.hidden));
    if (
      refresh ||
      needed.pointer !== subscribed.pointer ||
      needed.video !== subscribed.video ||
      needed.scroll !== subscribed.scroll
    ) {
      subscribed = needed;
      sources.configure(needed);
    }
  };
  const paint = (time: number) => {
    if (!context || !prepared) return;
    // The document's address (without its fragment) is the page, on every site: an SPA move
    // changes it without a new document. A new page starts each character's autonomy again at
    // home (startPage). One string comparison per frame; nothing in the page is searched.
    // Document.location is null for a document without a browsing context: no address, no move.
    const address = (doc.location?.href ?? '').split('#')[0]!;
    if (address !== page) {
      if (page !== undefined) state = startPage(state);
      page = address;
    }
    // Host restrictions are sampled first: a preview or take mixes in the live approach (G1.2).
    const safety = context.safety?.sample(time);
    const overridden = timeline?.preview(context.scene, safety?.approach);
    if (wasPreview && !overridden) state = rebaseWorldClock(state, time);
    wasPreview = Boolean(overridden);
    if (sources.overflowed && timeline?.recording)
      timeline.abortRecording('イベント数の上限に達したため録画を停止しました。');
    // Multiple browser callbacks may carry an earlier RAF timestamp in one frame.
    const timeMs = Math.max(state.timeMs ?? 0, time);
    const events: WorldEvent[] = [
      ...(lifecyclePending ? [{ type: 'host.lifecycle' as const }] : []),
      ...sources.takeEvents(),
      ...(devtools?.takeEvents() ?? []),
    ].slice(-64);
    lifecyclePending = false;
    if (context.holdTransforms) heldSignals ??= { ...sources.snapshot };
    else heldSignals = undefined;
    const input: WorldInput = {
      ...context.geometry,
      timeMs,
      deltaMs: state.timeMs === null ? 0 : timeMs - state.timeMs,
      signals: { ...(heldSignals ?? sources.snapshot) },
      events,
      environment: {
        hidden: doc.hidden,
        reducedMotion: reduced.matches,
        ...(context.holdTransforms ? { holdTransforms: true } : {}),
      },
    };
    if (safety) {
      input.signals.samples = { ...input.signals.samples, 'user.idle.duration': safety.idleSeconds };
      if (safety.approach) input.environment.approach = safety.approach;
    }
    // Reduced motion overrides a recorded or previewed frame whole; an approach is already
    // mixed into it, on the held roots only.
    const result = input.environment.reducedMotion
      ? evaluatePreparedWorld(prepared, state, input, context.scene.signalRules)
      : (overridden ?? evaluatePreparedWorld(prepared, state, input, context.scene.signalRules));
    if (!overridden) {
      if (
        !context.scene.signalRules?.length &&
        !motionActive() &&
        !prepared.layers.some((entry) => entry.layer.kind === 'model3d')
      )
        compare?.(context.scene, state, input, result);
      devtools?.capture(context.scene, input);
      timeline?.capture(context.scene, state, input, result);
    }
    state = result.state;
    lastFrame = result.frame;
    evaluatedTargets =
      context.scene.signalRules?.length || motionActive() ? layoutEffectTargets(result.frame.layout) : targets;
    apply(result.frame);
    syncSources();
    syncListening();
    // An overridden input has its own clock. A paused fade must not spin RAF,
    // and playing takes advance only when that clock requests another sample.
    if (result.frame.needsFrame && !overridden) schedule();
  };
  function schedule() {
    if (
      !doc.hidden &&
      raf === undefined &&
      (devtools?.active ||
        ruleActive() ||
        timeline?.recording ||
        timeline?.playing ||
        timeline?.observing ||
        evaluatedTargets.some(active))
    )
      raf = view.requestAnimationFrame((time) => {
        raf = undefined;
        paint(time);
      });
  }
  const enabledTargets = () =>
    evaluatedTargets.filter(
      (target) => target.renderable && target.frame && target.layer.opacity > 0 && (maskOf(target)?.intensity ?? 0) > 0,
    );
  const syncListening = () => {
    const needed = Boolean(
      enabledTargets().length ||
      devtools?.active ||
      ruleActive() ||
      timeline?.recording ||
      timeline?.playing ||
      timeline?.observing,
    );
    if (listening !== needed) {
      listening = needed;
      if (listening) {
        doc.addEventListener('visibilitychange', lifecycle);
        reduced.addEventListener('change', lifecycle);
      } else {
        doc.removeEventListener('visibilitychange', lifecycle);
        reduced.removeEventListener('change', lifecycle);
      }
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
  function lifecycle() {
    cancel();
    lifecyclePending = true;
    reconcile();
  }
  devtools = createWorldDevtools(doc, {
    scene: () => context?.scene,
    state: () => state,
    frame: () => lastFrame,
    refresh: reconcile,
    schedule,
  });
  const detachTimeline = timeline?.attach({
    refresh: reconcile,
    reset() {
      state = initialWorldState();
    },
  });
  return {
    update(next: readonly WorldEffectTarget[], nextContext: WorldHostContext) {
      targets = next;
      evaluatedTargets = next;
      context = nextContext;
      prepared = nextContext.layout ?? evaluateLayout(nextContext.scene, nextContext.geometry);
      reconcile();
    },
    destroy() {
      detachTimeline?.();
      cancel();
      sources.destroy();
      devtools?.destroy();
      devtools = undefined;
      lastFrame = undefined;
      doc.removeEventListener('visibilitychange', lifecycle);
      reduced.removeEventListener('change', lifecycle);
      listening = false;
      targets = [];
      evaluatedTargets = [];
      context = undefined;
      prepared = undefined;
      state = initialWorldState();
      subscribed = { pointer: false, video: false, scroll: false };
    },
  };
}
