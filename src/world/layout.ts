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
 * A part kind's smallest regular height (CSS px), by the anchor's semantic ID: a part kind every
 * adapter reports (src/sites/anchors.ts), never a site's element. Shown lower than this, the part
 * is a reduced form of itself (a video player's miniplayer, a small embed), and a layer placed on
 * it is drawn reduced with it: by the part's height against the height it last had at its regular
 * size (the Host's `regularHeights`; this height when none is known), so the layer keeps its share
 * of the part, from the same point of it. Its size in the artwork stays as authored: at the
 * regular size and above (the page's player, theater, fullscreen) nothing changes. 360: the
 * smallest regular video picture (360p); a miniplayer is about 225 (chunk 4 follow-up,
 * docs/layering-plan.md 「塊4の続き」).
 */
export const REGULAR_PART_HEIGHT_PX: Readonly<Record<string, number>> = Object.freeze({ 'video-player': 360 });
/** The placement as drawn on its frame: reduced with a reduced part, otherwise the same object. */
function placedOn<T extends { placement: LayerPlacement }>(
  layer: T,
  frame: PlacementFrame | undefined,
  geometry: WorldGeometry,
): T {
  const anchor = layer.placement.anchor;
  const regular = anchor.kind === 'surface' ? REGULAR_PART_HEIGHT_PX[anchor.target] : undefined;
  if (!frame || !regular || frame.height <= 0 || frame.height >= regular) return layer;
  const known = anchor.kind === 'surface' ? geometry.regularHeights?.[anchor.target] : undefined;
  const scale = frame.height / Math.max(regular, Number.isFinite(known) ? known! : regular);
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
