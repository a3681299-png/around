import type { AssetMetadata } from '../assets/validation';
import { RASTER_LIMITS } from '../assets/motion-types';
import { frameAtTimeline, prepareMediaTimeline } from '../world/media-time';
import { MediaBudgetUnavailable, type MediaBudget } from './budget';
import { createFrameSampler } from './sampler';
let samplerSerial = 0;

export function rasterSize(metadata: AssetMetadata) {
  const scale = Math.min(1, RASTER_LIMITS.decodeEdge / Math.max(metadata.width, metadata.height));
  return { width: Math.max(1, Math.round(metadata.width * scale)), height: Math.max(1, Math.round(metadata.height * scale)) };
}
export function createRasterSampler(blob: Blob, metadata: AssetMetadata, budget: MediaBudget) {
  const timeline = prepareMediaTimeline(metadata.animation!), size = rasterSize(metadata);
  let decoder: ImageDecoder | undefined, opening: Promise<ImageDecoder> | undefined, closed = false;
  const id = `${metadata.id}-sampler-${++samplerSerial}`, memory = `${id}-decoder`, encoded = `${id}-decoder-input`;
  const open = async () => {
    if (closed) throw new Error('Decoder is closed.');
    if (opening) return opening; if (decoder) return decoder;
    // Some Chrome codecs ignore desiredWidth/Height. Budget one original frame
    // plus the resize destination, and explicitly downsample before caching.
    if (!budget.reserve(memory, metadata.width * metadata.height * 4 + size.width * size.height * 4, 'surface')) throw new MediaBudgetUnavailable();
    if (!budget.reserve(encoded, blob.size, 'encoded')) { budget.release(memory); throw new MediaBudgetUnavailable(); }
    opening = (async () => {
      let next: ImageDecoder | undefined;
      try {
        if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(metadata.mime)) throw new Error('このChromeでは時刻制御で再生できません。軽量再生を選択してください。');
        const data = await blob.arrayBuffer(); if (closed) throw new Error('Decoder is closed.');
        next = new ImageDecoder({ data, type: metadata.mime, preferAnimation: true, desiredWidth: size.width, desiredHeight: size.height }); decoder = next;
        await next.tracks.ready;
        if (closed || next.tracks.selectedTrack?.frameCount !== metadata.animation!.frameCount) throw new Error('アニメーションのフレームを取得できません。');
        decoder = next; return next;
      } catch (error) { if (decoder === next) { next?.close(); decoder = undefined; } budget.release(memory); budget.release(encoded); throw error; }
      finally { opening = undefined; }
    })(); return opening;
  };
  return createFrameSampler(id, {
    async decode(index) { const source = await open(); const { image } = await source.decode({ frameIndex: index, completeFramesOnly: true });
      if (closed) { image.close(); throw new Error('Decoder is closed.'); }
      try { const bitmap = await createImageBitmap(image, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
        if (closed) { bitmap.close(); throw new Error('Decoder is closed.'); }
        return { source: bitmap, bytes: bitmap.width * bitmap.height * 4, close: () => bitmap.close() };
      } finally { image.close(); } },
    close() { if (closed) return; closed = true; decoder?.close(); decoder = undefined; budget.release(memory); budget.release(encoded); },
  }, { count: timeline.count, frameAt: (time) => frameAtTimeline(timeline, time), timeAt: (index) => index ? timeline.endsMs[index - 1]! : 0 }, budget);
}
