import { centre, placementBounds } from './geometry';
import { effectivelyLocked, groupView, parentGroup, rootLayers } from './hierarchy';
import {
  frameFor,
  type WorldScene,
  type WorldGeometry,
  type WorldLayout,
  type GroupEvaluation,
  type LayerEvaluation,
} from './types';

/** Re-evaluate from native anchor coordinates; never accumulate viewport conversions. */
export function evaluateLayout(scene: WorldScene, geometry: WorldGeometry): WorldLayout {
  const groups = scene.groups ?? [];
  const onScreen = (bounds: ReturnType<typeof placementBounds>) =>
    bounds.right > 0 &&
    bounds.bottom > 0 &&
    bounds.left < geometry.viewport.width &&
    bounds.top < geometry.viewport.height;
  const compositions: GroupEvaluation[] = groups.map((group) => {
    const layer = groupView(group, scene.decorations, (placement) => frameFor(placement, geometry));
    const frame = frameFor(layer.placement, geometry),
      bounds = frame && placementBounds(layer.placement, frame);
    return {
      layer,
      ...(frame ? { frame } : {}),
      ...(bounds ? { bounds } : {}),
      visible: group.visible && Boolean(frame),
      renderable: Boolean(
        frame &&
        group.visible &&
        group.opacity > 0 &&
        scene.decorations.some(
          (image) =>
            group.children.includes(image.id) &&
            image.visible &&
            image.opacity > 0 &&
            onScreen(placementBounds(image.placement, frame)),
        ),
      ),
    };
  });
  const layouts = new Map(compositions.map((group) => [group.layer.id, group]));
  const layers: LayerEvaluation[] = scene.decorations.map((layer) => {
    const frame = frameFor(layer.placement, geometry),
      parent = parentGroup(groups, layer.id),
      parentLayout = parent && layouts.get(parent.id);
    const position = frame && centre(layer.placement, frame),
      bounds = frame && placementBounds(layer.placement, frame);
    const visible = layer.visible && parent?.visible !== false;
    return {
      layer,
      ...(frame ? { frame } : {}),
      ...(bounds ? { bounds } : {}),
      ...(position
        ? {
            position,
            localPosition: {
              x: position.x - (parentLayout?.bounds?.left ?? 0),
              y: position.y - (parentLayout?.bounds?.top ?? 0),
            },
          }
        : {}),
      ...(parent ? { parentId: parent.id } : {}),
      visible: visible && Boolean(frame),
      locked: effectivelyLocked(layer, groups),
      effectiveOpacity: layer.opacity * (parent?.opacity ?? 1),
      renderable: Boolean(bounds && visible && layer.opacity > 0 && parent?.opacity !== 0 && onScreen(bounds)),
    };
  });
  return { layers, groups: compositions, roots: rootLayers(scene.decorations, groups).map((layer) => layer.id) };
}
