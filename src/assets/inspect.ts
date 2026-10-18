import { inspectAnimatedWebp, inspectGif } from './animated-raster';
import { inspectLottie } from './lottie';
import { inspectApng } from './apng';
import { inspectWebm } from './webm';
import { ASSET_LIMITS, inspectImage, type AssetInfo } from './validation';

export function inspectAsset(data: Uint8Array, mime = ''): AssetInfo {
  if (!data.length || data.length > ASSET_LIMITS.fileBytes) throw new Error('素材は1ファイル32MBまでです。');
  let info: AssetInfo;
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) info = inspectGif(data);
  else if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) info = inspectWebm(data);
  else if (mime === 'application/json' || mime === 'text/plain' || [0x7b, 0x20, 0x09, 0x0a, 0x0d, 0xef].includes(data[0]!)) info = inspectLottie(data).info;
  else info = inspectApng(data) ?? inspectAnimatedWebp(data) ?? inspectImage(data, mime);
  if (mime && mime !== info.mime && !(info.mime === 'application/json' && mime === 'text/plain') && !(info.animation?.format === 'apng' && mime === 'image/apng')) throw new Error('素材の形式とMIMEが一致しません。');
  return info;
}
