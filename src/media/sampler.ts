import { MediaBudgetUnavailable, type MediaBudget } from './budget';

export interface MediaCapabilities { seek: 'frame' | 'approximate' | 'none'; reverse: boolean; speed: boolean; pause: boolean; loop: boolean }
export const NATIVE_IMAGE_CAPABILITIES: MediaCapabilities = { seek: 'none', reverse: false, speed: false, pause: false, loop: false };
export const CONTROLLED_CAPABILITIES: MediaCapabilities = { seek: 'frame', reverse: true, speed: true, pause: true, loop: true };
export const VIDEO_CAPABILITIES: MediaCapabilities = { seek: 'approximate', reverse: false, speed: true, pause: true, loop: true };
export interface FrameLease { source: CanvasImageSource; index: number | null; timeMs: number; close(): void }
export type FrameSample = { status: 'exact' | 'fallback'; frame: FrameLease }
  | { status: 'pending'; reason: 'superseded' | 'budget' | 'decoding' | 'closed' }
  | { status: 'error'; message: string };
export interface SampleRequest { consumer: string; timeMs: number; velocity: number }
export interface DecodedFrame { source: CanvasImageSource; bytes: number; close(): void }
export interface FrameBackend { decode(index: number): Promise<DecodedFrame>; close(): void }
export interface FrameTimeline { count: number; frameAt(timeMs: number): number; timeAt(index: number): number }
export interface AsyncSampler {
  readonly capabilities: MediaCapabilities;
  peek(request: SampleRequest): FrameSample;
  request(request: SampleRequest): Promise<FrameSample>;
  releaseConsumer(id: string): void;
  destroy(): void;
}
interface Cached { value: DecodedFrame; id: string; leases: number; disposed: boolean }
interface Job { request: SampleRequest; index: number; generation: number; resolve(value: FrameSample): void }

/** Latest-only per consumer, one active job per decoder, globally bounded work/cache. */
export function createFrameSampler(id: string, backend: FrameBackend, timeline: FrameTimeline, budget: MediaBudget): AsyncSampler {
  const cache = new Map<number, Cached>(), generations = new Map<string, number>(), pending = new Map<string, Job>();
  let active = false, closed = false, nextSerial = 0;
  const dispose = (index: number, force = false) => {
    const entry = cache.get(index); if (!entry || entry.disposed || entry.leases && !force) return false;
    entry.disposed = true; cache.delete(index); entry.value.close(); budget.release(entry.id); return true;
  };
  const lease = (index: number, status: 'exact' | 'fallback'): FrameSample => {
    const entry = cache.get(index); if (!entry || entry.disposed) return { status: 'pending', reason: 'decoding' };
    entry.leases++; budget.touch(entry.id); cache.delete(index); cache.set(index, entry); let released = false;
    return { status, frame: { source: entry.value.source, index, timeMs: timeline.timeAt(index), close() {
      if (released) return; released = true; entry.leases--; if (closed && !entry.disposed) dispose(index, true);
    } } };
  };
  const indexFor = (request: SampleRequest) => {
    if (!Number.isFinite(request.timeMs) || !Number.isFinite(request.velocity)) throw new Error('Invalid sample time.');
    return timeline.frameAt(request.timeMs);
  };
  const decode = async (index: number) => {
    if (cache.has(index)) return true;
    const value = await budget.decode(() => backend.decode(index));
    if (closed) { value.close(); return false; }
    const key = `${id}-frame-${++nextSerial}`;
    const entry: Cached = { value, id: key, leases: 0, disposed: false };
    if (!budget.reserve(key, value.bytes, 'frame', () => dispose(index))) { value.close(); return false; }
    cache.set(index, entry);
    for (const candidate of [...cache.keys()]) { if (cache.size <= 4) break; dispose(candidate); }
    return cache.has(index);
  };
  async function pump() {
    if (active || closed) return; active = true;
    try {
      while (pending.size && !closed) {
        const [consumer, job] = pending.entries().next().value!; pending.delete(consumer);
        try {
          const available = await decode(job.index);
          if (closed || generations.get(consumer) !== job.generation) job.resolve({ status: 'pending', reason: closed ? 'closed' : 'superseded' });
          else if (!available) job.resolve({ status: 'pending', reason: 'budget' });
          else job.resolve(lease(job.index, 'exact'));
          // Prefetch only when foreground requests are quiet; direction/rate decide distance.
          if (available && !pending.size && !closed && generations.get(consumer) === job.generation) {
            const direction = Math.sign(job.request.velocity), distance = Math.min(2, Math.ceil(Math.abs(job.request.velocity)));
            for (let step = 1; direction && step <= distance && !pending.size && !closed; step++) {
              const index = (job.index + direction * step + timeline.count) % timeline.count;
              if (!await decode(index)) break;
            }
          }
        } catch (error) { job.resolve(closed || generations.get(consumer) !== job.generation ? { status: 'pending', reason: closed ? 'closed' : 'superseded' } : error instanceof MediaBudgetUnavailable ? { status: 'pending', reason: 'budget' }
          : { status: 'error', message: error instanceof Error ? error.message : 'Frame decode failed.' }); }
      }
    } finally { active = false; }
  }
  return {
    capabilities: CONTROLLED_CAPABILITIES,
    peek(request) {
      if (closed) return { status: 'pending', reason: 'closed' };
      const index = indexFor(request); if (cache.has(index)) return lease(index, 'exact');
      const nearest = [...cache.keys()].sort((a, b) => Math.abs(a - index) - Math.abs(b - index))[0];
      return nearest === undefined ? { status: 'pending', reason: 'decoding' } : lease(nearest, 'fallback');
    },
    request(request) {
      if (closed) return Promise.resolve({ status: 'pending', reason: 'closed' });
      const index = indexFor(request), generation = (generations.get(request.consumer) ?? 0) + 1; generations.set(request.consumer, generation);
      pending.get(request.consumer)?.resolve({ status: 'pending', reason: 'superseded' }); pending.delete(request.consumer);
      if (cache.has(index)) return Promise.resolve(lease(index, 'exact'));
      return new Promise<FrameSample>((resolve) => { pending.set(request.consumer, { request, index, generation, resolve }); void pump(); });
    },
    releaseConsumer(consumer) { generations.set(consumer, (generations.get(consumer) ?? 0) + 1); pending.get(consumer)?.resolve({ status: 'pending', reason: 'superseded' }); pending.delete(consumer); },
    destroy() { if (closed) return; closed = true; pending.forEach((job) => job.resolve({ status: 'pending', reason: 'closed' })); pending.clear(); backend.close(); [...cache.keys()].forEach((index) => dispose(index, true)); generations.clear(); },
  };
}
