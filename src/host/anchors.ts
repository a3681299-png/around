import type { PlacementFrame } from '../world/geometry';
import type { DesignTarget, LayerPlacement } from '../design/types';
import type { WorldGeometry } from '../world/types';

/**
 * Set by a site adapter (src/sites/) on a marked part while the site shows it in its reduced form
 * (YouTube's miniplayer). Read here from the part; the world draws the part's layers reduced with
 * it (world/layout.ts) and never decides the form from a size. Adapters without a reduced form
 * never set it.
 */
export const PART_REDUCED_ATTRIBUTE = 'data-ww-reduced';

/** Per document: each part's height the last time it was shown not reduced. */
const regularSeen = new WeakMap<Document, Map<string, number>>();

const partElement = (doc: Document, anchor: DesignTarget | undefined) =>
  anchor && doc.querySelector(`[data-ww-surface~="${anchor.surface}"]`);
const frameOf = (element: Element | null | undefined): PlacementFrame | undefined => {
  const rect = element?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : undefined;
};

/** One plain numeric snapshot; page elements and selectors stay in the Host. */
export function captureGeometry(doc: Document, anchors: readonly DesignTarget[]): WorldGeometry {
  const frames: Record<string, PlacementFrame> = {},
    reduced: Record<string, number> = {};
  let seen = regularSeen.get(doc);
  for (const anchor of anchors) {
    const element = partElement(doc, anchor),
      frame = frameOf(element);
    if (!frame) continue;
    frames[anchor.id] = frame;
    // The adapter reports a part's reduced form (a miniplayer) on the part itself; the world gets
    // the form and the base it is drawn against: the part's last height when not reduced,
    // remembered here, the only place that sees the part over time. A part never seen regular has
    // no base and is drawn as authored. A regular part is never reduced, however small.
    if (element!.hasAttribute(PART_REDUCED_ATTRIBUTE)) {
      const base = seen?.get(anchor.id);
      if (base !== undefined) reduced[anchor.id] = base;
    } else {
      if (!seen) regularSeen.set(doc, (seen = new Map()));
      seen.set(anchor.id, frame.height);
    }
  }
  return {
    viewport: { width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight },
    anchors: frames,
    ...(Object.keys(reduced).length ? { reducedParts: reduced } : {}),
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
  return frameOf(
    partElement(
      doc,
      anchors.find((entry) => entry.id === id),
    ),
  );
}
