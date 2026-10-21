import type { SignalRule } from '../signals/keyframes';
import { centre, placementBounds, rotation, type Point } from './geometry';
import { emptyMotionState, followMotion, type MotionState } from './motion';
import { pointerMemory, signalValue } from './signals';
import { clampUnit, sampleKeyframes } from './keyframes';
import type { WorldInput, WorldLayout } from './types';
import { SIGNAL_REGISTRY } from '../signals/registry';

/** Authored transforms -> numeric offsets -> motion -> parent composition. */
export function evaluateTransforms(
  prepared: WorldLayout,
  rules: readonly SignalRule[],
  input: WorldInput,
  previous?: MotionState,
) {
  const groups = prepared.groups.map((entry) => ({
    ...entry,
    layer: { ...entry.layer, placement: { ...entry.layer.placement } },
  }));
  const layers = prepared.layers.map((entry) => ({
    ...entry,
    layer: { ...entry.layer, placement: { ...entry.layer.placement } },
  }));
  const entries = [...groups, ...layers],
    byId = new Map(entries.map((entry) => [entry.layer.id, entry]));
  const state = emptyMotionState(),
    pointer = pointerMemory(previous?.pointer, input);
  if (pointer) state.pointer = pointer;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const entry = byId.get(rule.target.layerId),
      raw = signalValue(rule, input, prepared, pointer);
    if (!entry || raw === undefined) continue;
    const amount = clampUnit(
      (raw - rule.source.inputRange[0]) / (rule.source.inputRange[1] - rule.source.inputRange[0]),
    );
    const value = sampleKeyframes(rule.keyframes, amount),
      p = entry.layer.placement;
    if (rule.target.property === 'opacity') entry.layer.opacity = value;
    else if (rule.target.property === 'rotation') p.rotationDeg = rotation(p.rotationDeg + value);
    else if (entry.frame) {
      if (rule.target.property === 'position.x') p.x += value / entry.frame.width;
      else p.y += value / entry.frame.height;
    }
  }
  let needsFrame = false;
  for (const entry of entries) {
    const config = entry.layer.motion;
    if (!config?.enabled || !entry.frame) continue;
    const base = centre(entry.layer.placement, entry.frame),
      before = previous?.bodies[entry.layer.id];
    const visible =
      entry.visible &&
      (entry.layer.kind !== 'group' || layers.some((child) => child.parentId === entry.layer.id && child.visible));
    const followed = followMotion(
      config,
      before,
      base,
      visible && !input.environment.hidden && !input.environment.holdTransforms ? input.signals.pointer : undefined,
      input.deltaMs,
      input.environment.reducedMotion,
    );
    state.bodies[entry.layer.id] = followed.body;
    needsFrame ||= followed.needsFrame;
    entry.layer.placement.x += followed.body.offset.x / entry.frame.width;
    entry.layer.placement.y += followed.body.offset.y / entry.frame.height;
    if (config.orientToMovement && entry.layer.kind !== 'model3d')
      entry.layer.placement.rotationDeg = rotation(entry.layer.placement.rotationDeg + followed.body.heading);
  }
  const parents = new Map(groups.map((group, index) => [group.layer.id, { group, original: prepared.groups[index]! }]));
  const onScreen = (bounds: ReturnType<typeof placementBounds>) =>
    bounds.right > 0 && bounds.bottom > 0 && bounds.left < input.viewport.width && bounds.top < input.viewport.height;
  for (const group of groups) if (group.frame) group.bounds = placementBounds(group.layer.placement, group.frame);
  for (const entry of layers) {
    const frame = entry.frame;
    if (!frame) continue;
    const p = entry.layer.placement,
      parent = entry.parentId ? parents.get(entry.parentId) : undefined;
    let position = centre(p, frame),
      localPosition: Point = position;
    if (parent?.group.frame && parent.original.frame) {
      const a = centre(parent.original.layer.placement, parent.original.frame),
        b = centre(parent.group.layer.placement, parent.group.frame);
      const angle = (parent.group.layer.placement.rotationDeg * Math.PI) / 180,
        cos = Math.cos(angle),
        sin = Math.sin(angle),
        x = position.x - a.x,
        y = position.y - a.y;
      position = { x: b.x + x * cos - y * sin, y: b.y + x * sin + y * cos };
      localPosition = {
        x: x + parent.group.layer.placement.widthPx / 2,
        y: y + parent.group.layer.placement.heightPx / 2,
      };
      p.x = (position.x - frame.left) / frame.width;
      p.y = (position.y - frame.top) / frame.height;
      entry.localRotationDeg = p.rotationDeg;
      p.rotationDeg = rotation(p.rotationDeg + parent.group.layer.placement.rotationDeg);
    }
    entry.position = position;
    entry.localPosition = localPosition;
    entry.bounds = placementBounds(p, frame);
    entry.effectiveOpacity = entry.layer.opacity * (parent?.group.layer.opacity ?? 1);
    entry.renderable = entry.visible && entry.effectiveOpacity > 0 && onScreen(entry.bounds);
  }
  for (const group of groups)
    group.renderable =
      group.visible &&
      group.layer.opacity > 0 &&
      layers.some((entry) => entry.parentId === group.layer.id && entry.renderable);
  // A speed-driven rule needs one final evaluation after the last pointer sample.
  needsFrame ||= Boolean(
    rules.some(
      (rule) =>
        rule.enabled &&
        SIGNAL_REGISTRY.needsFrame(rule.source.signal, {
          signals: input.signals,
          timeMs: input.timeMs,
          ...(pointer ? { pointer } : {}),
        }),
    ),
  );
  return {
    layout: { ...prepared, groups, layers },
    state,
    needsFrame: needsFrame && !input.environment.hidden && !input.environment.holdTransforms,
  };
}
