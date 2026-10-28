import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const moduleUrl = pathToFileURL(path.resolve('scripts/ui1/frame-clock.mjs')).href;
const resumeUrl = pathToFileURL(path.resolve('scripts/ui1/resume.mjs')).href;

test('startup CPU includes the presented zero-CPU frames before the document-idle extension arrives', async () => {
  const { sampleFrameClock } = await import(moduleUrl);
  const presented = Array.from({ length: 359 }, (_, index) => (index + 1) * (1000 / 60));
  const sample = { calls: [5550, 2], frames: [5500, 5600, 5800, 6000], kinds: { load: 1 } };
  const page = { evaluate: async () => ({ timeOrigin: 1234, frames: presented }) };
  const startup = await sampleFrameClock(page, sample, 1234, true);
  expect(startup.frames[0]).toBe(0);
  expect(startup.frames.at(-1)).toBe(6000);
  expect(startup.frames).toHaveLength(361);
  expect(startup.calls).toEqual(sample.calls);
  expect(startup.clock.beforeExtensionFrames).toBeGreaterThan(300);
  const steady = await sampleFrameClock(page, sample, 1234);
  expect(steady.frames[0]).toBe(5500);
  expect(steady.clock.beforeExtensionFrames).toBe(0);
});

test('CPU capture boundaries neither duplicate a frame nor accept another document clock', async () => {
  const { frameWindow, sampleFrameClock } = await import(moduleUrl);
  expect(frameWindow(10, 40, [0, 10, 20, 30, 40, 50])).toEqual([10, 20, 30, 40]);
  expect(() => frameWindow(10, 10, [])).toThrow('Invalid CPU capture window');
  expect(() => frameWindow(10, 40, [20, 20, 30])).toThrow('Frame timestamps must increase');
  const page = { evaluate: async () => ({ timeOrigin: 999, frames: [20, 30] }) };
  await expect(sampleFrameClock(page, { frames: [10, 40] }, 1234)).rejects.toThrow('different documents');
});

test('measurement resume keeps completed pairs and records the unfinished tail without changing alternating order', async () => {
  const { resumeMeasurement } = await import(resumeUrl);
  const phase = { frames: [0, 1], clock: { source: 'document-start-main-world-raf-timestamps' } };
  const block = { startup: phase, steady: phase, spa: phase };
  const completed = { pair: 0, order: ['plain', 'skinned'], blocks: { plain: block, skinned: block } };
  const unfinished = { pair: 1, order: ['skinned', 'plain'], blocks: { skinned: block } };
  const current = {
    mode: 'skin',
    url: 'https://www.youtube.com/results?q=fixture',
    environment: { phaseMs: 6000 },
    builds: { after: { revision: 'target' } },
    pairs: [],
  };
  const previous = { ...current, failure: 'busy code session', pairs: [completed, unfinished] };
  const result = resumeMeasurement(previous, current, ['plain', 'skinned'], 'resume-time');
  expect(result.pairs).toEqual([completed]);
  expect(result.interrupted).toEqual([
    { at: 'resume-time', failure: 'busy code session', unfinishedPairs: [unfinished] },
  ]);
  expect(result.failure).toBeUndefined();
  expect(previous.pairs).toEqual([completed, unfinished]);
});

test('measurement resume refuses different builds and discarded completed pairs', async () => {
  const { resumeMeasurement } = await import(resumeUrl);
  const current = { mode: 'skin', url: 'same', environment: {}, builds: { after: { revision: 'target' } }, pairs: [] };
  expect(() => resumeMeasurement({ ...current, builds: { after: { revision: 'other' } } }, current, [])).toThrow(
    'builds',
  );
  const phase = { frames: [0], clock: { source: 'document-start-main-world-raf-timestamps' } };
  const complete = { pair: 1, blocks: { plain: { startup: phase, steady: phase, spa: phase } } };
  expect(() =>
    resumeMeasurement({ ...current, pairs: [{ pair: 0, blocks: {} }, complete] }, current, ['plain']),
  ).toThrow('select away');
});
