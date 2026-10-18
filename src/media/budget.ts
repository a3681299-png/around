export const MEDIA_BUDGET = Object.freeze({ encodedBytes: 96 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024,
  cacheBytes: 32 * 1024 * 1024, concurrentDecodes: 2, frameMs: 8 });
export type ResourceKind = 'encoded' | 'surface' | 'frame';
export interface MediaPolicy { priority: 'foreground' | 'background'; degradation: 'hold' | 'poster' }
interface Allocation { bytes: number; kind: ResourceKind; used: number; reclaim?: () => boolean }

/** Conservative application estimates; browser/GPU internal memory is not observable here. */
export function createMediaBudget(limits: { [K in keyof typeof MEDIA_BUDGET]: number } = MEDIA_BUDGET) {
  const allocations = new Map<string, Allocation>(), listeners = new Set<() => void>();
  let sequence = 0, notification = false, closed = false, inFlight = 0, peakDecodedBytes = 0;
  const waiters: Array<{ run(): void; reject(error: Error): void }> = [];
  const stats = () => {
    let encodedBytes = 0, decodedBytes = 0, cacheBytes = 0;
    for (const entry of allocations.values()) {
      if (entry.kind === 'encoded') encodedBytes += entry.bytes;
      else { decodedBytes += entry.bytes; if (entry.kind === 'frame') cacheBytes += entry.bytes; }
    }
    return { encodedBytes, decodedBytes, cacheBytes, allocations: allocations.size, inFlight, peakDecodedBytes };
  };
  const notify = () => {
    if (notification || closed) return; notification = true;
    queueMicrotask(() => { notification = false; if (!closed) listeners.forEach((listener) => listener()); });
  };
  const fits = (bytes: number, kind: ResourceKind) => {
    const value = stats();
    return kind === 'encoded' ? value.encodedBytes + bytes <= limits.encodedBytes
      : value.decodedBytes + bytes <= limits.decodedBytes && (kind !== 'frame' || value.cacheBytes + bytes <= limits.cacheBytes);
  };
  const release = (id: string) => { if (allocations.delete(id)) notify(); };
  return {
    stats,
    reserve(id: string, bytes: number, kind: ResourceKind, reclaim?: () => boolean): boolean {
      if (closed || !Number.isSafeInteger(bytes) || bytes < 0) return false;
      if (allocations.has(id)) { const entry = allocations.get(id)!; if (entry.bytes !== bytes || entry.kind !== kind) throw new Error('Allocation ID reused.'); entry.used = ++sequence; return true; }
      if (!fits(bytes, kind)) {
        const candidates = [...allocations.entries()].filter(([, entry]) => entry.reclaim && (kind === 'encoded' ? entry.kind === kind : entry.kind !== 'encoded')).sort((a, b) => a[1].used - b[1].used);
        for (const [, entry] of candidates) { entry.reclaim!(); if (fits(bytes, kind)) break; }
      }
      if (!fits(bytes, kind)) return false;
      allocations.set(id, { bytes, kind, used: ++sequence, ...(reclaim ? { reclaim } : {}) }); peakDecodedBytes = Math.max(peakDecodedBytes, stats().decodedBytes); return true;
    },
    touch(id: string) { const value = allocations.get(id); if (value) value.used = ++sequence; },
    release,
    decode<T>(action: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const run = () => {
          if (closed) { reject(new Error('Media budget is closed.')); return; }
          inFlight++;
          void Promise.resolve().then(action).then(resolve, reject).finally(() => { inFlight--; waiters.shift()?.run(); });
        };
        if (closed) reject(new Error('Media budget is closed.'));
        else if (inFlight >= limits.concurrentDecodes) waiters.push({ run, reject }); else run();
      });
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { closed = true; allocations.clear(); listeners.clear(); waiters.splice(0).forEach((job) => job.reject(new Error('Media budget is closed.'))); },
  };
}
export type MediaBudget = ReturnType<typeof createMediaBudget>;
