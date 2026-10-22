import type { GroupEvaluation, LayerEvaluation, WorldLayout } from './types';

const indices = new WeakMap<WorldLayout, ReadonlyMap<string, GroupEvaluation | LayerEvaluation>>();

/** Prepared layouts retain their entries; a new layout gets a separate index. */
export function layoutEntry(
  layout: WorldLayout,
  id: string | undefined,
): GroupEvaluation | LayerEvaluation | undefined {
  if (id === undefined) return undefined;
  let index = indices.get(layout);
  if (!index) {
    const next = new Map<string, GroupEvaluation | LayerEvaluation>();
    // Preserve the former groups-then-layers find() precedence, even for invalid duplicate IDs.
    for (const entry of layout.groups) if (!next.has(entry.layer.id)) next.set(entry.layer.id, entry);
    for (const entry of layout.layers) if (!next.has(entry.layer.id)) next.set(entry.layer.id, entry);
    indices.set(layout, next);
    index = next;
  }
  return index.get(id);
}
