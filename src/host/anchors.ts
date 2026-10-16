import type { PlacementFrame } from '../world/geometry';
import type { DesignTarget, LayerPlacement } from '../design/types';
import type { WorldGeometry } from '../world/types';

/** One plain numeric snapshot; page elements and selectors stay in the Host. */
export function captureGeometry(doc: Document, anchors: readonly DesignTarget[]): WorldGeometry {
  return { viewport: { width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight },
    anchors: Object.fromEntries(anchors.flatMap((anchor) => {
      const frame = placementFrame(doc, anchors, { anchor: { kind: 'surface', target: anchor.id }, x: 0, y: 0, widthPx: 1, heightPx: 1, rotationDeg: 0 });
      return frame ? [[anchor.id, frame]] : [];
    })) };
}

export function placementFrame(doc: Document, anchors: readonly DesignTarget[], placement: LayerPlacement): PlacementFrame | undefined {
  if (placement.anchor.kind === 'viewport') return { left: 0, top: 0, width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight };
  const id = placement.anchor.target;
  const anchor = anchors.find((entry) => entry.id === id);
  const element = anchor && doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`);
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined;
}
