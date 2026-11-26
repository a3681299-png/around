import { test, expect } from '@playwright/test';
import { inkDesignKey, INK_CACHE_LIMIT, parseInkCache, withInkEntry } from '../src/design/ink-cache';
import type { DesignDocument } from '../src/design/types';

const design = (color: string) =>
  ({ rules: [{ target: 'chip', style: { backgroundColor: color } }] }) as unknown as DesignDocument;

test('the key follows art-relevant data only', () => {
  expect(inkDesignKey(design('#112233'))).toMatch(/^[0-9a-f]{8}$/);
  expect(inkDesignKey(design('#112233'))).toBe(inkDesignKey(design('#112233')));
  expect(inkDesignKey(design('#112233'))).not.toBe(inkDesignKey(design('#112234')));
});

test('stored data is validated: only white or black for known slots survive', () => {
  const good = { light: { chip: { normal: '#ffffff', compact: '#000000' } }, dark: { chip: { hover: '#000000' } } };
  const cache = parseInkCache({
    '0123abcd': good,
    NOTAKEY: good,
    '0123abce': {
      light: { chip: { normal: 'red', bogus: '#ffffff', focus: 'url(x)' }, 'Bad Name': { normal: '#fff' } },
    },
    '0123abcf': 'text',
  });
  expect(cache['0123abcd']).toStrictEqual(good);
  expect(cache['NOTAKEY']).toBeUndefined();
  expect(cache['0123abce']).toStrictEqual({ light: {} });
  expect(cache['0123abcf']).toBeUndefined();
  for (const junk of [null, 1, 'x', [], undefined]) expect(parseInkCache(junk)).toStrictEqual({});
});

test('the cache keeps the newest few entries', () => {
  let cache = {};
  for (let index = 0; index < INK_CACHE_LIMIT + 2; index++)
    cache = withInkEntry(cache, index.toString(16).padStart(8, '0'), {});
  expect(Object.keys(cache)).toHaveLength(INK_CACHE_LIMIT);
  expect(Object.keys(cache).at(-1)).toBe((INK_CACHE_LIMIT + 1).toString(16).padStart(8, '0'));
  expect(Object.keys(withInkEntry(cache, Object.keys(cache)[0]!, {})).at(-1)).toBe(Object.keys(cache)[0]);
});
