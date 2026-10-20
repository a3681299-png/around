import { test, expect } from '@playwright/test';
import { createWorkQueue } from '../src/assets/work-queue';
import { createSourceCache } from '../src/assets/source-cache';
import { rememberVerifiedSource, verifiedModelBytes } from '../src/assets/verified-source';
import { inspectAsset } from '../src/assets/inspect';
import { vrmFixture } from './helpers/vrm-fixture';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; };

test('read work continues while a mutation is blocked; failed work releases its slot', async () => {
  const writes = createWorkQueue(1), reads = createWorkQueue(2), gate = deferred<number>();
  const a = writes.run(() => gate.promise); let second = false;
  const b = writes.run(async () => { second = true; return 2; });
  expect(await reads.run(async () => 3)).toBe(3); expect(second).toBe(false);
  gate.resolve(1); expect(await a).toBe(1); expect(await b).toBe(2);
  await expect(reads.run(async () => { throw new Error('decode failed'); })).rejects.toThrow('decode failed');
  expect(await reads.run(async () => 4)).toBe(4);
});

test('bounded queue cancels pending requests without consuming an execution slot', async () => {
  const q = createWorkQueue(1, 1), gate = deferred<number>(), active = q.run(() => gate.promise), controller = new AbortController();
  const waiting = q.run(async () => 2, controller.signal); const rejection = expect(waiting).rejects.toThrow(); controller.abort(); await rejection;
  const next = q.run(async () => 3); await expect(q.run(async () => 4)).rejects.toThrow('要求が多すぎ');
  gate.resolve(1); await active; expect(await next).toBe(3);
});

test('concurrent consumers share one source; cancelling one does not cancel the others', async () => {
  let loads = 0, cancelled = false, time = 0; const gate = deferred<{ bytes: number }>();
  const cache = createSourceCache({ load: async (_id: string, signal) => { loads++; signal.addEventListener('abort', () => { cancelled = true; }); return gate.promise; }, size: (v) => v.bytes, now: () => time, maxBytes: 10, idleMs: 100 });
  const controller = new AbortController(), a = cache.get('same', controller.signal), b = cache.get('same');
  const rejection = expect(a).rejects.toThrow(); controller.abort(); await rejection;
  gate.resolve({ bytes: 5 }); expect((await b).bytes).toBe(5); expect(loads).toBe(1); expect(cancelled).toBe(false);
  expect(await cache.get('same')).toEqual({ bytes: 5 }); expect(loads).toBe(1);
  time = 101; await cache.get('same'); expect(loads).toBe(2); cache.clear(); expect(cache.stats().retainedBytes).toBe(0);
});

test('last consumer cancellation stops shared work and errors can be retried', async () => {
  let aborted = false, loads = 0;
  const cache = createSourceCache({ load: async (_id: string, signal) => { loads++; return new Promise<number>((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); })); }, size: () => 1, now: () => 0, maxBytes: 10, idleMs: 100 });
  const controller = new AbortController(), value = cache.get('cancel', controller.signal); await Promise.resolve(); await Promise.resolve();
  const rejection = expect(value).rejects.toThrow(); controller.abort(); await rejection;
  expect(aborted).toBe(true); expect(cache.stats().entries).toBe(0); expect(loads).toBe(1);
  cache.clear();
});

test('unused LRU sources are evicted under the byte budget; active sources survive', async () => {
  let time = 0; const cache = createSourceCache({ load: async (id: string) => id, size: () => 6, now: () => ++time, maxBytes: 10, idleMs: 100 });
  await cache.get('a'); await cache.get('b'); expect(cache.stats().retainedBytes).toBe(6); expect(cache.stats().entries).toBe(1);
  cache.clear(); expect(cache.stats().entries).toBe(0);
});

test('failed source preparation is not cached and the next request retries', async () => {
  let attempt = 0;
  const cache = createSourceCache({ load: async (_id: string) => { if (++attempt === 1) throw new Error('temporary failure'); return 5; }, size: () => 1, now: () => 0, maxBytes: 10, idleMs: 100 });
  await expect(cache.get('retry')).rejects.toThrow('temporary failure'); expect(await cache.get('retry')).toBe(5); expect(attempt).toBe(2);
});

test('only an inspected immutable Blob carries a reusable model receipt', () => {
  const bytes = vrmFixture(), info = inspectAsset(bytes), original = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  const forged = new Blob([bytes as Uint8Array<ArrayBuffer>]); expect(verifiedModelBytes(original)).toBeUndefined();
  rememberVerifiedSource(original, info); expect(verifiedModelBytes(original)).toBeGreaterThan(0); expect(verifiedModelBytes(forged)).toBeUndefined();
  rememberVerifiedSource(forged, { ...info }); expect(verifiedModelBytes(forged)).toBeUndefined();
});
