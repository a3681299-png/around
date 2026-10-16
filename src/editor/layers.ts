import { IMAGE_LIMITS, type LayerState, type LayerAppearance } from '../design/types';
import { frontToBack } from '../design/hierarchy';
export { frontToBack } from '../design/hierarchy';

export function selectLayer(ids: readonly string[], id: string, additive: boolean, preserve = false): string[] {
  if (additive) return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  return preserve && ids.includes(id) ? [...ids] : [id];
}

export function deleteLayers<T extends LayerAppearance>(layers: readonly T[], ids: readonly string[]): T[] {
  return layers.filter((layer) => layer.locked || !ids.includes(layer.id));
}

/** Canonical, contiguous stacking values avoid running out of z-index after reorders. */
export function reorderLayers<T extends LayerAppearance>(layers: readonly T[], id: string, targetId: string, after: boolean): T[] {
  if (id === targetId || !layers.some((layer) => layer.id === id) || !layers.some((layer) => layer.id === targetId)) return [...layers];
  const order = frontToBack(layers), moved = order.find((layer) => layer.id === id)!;
  const rest = order.filter((layer) => layer.id !== id);
  rest.splice(rest.findIndex((layer) => layer.id === targetId) + Number(after), 0, moved);
  const ranks = new Map(rest.map((layer, index) => [layer.id, rest.length - index - 1]));
  return layers.map((layer) => ({ ...layer, zIndex: ranks.get(layer.id)! }));
}

export function duplicateLayers<T extends LayerState>(layers: readonly T[], ids: readonly string[], makeId: () => string, offset: (layer: T) => T['placement']): { layers: T[]; ids: string[] } {
  const sources = frontToBack(layers).reverse().filter((layer) => ids.includes(layer.id) && !layer.locked);
  if (layers.length + sources.length > IMAGE_LIMITS.count) throw new Error('レイヤーは32枚まで配置できます。');
  const copies = sources.map((layer) => ({ ...layer, id: makeId(), name: `${layer.name.slice(0, 116)} コピー`, placement: offset(layer) }));
  const order = frontToBack(layers).reverse();
  for (const copy of copies) order.push(copy);
  return { layers: order.map((layer, index) => ({ ...layer, zIndex: index })), ids: copies.map((layer) => layer.id) };
}
