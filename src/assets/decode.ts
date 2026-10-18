import type { AssetInfo } from './validation';

/** Validate one frame only; later failures are bounded and handled by playback. */
export async function validateAnimatedFrames(bytes: Uint8Array, info: AssetInfo): Promise<void> {
  if (!info.animation || info.animation.format === 'lottie') return;
  if (info.animation.format === 'webm') {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: info.mime })), video = document.createElement('video');
    video.muted = true; video.preload = 'auto';
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebMの読み込みが時間内に完了しませんでした。')), 10_000);
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('WebMを再生できません。VP8／VP9で書き出してください。')); }; video.src = url;
      });
      if (video.videoWidth !== info.width || video.videoHeight !== info.height || !Number.isFinite(video.duration) || Math.abs(video.duration * 1000 - info.animation.durationMs) > 1000) throw new Error('WebMの寸法・再生時間が不正です。');
    } finally { video.onloadeddata = video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    return;
  }
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
