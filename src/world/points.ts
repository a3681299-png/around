import type { PlacementAnchor } from '../design/types';
import type { SignalSnapshot } from '../signals/types';
import { centre, type Point } from './geometry';
import { frameFor, type WorldGeometry, type WorldLayout } from './types';
import { layoutEntry } from './layout-index';

export interface PointContext {
  geometry: WorldGeometry;
  signals: SignalSnapshot;
  layout?: WorldLayout;
}
type PointDefinitions = Readonly<
  Record<
    string,
    {
      resolve(reference: never, context: PointContext): Point | undefined;
    }
  >
>;
export type PointReference<D extends PointDefinitions> = { kind: keyof D & string } & {
  [K in keyof D & string]: { kind: K } & Parameters<D[K]['resolve']>[0];
}[keyof D & string];

/** Definitions are trusted code; references and resolved coordinates are data only. */
export function createPointRegistry<const D extends PointDefinitions>(definitions: D) {
  return Object.freeze({
    definitions: Object.freeze(definitions),
    resolve(reference: PointReference<D>, context: PointContext): Point | undefined {
      const kind = (reference as { kind: string }).kind;
      const value = Object.hasOwn(definitions, kind)
        ? definitions[kind]!.resolve(reference as never, context)
        : undefined;
      return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : undefined;
    },
  });
}

const layerEntry = (context: PointContext, layerId: string) => context.layout && layoutEntry(context.layout, layerId);
const usable = (frame: { width: number; height: number } | undefined) =>
  Boolean(frame && frame.width > 0 && frame.height > 0);
const currentLayerFrame = (context: PointContext, layerId: string) => {
  const entry = layerEntry(context, layerId);
  return entry && usable(frameFor(entry.layer.placement, context.geometry)) ? entry.frame : undefined;
};
type AnchorReference = { anchor: PlacementAnchor; layerId?: never } | { layerId: string; anchor?: never };

export const POINT_REGISTRY = createPointRegistry({
  pointer: {
    resolve: (_reference: Record<never, never>, context: PointContext) => context.signals.pointer,
  },
  anchor: {
    resolve(reference: AnchorReference, context: PointContext) {
      const frame =
        reference.layerId !== undefined
          ? currentLayerFrame(context, reference.layerId)
          : reference.anchor.kind === 'viewport'
            ? { left: 0, top: 0, ...context.geometry.viewport }
            : context.geometry.anchors[reference.anchor.target];
      return usable(frame) ? { x: frame!.left + frame!.width / 2, y: frame!.top + frame!.height / 2 } : undefined;
    },
  },
  layer: {
    resolve(reference: { layerId: string; basis?: 'placement' | 'evaluated' }, context: PointContext) {
      const entry = layerEntry(context, reference.layerId);
      if (!entry?.frame || !usable(currentLayerFrame(context, reference.layerId))) return undefined;
      // Legacy pointer rules use the authored placement before parent/motion composition.
      if (reference.basis !== 'placement' && 'position' in entry && entry.position) return entry.position;
      return centre(entry.layer.placement, entry.frame);
    },
  },
  fixed: {
    resolve: (reference: { position: Point }, _context: PointContext) => reference.position,
  },
});
export type SpatialPoint = PointReference<typeof POINT_REGISTRY.definitions>;
export const resolvePoint = POINT_REGISTRY.resolve;

/** Existing serialized space values keep their original meaning; no saved field is added. */
export function legacySignalOrigin(space: string, layerId: string): SpatialPoint | undefined {
  if (space === 'viewport') return { kind: 'anchor', anchor: { kind: 'viewport' } };
  if (space === 'anchor') return { kind: 'anchor', layerId };
  if (space === 'layer') return { kind: 'layer', layerId, basis: 'placement' };
  return undefined;
}
