import type { PlacementFrame } from '../world/geometry';
import type { DesignTarget, LayerPlacement } from '../design/types';

export function placementFrame(doc: Document, anchors: readonly DesignTarget[], placement: LayerPlacement): PlacementFrame | undefined {
  if (placement.anchor.kind === 'viewport') return { left: 0, top: 0, width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight };
  const id = placement.anchor.target;
  const anchor = anchors.find((entry) => entry.id === id);
  const element = anchor && doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`);
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined;
}
