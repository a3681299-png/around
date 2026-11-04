import { inspectAsset } from './inspect';
import { validateModelTextures } from './decode';
import { profileAsync, profileSync } from '../diagnostics/asset-profile';
import type { AssetInfo } from './validation';

/** Shared boundary for original imports and backups. Never trust archive metadata. */
export async function validateAssetBytes(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  trace?: string,
): Promise<{ info: AssetInfo; blob: Blob }> {
  const info = profileSync(trace, 'store.inspect', () => inspectAsset(bytes, mime));
  if (info.model)
    await profileAsync(trace, 'store.validate-textures', () => validateModelTextures(bytes, undefined, trace));
  const blob = profileSync(trace, 'store.clone-blob', () => new Blob([bytes], { type: info.mime }), {
    bytes: bytes.length,
  });
  // Service workers validate raster frame 0; container validation precedes decoding.
  // Video playback probing remains at the existing content importer boundary.
  if (!info.model && !info.vrmAnimation && info.animation?.format !== 'lottie' && info.animation?.format !== 'webm') {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width !== info.width || bitmap.height !== info.height)
        throw new Error('画像を正しく読み込めませんでした。');
    } finally {
      bitmap.close();
    }
  }
  return { info, blob };
}
