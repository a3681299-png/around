import type { AssetMetadata } from '../assets/validation';
import { NATIVE_IMAGE_CAPABILITIES, type AsyncSampler, type FrameSample } from './sampler';

/** img owns browser playback. Sampling explicitly returns the default-frame fallback. */
export function createNativeImage(doc: Document, url: string, metadata: AssetMetadata) {
  const element = doc.createElement('img'); element.alt = ''; element.draggable = false;
  let loaded = false, closed = false;
  element.src = url;
  const ready = element.decode().then(() => {
    if (closed) return;
    if (element.naturalWidth !== metadata.width || element.naturalHeight !== metadata.height) throw new Error('素材の寸法が不正です。'); loaded = true;
  });
  const sample = (): FrameSample => closed ? { status: 'pending', reason: 'closed' } : !loaded ? { status: 'pending', reason: 'decoding' }
    : { status: 'fallback', frame: { source: element, index: 0, timeMs: 0, close() {} } };
  const sampler: AsyncSampler = { capabilities: NATIVE_IMAGE_CAPABILITIES, peek: sample, async request() { try { await ready; return sample(); }
    catch (error) { return closed ? { status: 'pending', reason: 'closed' } : { status: 'error', message: String(error) }; } }, releaseConsumer() {},
    destroy() { closed = true; loaded = false; element.removeAttribute('src'); element.remove(); } };
  return { ...sampler, element, ready };
}
