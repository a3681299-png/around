import { groupBounds, type PlacementFrame } from './geometry';
import type { Decoration, GroupLayer, GroupView, LayerAppearance, LayerNode, LayerPlacement } from './types';

/** Array order breaks ties inside a sibling scope, just as DOM painting does. */
export function frontToBack<T extends LayerAppearance>(layers: readonly T[]): T[] {
  return layers.map((layer, index) => ({ layer, index })).sort((a, b) => b.layer.zIndex - a.layer.zIndex || b.index - a.index).map(({ layer }) => layer);
}
export const sameAnchor = (a: LayerPlacement['anchor'], b: LayerPlacement['anchor']) => a.kind === b.kind && (a.kind === 'viewport' || b.kind === 'surface' && a.target === b.target);
export const parentGroup = (groups: readonly GroupLayer[], id: string) => groups.find((group) => group.children.includes(id));
export const childrenOf = (group: GroupLayer, images: readonly Decoration[]) => group.children.map((id) => images.find((image) => image.id === id)!).filter(Boolean);
export function rootLayers(images: readonly Decoration[], groups: readonly GroupLayer[]): LayerNode[] {
  const children = new Set(groups.flatMap((group) => group.children));
  return [...images.filter((image) => !children.has(image.id)), ...groups];
}
export const effectivelyLocked = (layer: LayerNode, groups: readonly GroupLayer[]) => layer.locked || Boolean(parentGroup(groups, layer.id)?.locked);
export const groupMovable = (group: GroupLayer, images: readonly Decoration[]) => !group.locked && childrenOf(group, images).every((image) => !image.locked);

export function normalizeSelection(ids: readonly string[], images: readonly Decoration[], groups: readonly GroupLayer[]): string[] {
  const valid = new Set([...images, ...groups].map((layer) => layer.id));
  return [...new Set(ids)].filter((id) => valid.has(id) && !ids.includes(parentGroup(groups, id)?.id ?? ''));
}

/** Group drags include hidden children; protected descendants block the whole move. */
export function movableMedia(ids: readonly string[], images: readonly Decoration[], groups: readonly GroupLayer[]): Decoration[] {
  const wanted = new Set<string>();
  for (const id of normalizeSelection(ids, images, groups)) {
    const group = groups.find((group) => group.id === id);
    if (group) { if (group.visible && groupMovable(group, images)) group.children.forEach((id) => wanted.add(id)); continue; }
    const image = images.find((image) => image.id === id), parent = parentGroup(groups, id);
    if (image?.visible && !effectivelyLocked(image, groups) && parent?.visible !== false) wanted.add(id);
  }
  return images.filter((image) => wanted.has(image.id));
}

export function groupView(group: GroupLayer, images: readonly Decoration[], frameFor: (placement: LayerPlacement) => PlacementFrame | undefined): GroupView {
  const children = childrenOf(group, images), first = children[0]!;
  const frame = frameFor(first.placement);
  if (!frame) return { ...group, placement: { ...first.placement, rotationDeg: 0 } };
  const bounds = groupBounds(children.map((child) => ({ id: child.id, placement: child.placement, frame })))!;
  return { ...group, placement: { anchor: first.placement.anchor,
    x: ((bounds.left + bounds.right) / 2 - frame.left) / frame.width, y: ((bounds.top + bounds.bottom) / 2 - frame.top) / frame.height,
    widthPx: bounds.right - bounds.left, heightPx: bounds.bottom - bounds.top, rotationDeg: 0 } };
}
