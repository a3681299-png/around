import type { Decoration } from '../design/types';
import { ANIMATION_LIMITS } from './motion-types';
import type { AssetMetadata } from './validation';

/** Metadata is produced by the worker's bounded file inspector, never by JSON. */
export function validateDesignAssets(layers: readonly Decoration[], assets: ReadonlyMap<string, AssetMetadata>): void {
  let decodedPixels = 0;
  const checked = new Set<string>();
  for (const layer of layers) {
    const asset = assets.get(layer.assetId);
    if (!asset) throw new Error('保存する画像素材が見つかりません。');
    if ((layer.kind === 'image' && asset.animation) || (layer.kind === 'animation' && asset.animation?.format !== layer.format)) throw new Error('レイヤーと素材の形式が一致しません。');
    if (!checked.has(asset.id) && asset.animation && asset.animation.format !== 'lottie') decodedPixels += asset.width * asset.height * asset.animation.frameCount;
    checked.add(asset.id);
  }
  if (decodedPixels > ANIMATION_LIMITS.totalDecodedPixels) throw new Error('配置中のアニメーション画像は合計16M画素までです。');
}
