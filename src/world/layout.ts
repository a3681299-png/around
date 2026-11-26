import { centre, placementBounds, type PlacementFrame } from './geometry';
import type { LayerPlacement } from '../design/types';
import { effectivelyLocked, groupView, parentGroup, rootLayers } from './hierarchy';
import {
  frameFor,
  type WorldScene,
  type WorldGeometry,
  type WorldLayout,
  type GroupEvaluation,
  type LayerEvaluation,
} from './types';

/**
 * The placement as drawn on its frame: reduced with a part the adapter reports in its reduced form
 * (`reducedParts`: a video player's miniplayer), otherwise the same object. The layer is drawn by
 * the part's height against the height it last had when not reduced, so it keeps its share of the
 * part, from the same point of it; its size in the artwork stays as authored. Only the adapter's
 * report counts, never a size: a regular part is drawn as authored however small it is (a small
 * player, a window shrunk at once), so there is no threshold to step over (chunk 4 fix,
 * docs/layering-plan.md 9).
 */
function placedOn<T extends { placement: LayerPlacement }>(
  layer: T,
  frame: PlacementFrame | undefined,
  geometry: WorldGeometry,
): T {
  const anchor = layer.placement.anchor;
  const base = anchor.kind === 'surface' ? geometry.reducedParts?.[anchor.target] : undefined;
  // A base no taller than the part would enlarge it: a reduced form never draws larger.
  if (!frame || !base || !Number.isFinite(base) || frame.height <= 0 || frame.height >= base) return layer;
  const scale = frame.height / base;
  return {
    ...layer,
    placement: {
      ...layer.placement,
      widthPx: layer.placement.widthPx * scale,
      heightPx: layer.placement.heightPx * scale,
    },
  };
}

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
  const layers: LayerEvaluation[] = scene.decorations.map((authored) => {
    const frame = frameFor(authored.placement, geometry),
      layer = placedOn(authored, frame, geometry),
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
