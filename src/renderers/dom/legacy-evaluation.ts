/** Temporary numeric reference for 1d23ec0's draw/paint loops, not a second engine.
 * Shared unchanged geometry/mask primitives deliberately match the old imports.
 */
import { centre, placementBounds } from '../../world/geometry';
import { effectivelyLocked, groupView, parentGroup, rootLayers } from '../../world/hierarchy';
import { evaluateMask, fadeValue, retargetFade, type Fade } from '../../world/masks';
import {
  frameFor,
  WORLD_RUNTIME_VERSION,
  type WorldGeometry,
  type WorldScene,
  type WorldLayout,
  type WorldState,
  type WorldInput,
  type WorldFrame,
} from '../../world/types';
import type { EffectEvaluation, WorldEffectTarget } from '../../world/effects';

export function legacyLayout(scene: WorldScene, geometry: WorldGeometry): WorldLayout {
  const images = scene.decorations,
    groups = scene.groups ?? [];
  const layouts = new Map(
    groups.map((group) => {
      const layer = groupView(group, images, (placement) => frameFor(placement, geometry));
      const frame = frameFor(layer.placement, geometry);
      return [group.id, { layer, frame, bounds: frame ? placementBounds(layer.placement, frame) : undefined }] as const;
    }),
  );
  const onScreen = (bounds: ReturnType<typeof placementBounds>) =>
    bounds.right > 0 &&
    bounds.bottom > 0 &&
    bounds.left < geometry.viewport.width &&
    bounds.top < geometry.viewport.height;
  return {
    groups: groups.map((group) => {
      const { layer, frame, bounds } = layouts.get(group.id)!;
      const renderable = Boolean(
        frame &&
        group.visible &&
        group.opacity > 0 &&
        images.some(
          (image) =>
            group.children.includes(image.id) &&
            image.visible &&
            image.opacity > 0 &&
            onScreen(placementBounds(image.placement, frame)),
        ),
      );
      return {
        layer,
        ...(frame ? { frame } : {}),
        ...(bounds ? { bounds } : {}),
        visible: group.visible && Boolean(frame),
        renderable,
      };
    }),
    layers: images.map((item) => {
      const frame = frameFor(item.placement, geometry),
        parent = parentGroup(groups, item.id),
        parentLayout = parent && layouts.get(parent.id);
      const visible = item.visible && parent?.visible !== false,
        locked = effectivelyLocked(item, groups);
      const point = frame && centre(item.placement, frame),
        bounds = frame && placementBounds(item.placement, frame);
      const renderable = Boolean(bounds && visible && item.opacity > 0 && parent?.opacity !== 0 && onScreen(bounds));
      return {
        layer: item,
        ...(frame ? { frame } : {}),
        ...(bounds ? { bounds } : {}),
        ...(point
          ? {
              position: point,
              localPosition: {
                x: point.x - (parentLayout?.bounds?.left ?? 0),
                y: point.y - (parentLayout?.bounds?.top ?? 0),
              },
            }
          : {}),
        ...(parent ? { parentId: parent.id } : {}),
        visible: visible && Boolean(frame),
        locked,
        effectiveOpacity: item.opacity * (parent?.opacity ?? 1),
        renderable,
      };
    }),
    roots: rootLayers(images, groups).map((layer) => layer.id),
  };
}

export function legacyWorld(
  scene: WorldScene,
  previous: WorldState,
  input: WorldInput,
): { state: WorldState; frame: WorldFrame } {
  const layout = legacyLayout(scene, input);
  const targets: WorldEffectTarget[] = [...layout.groups, ...layout.layers].map((entry) => ({
    layer: entry.layer,
    renderable: entry.renderable,
    frame: entry.frame,
    ...('parentId' in entry && entry.parentId ? { parentId: entry.parentId } : {}),
  }));
  if (input.events.some((event) => event.type === 'host.lifecycle'))
    previous = { ...previous, effects: { fades: {}, visibility: {} } };
  const ids = new Set(targets.map((target) => target.layer.id));
  const fades = new Map<string, Fade>(),
    visibility = new Map(Object.entries(previous.effects.visibility).filter(([id]) => ids.has(id)));
  const maskOf = (target: WorldEffectTarget) =>
    target.layer.effects?.find((effect) => effect.kind === 'mask' && effect.enabled);
  const parentVisible = (target: WorldEffectTarget) =>
    !target.parentId ||
    (visibility.get(target.parentId) ??
      targets.find((parent) => parent.layer.id === target.parentId)?.renderable ??
      false);
  const active = (target: WorldEffectTarget) =>
    target.renderable &&
    parentVisible(target) &&
    target.frame &&
    target.layer.opacity > 0 &&
    (maskOf(target)?.intensity ?? 0) > 0;
  const effects: EffectEvaluation[] = [];
  let moving = false;
  for (const target of targets) {
    const { layer, frame } = target,
      mask = maskOf(target);
    if (!mask) {
      visibility.set(layer.id, target.renderable && parentVisible(target));
      effects.push({ id: layer.id, visible: visibility.get(layer.id)! });
      continue;
    }
    if (!frame || !active(target)) {
      visibility.set(layer.id, false);
      effects.push({
        id: layer.id,
        visible: false,
        mask: {
          center: { x: layer.placement.widthPx / 2, y: layer.placement.heightPx / 2 },
          radiusPx: mask.radiusPx,
          featherPx: mask.featherPx,
          intensity: 0,
        },
      });
      continue;
    }
    const value = evaluateMask(
      mask,
      layer.placement,
      frame,
      input.environment.reducedMotion ? { ...input.signals, pointer: undefined } : input.signals,
    );
    const old = Object.hasOwn(previous.effects.fades, layer.id) ? previous.effects.fades[layer.id] : undefined;
    const fade = retargetFade(
      old,
      value.gate,
      input.timeMs,
      input.environment.hidden || input.environment.reducedMotion ? 0 : value.fadeMs,
    );
    fades.set(layer.id, fade);
    const intensity = mask.intensity * fadeValue(fade, input.timeMs);
    visibility.set(layer.id, target.renderable && intensity > 0);
    effects.push({
      id: layer.id,
      visible: visibility.get(layer.id)!,
      mask: { center: value.center, radiusPx: mask.radiusPx, featherPx: mask.featherPx, intensity },
    });
    moving ||= fade.from !== fade.to && input.timeMs < fade.start + fade.duration;
  }
  const running = input.environment.hidden ? [] : targets.filter(active);
  const subscriptions = {
    pointer: running.some((target) =>
      maskOf(target)!.bindings.some((binding) => binding.source === 'pointer.position'),
    ),
    video: running.some((target) => maskOf(target)!.bindings.some((binding) => binding.source === 'video.playing')),
  };
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
      effects: { fades: Object.fromEntries(fades), visibility: Object.fromEntries(visibility) },
      machine,
    },
    frame: {
      timeMs: input.timeMs,
      layout,
      effects,
      machine,
      needsFrame: !input.environment.hidden && moving,
      subscriptions,
    },
  };
}
