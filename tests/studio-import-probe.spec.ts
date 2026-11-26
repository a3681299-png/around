import { test, expect } from '@playwright/test';
import { readAssetRows } from './helpers/studio-import';

test('an absent asset database is observed as empty without opening or creating it', async () => {
  let opens = 0;
  const rows = await readAssetRows({
    databases: async () => [],
    open: () => {
      opens++;
      throw new Error('A read probe must not create the database.');
    },
  });
  expect(rows).toEqual([]);
  expect(opens).toBe(0);
});

test('an existing database with a missing store rejects immediately instead of hanging or reporting empty', async () => {
  let closes = 0;
  const request = {
    result: {
      close: () => {
        closes++;
      },
      transaction: () => {
        throw new DOMException('Missing assets store', 'NotFoundError');
      },
    },
  } as unknown as IDBOpenDBRequest;
  const result = readAssetRows({
    databases: async () => [{ name: 'around-assets', version: 1 }],
    open: () => {
      queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
      return request;
    },
  });
  await expect(result).rejects.toThrow('Missing assets store');
  expect(closes).toBe(1);
});

test('a database disappearing after the catalog read aborts creation and reports the race', async () => {
  let aborts = 0;
  const request = {
    transaction: {
      abort: () => {
        aborts++;
      },
    },
  } as unknown as IDBOpenDBRequest;
  const result = readAssetRows({
    databases: async () => [{ name: 'around-assets', version: 1 }],
    open: () => {
      queueMicrotask(() => request.onupgradeneeded?.call(request, {} as IDBVersionChangeEvent));
      return request;
    },
  });
  await expect(result).rejects.toThrow('will not create');
  expect(aborts).toBe(1);
});
