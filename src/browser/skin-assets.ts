import { loadAsset } from '../assets/client';
import { SKIN_LIMITS } from '../design/types';
import type { SkinAssetPort } from '../design/renderer';
import type { ArtPixels } from '../design/contrast';

// Enough to tell light, dark and mixed centres apart; the original can be up to 1024px.
const SAMPLE_EDGE = 96;

async function staticImage(assetId: string) {
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
  return { blob, metadata };
}

/** Object URLs for UI skins. Only small static images become CSS images. */
export const skinAssetPort: SkinAssetPort = {
  async load(assetId) {
    return URL.createObjectURL((await staticImage(assetId)).blob);
  },
  revoke: (url) => URL.revokeObjectURL(url),
  /** A small copy of the image for the legibility check; decoded once per asset. */
  async pixels(assetId): Promise<ArtPixels> {
    const { blob, metadata } = await staticImage(assetId);
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(metadata.width, metadata.height));
    const sampleWidth = Math.max(1, Math.round(metadata.width * scale)),
      sampleHeight = Math.max(1, Math.round(metadata.height * scale));
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: sampleWidth,
      resizeHeight: sampleHeight,
      resizeQuality: 'medium',
    });
    try {
      const canvas = new OffscreenCanvas(sampleWidth, sampleHeight),
        context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
      return { width: metadata.width, height: metadata.height, sampleWidth, sampleHeight, data };
    } finally {
      bitmap.close();
    }
  },
};
