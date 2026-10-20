import type { Decoration } from '../design/types';
import type { AssetMetadata } from './validation';

/** Metadata is produced by the worker's bounded file inspector, never by JSON. */
export function validateDesignAssets(layers: readonly Decoration[], assets: ReadonlyMap<string, AssetMetadata>): void {
  for (const layer of layers) {
    const asset = assets.get(layer.assetId);
    if (!asset) throw new Error('保存する素材が見つかりません。');
    if (
      (layer.kind === 'model3d' && (!asset.model || JSON.stringify(asset.model) !== JSON.stringify(layer.source))) ||
      (layer.kind !== 'model3d' && asset.model) ||
      (layer.kind === 'image' && asset.animation) ||
      (layer.kind === 'animation' && asset.animation?.format !== layer.format)
    )
      throw new Error('レイヤーと素材の形式が一致しません。');
  }
}
