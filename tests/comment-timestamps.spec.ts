import { test, expect } from '@playwright/test';
import { formatExactCommentTimestamp } from '../src/sites/youtube-comments';

test('exact comment timestamp formatting requires a full valid timezone timestamp', () => {
  expect(formatExactCommentTimestamp('2026-10-04T17:05:42+09:00')).toBe('2026/10/04(日) 17:05');
  expect(formatExactCommentTimestamp('2026-10-04T00:05Z')).toBe('2026/10/04(日) 00:05');
  expect(formatExactCommentTimestamp('2024-02-29T23:59:59.123-05:00')).toBe('2024/02/29(木) 23:59');
  for (const value of [
    '4 years ago', '2 日前', '2026-10-04', '2026/10/04(日) 17:05',
    '2026-10-04T17:05:42', '2026-10-04T17:05:42+0900',
    '2023-02-29T17:05:00Z', '2026-02-30T17:05:00Z', '2026-13-04T17:05:00Z',
    '2026-10-00T17:05:00Z', '2026-10-04T24:00:00Z', '2026-10-04T17:60:00Z',
    '2026-10-04T17:05:60Z', '2026-10-04T17:05:00-00:00', '2026-10-04T17:05:00+24:00', '2026-10-04T17:05:00+09:60',
  ]) expect(formatExactCommentTimestamp(value), value).toBeNull();
});
