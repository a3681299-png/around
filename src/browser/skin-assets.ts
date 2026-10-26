import { loadAsset } from '../assets/client';
import { SKIN_LIMITS } from '../design/types';
import type { SkinAssetPort } from '../design/renderer';

/** Object URLs for UI skins. Only small static images become CSS images. */
export const skinAssetPort: SkinAssetPort = {
  async load(assetId) {
    const { metadata, blob } = await loadAsset(assetId);
    if (
      !blob ||
      metadata.model ||
      metadata.animation ||
      (metadata.mime !== 'image/png' && metadata.mime !== 'image/webp')
    )
      throw new Error('着せ替えにはPNG・WebPの静止画像を使ってください。');
    if (metadata.width > SKIN_LIMITS.edge || metadata.height > SKIN_LIMITS.edge)
      throw new Error(`着せ替えの画像は${SKIN_LIMITS.edge}×${SKIN_LIMITS.edge}px以内にしてください。`);
    return URL.createObjectURL(blob);
  },
  revoke: (url) => URL.revokeObjectURL(url),
};
