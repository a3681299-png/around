import type { AssetInfo } from './validation';

/** ImageDecoder is exposed to Window/DedicatedWorker, not MV3 ServiceWorker. */
export async function validateAnimatedFrames(bytes: Uint8Array, info: AssetInfo): Promise<void> {
  if (!info.animation || info.animation.format === 'lottie') return;
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(info.mime)) throw new Error('このChromeではアニメーション画像を読み込めません。');
  const decoder = new ImageDecoder({ data: new Uint8Array(bytes).buffer, type: info.mime, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    if (decoder.tracks.selectedTrack?.frameCount !== info.animation.frameCount) throw new Error('アニメーションのフレーム数が不正です。');
    for (let i = 0; i < info.animation.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try { if (image.displayWidth !== info.width || image.displayHeight !== info.height) throw new Error('アニメーションの寸法が不正です。'); }
      finally { image.close(); }
    }
  } finally { decoder.close(); }
}
