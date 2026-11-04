import { SKIN_LIMITS, type Decoration, type DesignDocument, type SkinFrame } from '../design/types';
import type { AssetMetadata } from './validation';
import { sameModelInfo } from '../models/types';

/** Metadata is produced by the worker's bounded file inspector, never by JSON. */
export function validateDesignAssets(layers: readonly Decoration[], assets: ReadonlyMap<string, AssetMetadata>): void {
  for (const layer of layers) {
    const asset = assets.get(layer.assetId);
    if (!asset) throw new Error('保存する素材が見つかりません。');
    if (
      (layer.kind === 'model3d' && !sameModelInfo(layer.source, asset.model)) ||
      (layer.kind !== 'model3d' && asset.model) ||
      asset.vrmAnimation ||
      (layer.kind === 'image' && asset.animation) ||
      (layer.kind === 'animation' && asset.animation?.format !== layer.format)
    )
      throw new Error('レイヤーと素材の形式が一致しません。');
    // A character's motions must be the very .vrma facts the worker measured at import.
    if (layer.kind === 'model3d')
      for (const motion of layer.character?.motions ?? []) {
        const stored = assets.get(motion.assetId);
        if (!stored?.vrmAnimation || JSON.stringify(stored.vrmAnimation) !== JSON.stringify(motion.source))
          throw new Error('キャラの動作と素材が一致しません。');
      }
  }
}

/** Every reference a saved document makes: layers and UI skins. */
export function validateDocumentAssets(
  design: Pick<DesignDocument, 'decorations' | 'rules'>,
  assets: ReadonlyMap<string, AssetMetadata>,
): void {
  validateDesignAssets(design.decorations, assets);
  for (const rule of design.rules) {
    if (!rule.skin) continue;
    const frames: SkinFrame[] = Object.values(rule.skin.states);
    if (rule.skin.compact?.kind === 'frame') frames.push(rule.skin.compact.frame);
    for (const frame of frames) validateSkinAsset(frame, assets.get(frame.assetId));
  }
}

/** UI skins paint on many native elements, so only small static images are accepted. */
export function validateSkinAsset(frame: SkinFrame, asset: AssetMetadata | undefined): void {
  if (!asset) throw new Error('保存する着せ替えの素材が見つかりません。');
  if (asset.model || asset.animation || (asset.mime !== 'image/png' && asset.mime !== 'image/webp'))
    throw new Error('着せ替えにはPNG・WebPの静止画像を使ってください。');
  if (asset.width > SKIN_LIMITS.edge || asset.height > SKIN_LIMITS.edge)
    throw new Error(`着せ替えの画像は${SKIN_LIMITS.edge}×${SKIN_LIMITS.edge}px以内にしてください。`);
  const { top, right, bottom, left } = frame.slices;
  if (left + right > asset.width || top + bottom > asset.height)
    throw new Error('着せ替えの切り位置が画像の大きさを超えています。');
}
