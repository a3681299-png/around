import { parseDesign } from '../design/schema';
import { childrenOf, effectivelyLocked, frontToBack, groupMovable, normalizeSelection, parentGroup, rootLayers, sameAnchor } from '../design/hierarchy';
import { moveGroup, type PlacementFrame } from '../design/geometry';
import { GROUP_LIMITS, IMAGE_LIMITS, type DesignDocument, type LayerNode, type LayerPlacement } from '../design/types';
import { deleteLayers, duplicateLayers, reorderLayers } from './layers';

function rank(doc: DesignDocument, backToFront: readonly LayerNode[]) {
  const ranks = new Map(backToFront.map((layer, index) => [layer.id, index]));
  doc.decorations = doc.decorations.map((layer) => ranks.has(layer.id) ? { ...layer, zIndex: ranks.get(layer.id)! } : layer);
  if (doc.groups) doc.groups = doc.groups.map((layer) => ranks.has(layer.id) ? { ...layer, zIndex: ranks.get(layer.id)! } : layer);
}

export function groupingReason(doc: DesignDocument, ids: readonly string[]): string {
  if (ids.length < 2) return '2枚以上のレイヤーを選択してください。';
  const groups = doc.groups ?? [], selected = doc.decorations.filter((image) => ids.includes(image.id));
  if (selected.length !== ids.length || selected.some((image) => parentGroup(groups, image.id))) return '最上位の素材だけをグループ化できます。ネストは未対応です。';
  if (groups.length >= GROUP_LIMITS.count) return 'グループは16個までです。';
  if (selected.some((image) => image.locked)) return '選択したレイヤーをロック解除してください。';
  if (selected.some((image) => !sameAnchor(image.placement.anchor, selected[0]!.placement.anchor))) return '画面基準とプレイヤー基準は分けてグループ化してください。';
  const roots = frontToBack(rootLayers(doc.decorations, groups)), positions = roots.flatMap((layer, index) => ids.includes(layer.id) ? [index] : []);
  if (Math.max(...positions) - Math.min(...positions) + 1 !== ids.length) return '見た目を保つため、重なり順が連続するレイヤーを選択してください。';
  return '';
}

export function groupLayers(input: DesignDocument, ids: readonly string[], id: string): DesignDocument {
  const reason = groupingReason(input, ids); if (reason) throw new Error(reason);
  const doc = parseDesign(input), roots = frontToBack(rootLayers(doc.decorations, doc.groups ?? [])).reverse();
  const children = roots.filter((layer) => ids.includes(layer.id));
  const group = { kind: 'group' as const, id, name: 'グループ', children: children.map((layer) => layer.id), opacity: 1, zIndex: 0, visible: true, locked: false };
  const insertion = roots.findIndex((layer) => ids.includes(layer.id)), remaining = roots.filter((layer) => !ids.includes(layer.id));
  remaining.splice(insertion, 0, group); doc.groups = [...doc.groups ?? [], group]; rank(doc, remaining);
  return parseDesign(doc);
}

export function ungroupLayers(input: DesignDocument, id: string): DesignDocument {
  const doc = parseDesign(input), group = doc.groups?.find((group) => group.id === id);
  if (!group || group.locked) throw new Error('解除するグループを選び、ロック解除してください。');
  if (group.opacity !== 1) throw new Error('重なりの見た目を保つため、不透明度を100%に戻してから解除してください。');
  const roots = frontToBack(rootLayers(doc.decorations, doc.groups ?? [])).reverse(), index = roots.findIndex((layer) => layer.id === id);
  roots.splice(index, 1, ...frontToBack(childrenOf(group, doc.decorations)).reverse());
  doc.decorations = doc.decorations.map((layer) => group.children.includes(layer.id) ? { ...layer, visible: layer.visible && group.visible } : layer);
  doc.groups = doc.groups!.filter((group) => group.id !== id); rank(doc, roots);
  return parseDesign(doc);
}

export function reorderDocument(input: DesignDocument, id: string, targetId: string, after: boolean): DesignDocument {
  const doc = parseDesign(input), groups = doc.groups ?? [];
  const parent = parentGroup(groups, id), targetParent = parentGroup(groups, targetId);
  if (parent?.id !== targetParent?.id) throw new Error('並び替えは同じ階層内で行ってください。');
  if (parent?.locked) throw new Error('親グループをロック解除してください。');
  if (!groups.length) { doc.decorations = reorderLayers(doc.decorations, id, targetId, after); return doc; }
  const scope = parent ? childrenOf(parent, doc.decorations) : rootLayers(doc.decorations, groups);
  const reordered = reorderLayers(scope, id, targetId, after), values = new Map(reordered.map((layer) => [layer.id, layer.zIndex]));
  doc.decorations = doc.decorations.map((layer) => values.has(layer.id) ? { ...layer, zIndex: values.get(layer.id)! } : layer);
  if (doc.groups) doc.groups = doc.groups.map((layer) => values.has(layer.id) ? { ...layer, zIndex: values.get(layer.id)! } : layer);
  return parseDesign(doc);
}

export function deleteDocumentLayers(input: DesignDocument, ids: readonly string[]): DesignDocument {
  const doc = parseDesign(input), groups = doc.groups ?? [];
  if (!groups.length) { doc.decorations = deleteLayers(doc.decorations, ids); return doc; }
  const removed = new Set<string>(), removedGroups = new Set<string>();
  for (const id of normalizeSelection(ids, doc.decorations, groups)) {
    const group = groups.find((group) => group.id === id);
    if (group) { if (groupMovable(group, doc.decorations)) { removedGroups.add(id); group.children.forEach((id) => removed.add(id)); } }
    else { const image = doc.decorations.find((image) => image.id === id); if (image && !effectivelyLocked(image, groups)) removed.add(id); }
  }
  doc.decorations = doc.decorations.filter((image) => !removed.has(image.id));
  doc.groups = groups.filter((group) => !removedGroups.has(group.id)).map((group) => ({ ...group, children: group.children.filter((id) => !removed.has(id)) })).filter((group) => group.children.length > 0);
  return parseDesign(doc);
}

export function duplicateDocumentLayers(input: DesignDocument, ids: readonly string[], makeId: () => string, frameFor: (placement: LayerPlacement) => PlacementFrame | undefined) {
  const doc = parseDesign(input), groups = doc.groups ?? [];
  if (!groups.length) {
    const result = duplicateLayers(doc.decorations, ids, makeId, (layer) => {
      const frame = frameFor(layer.placement);
      return frame ? moveGroup([{ id: layer.id, placement: layer.placement, frame }], { x: 16, y: 16 })[0]!.placement : { ...layer.placement };
    }); doc.decorations = result.layers; return { doc: parseDesign(doc), ids: result.ids };
  }
  const selected = normalizeSelection(ids, doc.decorations, groups), newIds: string[] = [];
  const roots = frontToBack(rootLayers(doc.decorations, groups)).reverse();
  for (const id of selected) {
    const group = groups.find((group) => group.id === id), image = doc.decorations.find((image) => image.id === id);
    if (group ? !groupMovable(group, doc.decorations) : !image || effectivelyLocked(image, groups)) continue;
    const sources = group ? childrenOf(group, doc.decorations) : [image!];
    if (doc.decorations.length + sources.length > IMAGE_LIMITS.count || group && (doc.groups?.length ?? 0) >= GROUP_LIMITS.count) throw new Error('レイヤーまたはグループの上限を超えます。');
    const samples = sources.flatMap((layer) => { const frame = frameFor(layer.placement); return frame ? [{ id: layer.id, placement: layer.placement, frame }] : []; });
    const placements = new Map(moveGroup(samples, { x: 16, y: 16 }).map((value) => [value.id, value.placement]));
    const copies = sources.map((layer) => ({ ...layer, id: makeId(), name: `${layer.name.slice(0, 116)} コピー`, placement: placements.get(layer.id) ?? { ...layer.placement } }));
    doc.decorations.push(...copies);
    if (group) {
      const copy = { ...group, id: makeId(), name: `${group.name.slice(0, 116)} コピー`, children: copies.map((layer) => layer.id) };
      doc.groups!.push(copy); roots.push(copy); newIds.push(copy.id);
    } else {
      const parent = parentGroup(groups, id);
      if (parent) { parent.children.push(copies[0]!.id); rank(doc, [...frontToBack(childrenOf(parent, doc.decorations)).reverse().filter((layer) => layer.id !== copies[0]!.id), copies[0]!]); }
      else roots.push(copies[0]!);
      newIds.push(copies[0]!.id);
    }
  }
  rank(doc, roots); return { doc: parseDesign(doc), ids: newIds };
}
