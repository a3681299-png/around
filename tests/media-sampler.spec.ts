import { test, expect } from '@playwright/test';
import { createMediaBudget, MEDIA_BUDGET } from '../src/media/budget';
import { createFrameSampler, type DecodedFrame } from '../src/media/sampler';

const timeline = { count: 20, frameAt: (ms: number) => Math.min(19, Math.max(0, Math.floor(ms / 100))), timeAt: (index: number) => index * 100 };
const request = (timeMs: number, consumer = 'layer', velocity = 0) => ({ timeMs, consumer, velocity });
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const frame = (index: number, closed: number[]): DecodedFrame => ({ source: {} as HTMLCanvasElement, bytes: 16, close() { closed.push(index); } });

test('late decode never overwrites a newer request; queued requests coalesce and resources close once', async () => {
  const closed: number[] = [], calls: number[] = [], releases: Array<(value: DecodedFrame) => void> = [], budget = createMediaBudget();
  const sampler = createFrameSampler('asset', { decode(index) { calls.push(index); return new Promise((resolve) => releases.push(resolve)); }, close() {} }, timeline, budget);
  const old = sampler.request(request(0)); await turn();
  const superseded = sampler.request(request(100)), latest = sampler.request(request(200));
  expect(await superseded).toEqual({ status: 'pending', reason: 'superseded' });
  releases.shift()!(frame(0, closed)); expect(await old).toEqual({ status: 'pending', reason: 'superseded' }); await turn();
  expect(calls).toEqual([0, 2]); releases.shift()!(frame(2, closed));
  const value = await latest; expect(value.status).toBe('exact'); if ('frame' in value) { expect(value.frame.index).toBe(2); value.frame.close(); value.frame.close(); }
  sampler.destroy(); expect(closed.sort()).toEqual([0, 2]); expect(budget.stats().decodedBytes).toBe(0);
});

test('cache has four frames, respects the byte budget and exposes fallback/pending/error distinctly', async () => {
  const closed: number[] = [], budget = createMediaBudget({ ...MEDIA_BUDGET, decodedBytes: 64, cacheBytes: 64 });
  const sampler = createFrameSampler('asset', { async decode(index) { if (index === 12) throw new Error('broken frame'); return frame(index, closed); }, close() {} }, timeline, budget);
  expect(sampler.peek(request(0))).toEqual({ status: 'pending', reason: 'decoding' });
  for (let i = 0; i < 10; i++) { const value = await sampler.request(request(i * 100)); expect(value.status).toBe('exact'); if ('frame' in value) value.frame.close(); }
  const alternate = sampler.peek(request(0)); expect(alternate.status).toBe('fallback'); if ('frame' in alternate) alternate.frame.close();
  expect(await sampler.request(request(1200))).toEqual({ status: 'error', message: 'broken frame' });
  expect(budget.stats().cacheBytes).toBeLessThanOrEqual(64); expect(budget.stats().peakDecodedBytes).toBeLessThanOrEqual(64);
  sampler.destroy(); expect(new Set(closed).size).toBe(10); expect(closed).toHaveLength(10);
});

test('prefetch follows speed and direction; destruction closes an in-flight result', async () => {
  const calls: number[] = [], closed: number[] = [], budget = createMediaBudget();
  const sampler = createFrameSampler('asset', { async decode(index) { calls.push(index); return frame(index, closed); }, close() {} }, timeline, budget);
  const forward = await sampler.request(request(500, 'a', 2)); if ('frame' in forward) forward.frame.close(); await turn();
  expect(calls.slice(0, 3)).toEqual([5, 6, 7]);
  const backward = await sampler.request(request(1000, 'b', -2)); if ('frame' in backward) backward.frame.close(); await turn();
  expect(calls).toEqual(expect.arrayContaining([10, 9, 8])); sampler.destroy();
  let complete!: (value: DecodedFrame) => void;
  const pending = createFrameSampler('pending', { decode() { return new Promise((resolve) => { complete = resolve; }); }, close() {} }, timeline, budget);
  const result = pending.request(request(0)); await turn(); pending.destroy(); complete(frame(99, closed));
  expect(await result).toEqual({ status: 'pending', reason: 'closed' }); expect(closed).toContain(99);
});

test('global decode permits remain bounded under contention and disposal rejects queued work', async () => {
  const budget = createMediaBudget({ ...MEDIA_BUDGET, concurrentDecodes: 2 });
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 30 }, () => budget.decode(async () => { active++; peak = Math.max(peak, active); await turn(); active--; })));
  await turn(); expect(peak).toBe(2); expect(budget.stats().inFlight).toBe(0);
  expect(budget.reserve('original', 32, 'encoded')).toBe(true); expect(() => budget.reserve('original', 64, 'encoded')).toThrow();
  budget.release('original'); expect(budget.stats().encodedBytes).toBe(0); budget.destroy(); await expect(budget.decode(async () => 1)).rejects.toThrow(/closed/);
});
