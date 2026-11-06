import type { PlacementFrame } from '../world/geometry';
import type { DesignTarget, LayerPlacement } from '../design/types';
import type { WorldGeometry } from '../world/types';
import { REGULAR_PART_HEIGHT_PX } from '../world/layout';

/** Per document: each part's height the last time it was shown at least its regular size. */
const regularSeen = new WeakMap<Document, Map<string, number>>();

/** One plain numeric snapshot; page elements and selectors stay in the Host. */
export function captureGeometry(doc: Document, anchors: readonly DesignTarget[]): WorldGeometry {
  const frames: Record<string, PlacementFrame> = Object.fromEntries(
    anchors.flatMap((anchor) => {
      const frame = placementFrame(doc, anchors, {
        anchor: { kind: 'surface', target: anchor.id },
        x: 0,
        y: 0,
        widthPx: 1,
        heightPx: 1,
        rotationDeg: 0,
      });
      return frame ? [[anchor.id, frame]] : [];
    }),
  );
  // A part shown reduced (a miniplayer) draws its layers by the height it had just before, at its
  // regular size (world/layout.ts): remembered here, the only place that sees it over time.
  let seen = regularSeen.get(doc);
  for (const [id, frame] of Object.entries(frames)) {
    const regular = REGULAR_PART_HEIGHT_PX[id];
    if (regular && frame.height >= regular) {
      if (!seen) regularSeen.set(doc, (seen = new Map()));
      seen.set(id, frame.height);
    }
  }
  return {
    viewport: { width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight },
    anchors: frames,
    ...(seen?.size ? { regularHeights: Object.fromEntries(seen) } : {}),
  };
}

export function placementFrame(
  doc: Document,
  anchors: readonly DesignTarget[],
  placement: LayerPlacement,
): PlacementFrame | undefined {
  if (placement.anchor.kind === 'viewport')
    return { left: 0, top: 0, width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight };
  const id = placement.anchor.target;
  const anchor = anchors.find((entry) => entry.id === id);
  const element = anchor && doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`);
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : undefined;
}
