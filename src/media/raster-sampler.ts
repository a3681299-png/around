import type { AssetMetadata } from '../assets/validation';
import { RASTER_LIMITS } from '../assets/motion-types';
import { frameAtTimeline, prepareMediaTimeline } from '../world/media-time';
import { MediaBudgetUnavailable, type MediaBudget } from './budget';
import { createFrameSampler } from './sampler';

export function rasterSize(metadata: AssetMetadata) {
  const scale = Math.min(1, RASTER_LIMITS.decodeEdge / Math.max(metadata.width, metadata.height));
  return { width: Math.max(1, Math.round(metadata.width * scale)), height: Math.max(1, Math.round(metadata.height * scale)) };
}
export function createRasterSampler(blob: Blob, metadata: AssetMetadata, budget: MediaBudget) {
  const timeline = prepareMediaTimeline(metadata.animation!), size = rasterSize(metadata);
  let decoder: ImageDecoder | undefined, opening: Promise<ImageDecoder> | undefined, closed = false;
  const memory = `${metadata.id}-decoder`, encoded = `${metadata.id}-decoder-input`;
  const open = async () => {
    if (closed) throw new Error('Decoder is closed.');
    if (decoder) return decoder; if (opening) return opening;
    if (!budget.reserve(memory, size.width * size.height * 8, 'surface')) throw new MediaBudgetUnavailable();
    if (!budget.reserve(encoded, blob.size, 'encoded')) { budget.release(memory); throw new MediaBudgetUnavailable(); }
    opening = (async () => {
      let next: ImageDecoder | undefined;
      try {
        if (typeof ImageDecoder === 'undefined' || !await ImageDecoder.isTypeSupported(metadata.mime)) throw new Error('このChromeでは時刻制御で再生できません。軽量再生を選択してください。');
        next = new ImageDecoder({ data: await blob.arrayBuffer(), type: metadata.mime, preferAnimation: true, desiredWidth: size.width, desiredHeight: size.height });
        await next.tracks.ready;
        if (closed || next.tracks.selectedTrack?.frameCount !== metadata.animation!.frameCount) throw new Error('アニメーションのフレームを取得できません。');
        decoder = next; return next;
      } catch (error) { next?.close(); budget.release(memory); budget.release(encoded); throw error; }
      finally { opening = undefined; }
    })(); return opening;
  };
  return createFrameSampler(metadata.id, {
    async decode(index) { const source = await open(); const { image } = await source.decode({ frameIndex: index, completeFramesOnly: true });
      return { source: image, bytes: image.displayWidth * image.displayHeight * 4, close: () => image.close() }; },
    close() { if (closed) return; closed = true; decoder?.close(); decoder = undefined; budget.release(memory); budget.release(encoded); },
  }, { count: timeline.count, frameAt: (time) => frameAtTimeline(timeline, time), timeAt: (index) => index ? timeline.endsMs[index - 1]! : 0 }, budget);
}
