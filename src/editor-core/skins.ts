import { editDesign } from '../design/immutable';
import {
  SKIN_LIMITS,
  type DesignDocument,
  type SkinFrame,
  type SkinState,
  type SurfaceSkin,
  type SurfaceStyleRule,
} from '../design/types';
import type { EditorAsset } from './types';

/** A drop target in the skin editor: one state's art, or the art used while the part is too small. */
export type SkinSlot = SkinState | 'compact';

// Native parts are often 32–40px tall; wider first guesses would only be scaled down by the browser.
const DEFAULT_SLICE_MAX = Math.min(SKIN_LIMITS.slice, 64);

/** A third of each side (at most 64px) is a usable first guess; authors then drag the guides. */
export function defaultSkinFrame(asset: Pick<EditorAsset, 'id' | 'width' | 'height'>): SkinFrame {
  const across = Math.min(DEFAULT_SLICE_MAX, Math.floor(asset.width / 3)),
    down = Math.min(DEFAULT_SLICE_MAX, Math.floor(asset.height / 3));
  return {
    assetId: asset.id,
    slices: { top: down, right: across, bottom: down, left: across },
    center: 'stretch',
    scalePct: 100,
  };
}

/** Static raster images only, small enough to paint on many parts at once. */
export function skinAssetProblem(asset: EditorAsset): string | undefined {
  if (asset.model || asset.animation) return '着せ替えにはPNG・WebPの静止画像を使ってください。';
  if (asset.width > SKIN_LIMITS.edge || asset.height > SKIN_LIMITS.edge)
    return `着せ替えの画像は${SKIN_LIMITS.edge}×${SKIN_LIMITS.edge}px以内にしてください。`;
}

export function withSkinFrame(skin: SurfaceSkin | undefined, slot: SkinSlot, frame: SkinFrame): SurfaceSkin {
  if (slot === 'compact') {
    if (!skin) throw new Error('先に通常状態の絵を入れてください。');
    return { ...skin, compact: { kind: 'frame', frame } };
  }
  if (!skin && slot !== 'normal') throw new Error('先に通常状態の絵を入れてください。');
  return { ...skin, states: { ...skin?.states, [slot]: frame } as SurfaceSkin['states'] };
}

/** Replaces only the skin of one rule; the colour/border style of the same part is kept. */
export function putSkin(draft: DesignDocument, target: string, skin: SurfaceSkin | null): DesignDocument {
  const next = editDesign(draft);
  const index = next.rules.findIndex((rule) => rule.target === target);
  const current = index < 0 ? undefined : next.rules[index]!;
  const { skin: _previous, ...rest } = current ?? { kind: 'surface-style' as const, target, style: {} };
  const rule: SurfaceStyleRule = skin ? { ...rest, skin } : rest;
  const empty = !rule.skin && Object.keys(rule.style).length === 0;
  if (index < 0) {
    if (!empty) next.rules.push(rule);
  } else if (empty) next.rules.splice(index, 1);
  else next.rules[index] = rule;
  return next;
}
