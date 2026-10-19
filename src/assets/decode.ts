import type { AssetInfo } from './validation';
import { inspectGlb } from './glb';

/** Validate embedded textures without a WebGL context; close every decoded bitmap. */
export async function validateModelTextures(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  const { json, bin } = inspectGlb(bytes);
  for (const image of json.images ?? []) {
    signal?.throwIfAborted(); const v = json.bufferViews[image.bufferView], start = v.byteOffset ?? 0;
    const bitmap = await cancellable(createImageBitmap(new Blob([bin.slice(start, start + v.byteLength).buffer], { type: image.mimeType })), signal, (b) => b.close());
    try { if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096) throw new Error('GLB内の画像寸法が不正です。'); }
    finally { bitmap.close(); }
  }
}

function cancellable<T>(task: Promise<T>, signal?: AbortSignal, releaseLate?: (value: T) => void): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(signal.reason); } };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    task.then((value) => { signal.removeEventListener('abort', abort); if (settled) releaseLate?.(value); else { settled = true; resolve(value); } },
      (error: unknown) => { signal.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error); } });
  });
}

/** Validate one frame only; later failures are bounded and handled by playback. */
export async function validateAnimatedFrames(bytes: Uint8Array, info: AssetInfo, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (info.model) { await validateModelTextures(bytes, signal); return; }
  if (!info.animation || info.animation.format === 'lottie') return;
  if (info.animation.format === 'webm') {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: info.mime })), video = document.createElement('video');
    video.muted = true; video.preload = 'auto';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await cancellable(new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('WebMの読み込みが時間内に完了しませんでした。')), 10_000);
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('WebMを再生できません。VP8／VP9で書き出してください。')); }; video.src = url;
      }), signal);
      if (video.videoWidth !== info.width || video.videoHeight !== info.height || !Number.isFinite(video.duration) || Math.abs(video.duration * 1000 - info.animation.durationMs) > 1000) throw new Error('WebMの寸法・再生時間が不正です。');
    } finally { clearTimeout(timeout); video.onloadeddata = video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
    return;
  }
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(info.mime)) {
    signal?.throwIfAborted(); const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: info.mime })), image = new Image();
    try { image.src = url; await cancellable(image.decode(), signal); if (image.naturalWidth !== info.width || image.naturalHeight !== info.height) throw new Error('素材の寸法が不正です。'); }
    finally { image.removeAttribute('src'); URL.revokeObjectURL(url); } return;
  }
  signal?.throwIfAborted();
  const decoder = new ImageDecoder({ data: new Uint8Array(bytes).buffer, type: info.mime, preferAnimation: true });
  let closed = false; const close = () => { if (!closed) { closed = true; decoder.close(); } }; signal?.addEventListener('abort', close, { once: true });
  try {
    await cancellable(decoder.tracks.ready, signal);
    {
      signal?.throwIfAborted(); const { image } = await cancellable(decoder.decode({ frameIndex: 0 }), signal, (result) => result.image.close());
      try { if (image.displayWidth !== info.width || image.displayHeight !== info.height) throw new Error('アニメーションの寸法が不正です。'); }
      finally { image.close(); }
    }
  } finally { signal?.removeEventListener('abort', close); close(); }
}
