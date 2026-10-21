import { test, expect } from '@playwright/test';
import { createWorkQueue } from '../src/assets/work-queue';
import { createSourceCache } from '../src/assets/source-cache';
import {
  prepareVerifiedSource,
  parseVerifiedModelSource,
  verifiedModelBytes,
  type VerifiedModelSource,
} from '../src/assets/verified-source';
import { assetSourceBytes, type LoadedAsset } from '../src/assets/client';
import { inspectAsset } from '../src/assets/inspect';
import { vrmFixture } from './helpers/vrm-fixture';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};

test('read work continues while a mutation is blocked; failed work releases its slot', async () => {
  const writes = createWorkQueue(1),
    reads = createWorkQueue(2),
    gate = deferred<number>();
  const a = writes.run(() => gate.promise);
  let second = false;
  const b = writes.run(async () => {
    second = true;
    return 2;
  });
  expect(await reads.run(async () => 3)).toBe(3);
  expect(second).toBe(false);
  gate.resolve(1);
  expect(await a).toBe(1);
  expect(await b).toBe(2);
  await expect(
    reads.run(async () => {
      throw new Error('decode failed');
    }),
  ).rejects.toThrow('decode failed');
  expect(await reads.run(async () => 4)).toBe(4);
});

test('bounded queue cancels pending requests without consuming an execution slot', async () => {
  const q = createWorkQueue(1, 1),
    gate = deferred<number>(),
    active = q.run(() => gate.promise),
    controller = new AbortController();
  const waiting = q.run(async () => 2, controller.signal);
  const rejection = expect(waiting).rejects.toThrow();
  controller.abort();
  await rejection;
  const next = q.run(async () => 3);
  await expect(q.run(async () => 4)).rejects.toThrow('要求が多すぎ');
  gate.resolve(1);
  await active;
  expect(await next).toBe(3);
});

test('serial mutation work accepts bursts beyond 64 pending requests in order', async () => {
  const queue = createWorkQueue(1, Infinity),
    gate = deferred<number>(),
    order: number[] = [];
  const first = queue.run(() => gate.promise);
  const pending = Array.from({ length: 130 }, (_, i) =>
    queue.run(async () => {
      order.push(i);
      return i;
    }),
  );
  const result = Promise.all(pending);
  try {
    expect(queue.stats()).toEqual({ active: 1, pending: 130 });
  } finally {
    gate.resolve(-1);
  }
  expect(await first).toBe(-1);
  expect(await result).toEqual(Array.from({ length: 130 }, (_, i) => i));
  expect(order).toEqual(await result);
});

test('concurrent consumers share one source; cancelling one does not cancel the others', async () => {
  let loads = 0,
    cancelled = false,
    time = 0;
  const gate = deferred<{ bytes: number }>();
  const cache = createSourceCache({
    load: async (_id: string, signal) => {
      loads++;
      signal.addEventListener('abort', () => {
        cancelled = true;
      });
      return gate.promise;
    },
    size: (v) => v.bytes,
    now: () => time,
    maxBytes: 10,
    idleMs: 100,
  });
  const controller = new AbortController(),
    a = cache.get('same', controller.signal),
    b = cache.get('same');
  const rejection = expect(a).rejects.toThrow();
  controller.abort();
  await rejection;
  gate.resolve({ bytes: 5 });
  expect((await b).bytes).toBe(5);
  expect(loads).toBe(1);
  expect(cancelled).toBe(false);
  expect(await cache.get('same')).toEqual({ bytes: 5 });
  expect(loads).toBe(1);
  time = 101;
  await cache.get('same');
  expect(loads).toBe(2);
  cache.clear();
  expect(cache.stats().retainedBytes).toBe(0);
});

test('last consumer cancellation stops shared work and errors can be retried', async () => {
  let aborted = false,
    loads = 0;
  const cache = createSourceCache({
    load: async (_id: string, signal) => {
      loads++;
      return new Promise<number>((_resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        }),
      );
    },
    size: () => 1,
    now: () => 0,
    maxBytes: 10,
    idleMs: 100,
  });
  const controller = new AbortController(),
    value = cache.get('cancel', controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  const rejection = expect(value).rejects.toThrow();
  controller.abort();
  await rejection;
  expect(aborted).toBe(true);
  expect(cache.stats().entries).toBe(0);
  expect(loads).toBe(1);
  cache.clear();
});

test('unused LRU sources are evicted under the byte budget; active sources survive', async () => {
  let time = 0,
    activeLoads = 0,
    aborted = false;
  const gate = deferred<string>();
  const cache = createSourceCache({
    load: async (id: string, signal) => {
      if (id !== 'active') return id;
      activeLoads++;
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return gate.promise;
    },
    size: () => 6,
    now: () => ++time,
    maxBytes: 10,
    idleMs: 100,
  });
  const active = cache.get('active');
  try {
    await cache.get('a');
    await cache.get('b');
    expect(cache.stats().retainedBytes).toBe(6);
    expect(cache.stats().entries).toBe(2);
    const same = cache.get('active');
    expect(activeLoads).toBe(1);
    expect(aborted).toBe(false);
    gate.resolve('active');
    expect(await active).toBe('active');
    expect(await same).toBe('active');
    expect(await cache.get('active')).toBe('active');
    expect(activeLoads).toBe(1);
    expect(aborted).toBe(false);
    // Hold a read of an already prepared value across the next expiry trim.
    const held = cache.get('active');
    time += 101;
    const next = cache.get('c');
    expect(cache.stats().entries).toBe(2);
    expect(cache.stats().retainedBytes).toBe(6);
    expect(aborted).toBe(false);
    expect(await held).toBe('active');
    await next;
  } finally {
    gate.resolve('active');
    cache.clear();
  }
  expect(cache.stats().entries).toBe(0);
});

test('idle sources expire without another get while an active request survives the timer', async () => {
  const gate = deferred<string>();
  let loads = 0,
    aborted = false;
  const cache = createSourceCache({
    load: async (id: string, signal) => {
      if (id !== 'active') return id;
      loads++;
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return gate.promise;
    },
    size: () => 1,
    now: () => performance.now(),
    maxBytes: 10,
    idleMs: 20,
  });
  const active = cache.get('active');
  try {
    await cache.get('idle');
    await expect.poll(() => cache.stats().entries, { intervals: [5, 10] }).toBe(1);
    expect(cache.stats().retainedBytes).toBe(0);
    expect(aborted).toBe(false);
    const same = cache.get('active');
    gate.resolve('ready');
    expect(await active).toBe('ready');
    expect(await same).toBe('ready');
    expect(loads).toBe(1);
    await expect.poll(() => cache.stats().entries, { intervals: [5, 10] }).toBe(0);
  } finally {
    gate.resolve('ready');
    cache.clear();
  }
});

test('failed source preparation is not cached and the next request retries', async () => {
  let attempt = 0;
  const cache = createSourceCache({
    load: async (_id: string) => {
      if (++attempt === 1) throw new Error('temporary failure');
      return 5;
    },
    size: () => 1,
    now: () => 0,
    maxBytes: 10,
    idleMs: 100,
  });
  await expect(cache.get('retry')).rejects.toThrow('temporary failure');
  expect(await cache.get('retry')).toBe(5);
  expect(attempt).toBe(2);
  cache.clear();
});

test('verified model references own inspected buffers and cannot mark caller-created buffers or forged receipts', async () => {
  const original = Uint8Array.from(vrmFixture()),
    expected = original.slice(),
    buffer = original.buffer,
    alias = new Uint8Array(buffer);
  const { modelBuffer } = prepareVerifiedSource(original, 'model/vrml');
  expect(modelBuffer).toBeTruthy();
  expect(buffer.byteLength).toBe(0);
  expect(alias.byteLength).toBe(0);
  expect(Object.isFrozen(modelBuffer)).toBe(true);
  expect(verifiedModelBytes(modelBuffer!)).toBeGreaterThan(0);
  for (const forged of [
    buffer,
    expected.buffer,
    new Blob([expected]),
    { ...modelBuffer },
    Object.freeze(expected.buffer),
  ]) {
    expect(verifiedModelBytes(forged)).toBeUndefined();
    expect(() => parseVerifiedModelSource(forged as VerifiedModelSource, { parseAsync: async () => true })).toThrow();
  }
  const parsed = await parseVerifiedModelSource(modelBuffer!, {
    parseAsync: async (owned) => Uint8Array.from(new Uint8Array(owned)),
  });
  expect(parsed).toEqual(expected);
});

test('verified subviews are isolated from mutable caller aliases and invalid sources never get receipts', async () => {
  const original = Uint8Array.from(vrmFixture()),
    padded = new Uint8Array(original.length + 8);
  padded.set(original, 4);
  const { modelBuffer } = prepareVerifiedSource(padded.subarray(4, -4));
  padded.fill(0);
  expect(modelBuffer!.byteLength).toBe(original.length);
  expect(
    await parseVerifiedModelSource(modelBuffer!, { parseAsync: async (buffer) => new Uint8Array(buffer).slice() }),
  ).toEqual(original);
  expect(() => prepareVerifiedSource(new Uint8Array([0x67, 0x6c, 0x54, 0x46]))).toThrow();
});

test('a Node Buffer subview cannot share mutable storage with the verified model reference', async () => {
  const expected = Uint8Array.from(vrmFixture()),
    caller = Buffer.alloc(expected.length + 8);
  caller.set(expected, 4);
  // Buffer.slice() shares storage, unlike Uint8Array.slice(). Ownership must not depend on the caller's method.
  const { modelBuffer } = prepareVerifiedSource(caller.subarray(4, -4));
  caller.fill(0);
  expect(
    await parseVerifiedModelSource(modelBuffer!, { parseAsync: async (buffer) => new Uint8Array(buffer).slice() }),
  ).toEqual(expected);
});

test('source cache charges model buffers and 2D Blobs once each and evicts by their combined byte lengths', async () => {
  const original = Uint8Array.from(vrmFixture()),
    info = inspectAsset(original),
    modelBuffer = prepareVerifiedSource(original).modelBuffer!;
  const values: Record<string, LoadedAsset> = {
    model: { metadata: { ...info, id: 'model', name: 'model', byteLength: modelBuffer.byteLength }, modelBuffer },
    image: { metadata: { ...info, id: 'image', name: 'image', byteLength: 8 }, blob: new Blob([new Uint8Array(8)]) },
  };
  const cache = createSourceCache({
    load: async (id) => values[id]!,
    size: assetSourceBytes,
    now: () => 0,
    maxBytes: modelBuffer.byteLength + 7,
    idleMs: 30000,
  });
  try {
    await cache.get('model');
    expect(cache.stats().retainedBytes).toBe(modelBuffer.byteLength);
    await cache.get('image');
    expect(cache.stats()).toMatchObject({ entries: 1, retainedBytes: 8 });
  } finally {
    cache.clear();
  }
});
