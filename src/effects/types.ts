/** Only registered sources, transforms and targets are accepted; no user code. */
export type MaskBinding =
  | { source: 'pointer.position'; transform: { kind: 'layer-local' }; target: 'mask.center' }
  | { source: 'video.playing'; transform: { kind: 'boolean-gate'; fadeMs: number }; target: 'mask.intensity' };

export interface CircleMask {
  kind: 'mask';
  shape: 'circle';
  enabled: boolean;
  /** Static fallback, relative to the unrotated layer. */
  center: { x: number; y: number };
  radiusPx: number;
  featherPx: number;
  intensity: number;
  bindings: MaskBinding[];
}

/** New media kinds use the same effects; new effects add their own renderer. */
export type LayerEffect = CircleMask;
export const EFFECT_LIMITS = Object.freeze({ count: 1, radius: 4096, feather: 4096, fadeMs: 5000 });

export function defaultCircleMask(): CircleMask {
  return { kind: 'mask', shape: 'circle', enabled: true, center: { x: .5, y: .5 },
    radiusPx: 160, featherPx: 40, intensity: 1,
    bindings: [{ source: 'pointer.position', transform: { kind: 'layer-local' }, target: 'mask.center' }] };
}
