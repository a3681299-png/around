import { createWorkQueue } from './work-queue';

/** Context-local immutable source cache. It never owns persistent leases. */
export function createSourceCache<T>(options: { load(id: string, signal: AbortSignal): Promise<T>; size(value: T): number; now(): number; maxBytes: number; idleMs: number; concurrency?: number }) {
  interface Entry { controller: AbortController; promise: Promise<T>; users: number; value?: T; bytes: number; used: number }
  const entries = new Map<string, Entry>(), queue = createWorkQueue(options.concurrency ?? 2, 32);
  let retained = 0;
  function remove(id: string, e: Entry) {
    if (entries.get(id) !== e) return;
    entries.delete(id); retained -= e.bytes; e.controller.abort(new DOMException('Source released', 'AbortError'));
  }
  function trim() {
    for (const [id, e] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (!e.users && e.value !== undefined && (options.now() - e.used >= options.idleMs || retained > options.maxBytes)) remove(id, e);
    }
  }
  return {
    get(id: string, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      trim(); let e = entries.get(id);
      if (!e) {
        const controller = new AbortController();
        e = { controller, users: 0, bytes: 0, used: options.now(), promise: Promise.resolve(undefined as T) };
        const entry = e; entries.set(id, entry);
        entry.promise = queue.run(() => options.load(id, controller.signal), controller.signal).then((value) => {
          if (controller.signal.aborted) throw controller.signal.reason;
          entry.value = value; entry.bytes = options.size(value); retained += entry.bytes; return value;
        }).catch((error: unknown) => { remove(id, entry); throw error; });
      }
      const entry = e; entry.users++; entry.used = options.now();
      return new Promise<T>((resolve, reject) => {
        let done = false;
        const finish = (error: unknown, value?: T) => {
          if (done) return; done = true; signal?.removeEventListener('abort', abort); entry.users--; entry.used = options.now();
          if (!entry.users && entry.value === undefined) remove(id, entry);
          trim(); if (error !== undefined) reject(error); else resolve(value as T);
        };
        const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true }); entry.promise.then((value) => finish(undefined, value), (error: unknown) => finish(error));
      });
    },
    clear() { for (const [id, e] of entries) remove(id, e); },
    delete(id: string) { const e = entries.get(id); if (e) remove(id, e); },
    stats: () => ({ entries: entries.size, retainedBytes: retained, ...queue.stats() }),
  };
}
