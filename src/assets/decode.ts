import type { AssetInfo } from './validation';

/** Validate one frame only; later failures are bounded and handled by playback. */
export async function validateAnimatedFrames(bytes: Uint8Array, info: AssetInfo): Promise<void> {
  if (!info.animation || info.animation.format === 'lottie' || info.animation.format === 'webm') return;
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(info.mime)) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: info.mime }));
    try { const image = new Image(); image.src = url; await image.decode(); if (image.naturalWidth !== info.width || image.naturalHeight !== info.height) throw new Error('素材の寸法が不正です。'); image.removeAttribute('src'); }
    finally { URL.revokeObjectURL(url); } return;
  }
  const decoder = new ImageDecoder({ data: new Uint8Array(bytes).buffer, type: info.mime, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    {
      const { image } = await decoder.decode({ frameIndex: 0 });
      try { if (image.displayWidth !== info.width || image.displayHeight !== info.height) throw new Error('アニメーションの寸法が不正です。'); }
      finally { image.close(); }
    }
  } finally { decoder.close(); }
}
