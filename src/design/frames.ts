import { placementFrame } from '../host/anchors';
export { placementFrame } from '../host/anchors';
import { placementBounds, type Bounds, type PlacementSample } from './geometry';
import type { DesignTarget, LayerState, Decoration, GroupLayer } from './types';
import { movableMedia, parentGroup } from './hierarchy';

export function editableSamples(doc: Document, anchors: readonly DesignTarget[], layers: readonly LayerState[], ids: readonly string[]): PlacementSample[] {
  return layers.flatMap((layer) => {
    const frame = !layer.locked && layer.visible && ids.includes(layer.id) ? placementFrame(doc, anchors, layer.placement) : undefined;
    return frame ? [{ id: layer.id, placement: { ...layer.placement }, frame }] : [];
  });
}

export function editableSceneSamples(doc: Document, anchors: readonly DesignTarget[], images: readonly Decoration[], groups: readonly GroupLayer[], ids: readonly string[]): PlacementSample[] {
  return movableMedia(ids, images, groups).flatMap((layer) => {
    const frame = placementFrame(doc, anchors, layer.placement);
    return frame ? [{ id: layer.id, placement: { ...layer.placement }, frame }] : [];
  });
}

export function snapTargets(doc: Document, anchors: readonly DesignTarget[], layers: readonly LayerState[], selectedIds: readonly string[], groups: readonly GroupLayer[] = []): Bounds[] {
  const viewport = { left: 0, top: 0, right: doc.defaultView!.innerWidth, bottom: doc.defaultView!.innerHeight };
  const surfaces = anchors.flatMap((anchor) => {
    const rect = doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`)?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? [{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }] : [];
  });
  const others = layers.flatMap((layer) => {
    const frame = layer.visible && parentGroup(groups, layer.id)?.visible !== false && !selectedIds.includes(layer.id) ? placementFrame(doc, anchors, layer.placement) : undefined;
    return frame ? [placementBounds(layer.placement, frame)] : [];
  });
  return [viewport, ...surfaces, ...others];
}
