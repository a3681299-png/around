import type { AssetMetadata } from '../assets/validation';

/** One decoder and one cached frame per immutable asset, shared across its layers. */
export async function createRasterSource(blob: Blob, metadata: AssetMetadata) {
  if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(metadata.mime)) throw new Error('このChromeではアニメーション画像を再生できません。');
  const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: metadata.mime, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    if (decoder.tracks.selectedTrack?.frameCount !== metadata.animation?.frameCount) throw new Error('アニメーションのフレーム数が不正です。');
  } catch (error) { decoder.close(); throw error; }
  let cached: VideoFrame | undefined, cachedIndex = -1, closed = false;
  let queue: Promise<void> = Promise.resolve();
  return {
    paint(canvas: HTMLCanvasElement, index: number) {
      const result = queue.catch(() => undefined).then(async () => {
        if (closed) return;
        if (index !== cachedIndex) {
          const { image } = await decoder.decode({ frameIndex: index });
          if (closed) { image.close(); return; }
          cached?.close(); cached = image; cachedIndex = index;
        }
        const context = canvas.getContext('2d')!;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(cached!, 0, 0);
      });
      queue = result; return result;
    },
    destroy() { if (closed) return; closed = true; cached?.close(); cached = undefined; decoder.close(); },
  };
}
