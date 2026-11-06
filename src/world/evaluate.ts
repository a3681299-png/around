import { evaluateModels, type ModelEvaluation } from './models';
import { emptyEffectState, evaluateEffects, type WorldEffectTarget } from './effects';
import { evaluateLayout } from './layout';
import {
  WORLD_RUNTIME_VERSION,
  type WorldScene,
  type WorldState,
  type WorldInput,
  type WorldLayout,
  type WorldFrame,
} from './types';
import type { SignalRule } from '../signals/keyframes';
import { evaluateTransforms } from './transforms';

export const initialWorldState = (): WorldState => ({
  runtimeVersion: WORLD_RUNTIME_VERSION,
  timeMs: null,
  effects: emptyEffectState(),
  machine: { video: 'paused', events: [] },
});
export function layoutEffectTargets(layout: WorldLayout): WorldEffectTarget[] {
  return [...layout.groups, ...layout.layers].map((value) => ({
    layer: value.layer,
    renderable: value.renderable,
    frame: value.frame,
    ...('parentId' in value && value.parentId ? { parentId: value.parentId } : {}),
  }));
}
/** All clocks, environment and geometry are inputs. No host or renderer calls. */
export function evaluateWorld(
  scene: WorldScene,
  previous: WorldState,
  input: WorldInput,
): { state: WorldState; frame: WorldFrame } {
  return evaluatePreparedWorld(evaluateLayout(scene, input), previous, input, scene.signalRules);
}
/** Static layout can be reused until the host changes artwork or geometry. */
export function evaluatePreparedWorld(
  prepared: WorldLayout,
  previous: WorldState,
  input: WorldInput,
  rules: readonly SignalRule[] = [],
): { state: WorldState; frame: WorldFrame } {
  if (previous.runtimeVersion !== WORLD_RUNTIME_VERSION) throw new Error('Unsupported World Runtime version.');
  if (
    !Number.isFinite(input.timeMs) ||
    !Number.isFinite(input.deltaMs) ||
    input.timeMs < 0 ||
    input.deltaMs < 0 ||
    (previous.timeMs !== null && input.timeMs < previous.timeMs)
  )
    throw new Error('World Runtime requires monotonic finite time.');
  const effects = input.events.some((event) => event.type === 'host.lifecycle') ? emptyEffectState() : previous.effects;
  const dynamic =
    rules.some((rule) => rule.enabled) ||
    [...prepared.groups, ...prepared.layers].some((entry) => entry.layer.motion?.enabled);
  const transformed = dynamic
    ? evaluateTransforms(prepared, rules, previous.timeMs === null ? { ...input, deltaMs: 0 } : input, previous.motion)
    : undefined;
  const layout = transformed?.layout ?? prepared;
  const evaluated = evaluateEffects(layoutEffectTargets(layout), effects, input);
  const models = layout.layers.some((e) => e.layer.kind === 'model3d')
    ? evaluateModels(
        layout,
        previous.models,
        previous.timeMs === null ? { ...input, deltaMs: 0 } : input,
        new Set(evaluated.effects.filter((e) => e.visible).map((e) => e.id)),
        transformed?.state,
      )
    : undefined;
  // A character that moved (a hop between anchors, a flight, the way home) is moved in the layout
  // itself, not only where it is drawn: the operation guard and the planes' clips then know where
  // it really is (a CSS translate would leave its bounds, and its protection, at home). Root
  // layers only; a layer inside a group keeps the drawn offset. The next frame's home is the
  // unshifted layout, so home never drifts.
  const moved = models ? shiftMovedModels(layout, models.evaluations) : undefined;
  const machine = {
    video: input.signals.playing ? ('playing' as const) : ('paused' as const),
    events: input.events.map((event) =>
      event.type === 'pointer.click' ? { ...event, point: { ...event.point } } : { ...event },
    ),
  };
  return {
    state: {
      runtimeVersion: WORLD_RUNTIME_VERSION,
      timeMs: input.timeMs,
      effects: evaluated.state,
      machine,
      ...(transformed ? { motion: transformed.state } : {}),
      ...(models ? { models: models.state } : {}),
    },
    frame: {
      timeMs: input.timeMs,
      layout: moved?.layout ?? layout,
      effects: evaluated.effects,
      machine,
      needsFrame: evaluated.needsFrame || Boolean(transformed?.needsFrame || models?.needsFrame),
      subscriptions: evaluated.subscriptions,
      ...(models ? { models: moved?.evaluations ?? models.evaluations } : {}),
    },
  };
}

/** The layout with every moved root character shifted by its move, and those moves taken out of
 * the drawn pose (it is now where it is drawn). Undefined when nothing moved. */
function shiftMovedModels(layout: WorldLayout, evaluations: readonly ModelEvaluation[]) {
  const offsets = new Map<string, { x: number; y: number }>();
  for (const e of evaluations) if (e.pose && (e.pose.offset.x || e.pose.offset.y)) offsets.set(e.id, e.pose.offset);
  if (!offsets.size) return undefined;
  const shifted = new Set<string>();
  const layers = layout.layers.map((entry) => {
    const o = offsets.get(entry.layer.id);
    if (!o || entry.parentId) return entry;
    shifted.add(entry.layer.id);
    const b = entry.bounds;
    return {
      ...entry,
      ...(entry.frame ? { frame: { ...entry.frame, left: entry.frame.left + o.x, top: entry.frame.top + o.y } } : {}),
      ...(b ? { bounds: { left: b.left + o.x, top: b.top + o.y, right: b.right + o.x, bottom: b.bottom + o.y } } : {}),
      ...(entry.position ? { position: { x: entry.position.x + o.x, y: entry.position.y + o.y } } : {}),
      ...(entry.localPosition
        ? { localPosition: { x: entry.localPosition.x + o.x, y: entry.localPosition.y + o.y } }
        : {}),
    };
  });
  if (!shifted.size) return undefined;
  return {
    layout: { ...layout, layers },
    evaluations: evaluations.map((e) =>
      shifted.has(e.id) && e.pose ? { ...e, pose: { ...e.pose, offset: { x: 0, y: 0 } } } : e,
    ),
  };
}
