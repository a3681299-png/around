import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inspectAsset } from '../src/assets/inspect';
import { advanceMediaTime, frameAt, initialMediaTime, reconcileMediaTime } from '../src/world/media-time';

test('GIF/WebP/Lottie timing matches the old clock over identical deltas, loop and speed settings', async () => {
  for (const file of ['petal.gif', 'petal.webp', 'petal.json']) {
    const info = inspectAsset(new Uint8Array(await readFile(`tests/fixtures/motion/${file}`))).animation!;
    for (const loop of [true, false]) for (const speed of info.format === 'lottie' ? [.25, 1, 1.5, 3] : [1]) {
      const playback = { playing: true, loop, speed };
      let state = initialMediaTime(), elapsed = 0, finished = false;
      for (const [index, delta] of [0, 40, 80, 30, 120, 300, 60, 1000].entries()) {
        const running = !finished && index !== 3;
        if (running) {
          elapsed += delta * speed;
          if (elapsed >= info.durationMs) { if (loop) elapsed %= info.durationMs; else { elapsed = info.durationMs; finished = true; } }
        }
        const result = advanceMediaTime(Object.freeze(state), info, playback, delta, running);
        expect(result).toEqual({ state: { elapsedMs: elapsed, finished }, frame: frameAt(info, elapsed) }); state = result.state;
      }
    }
  }
});

test('terminal playback restarts on resume or loop enable, while pause/transform/hidden sampling preserves time', () => {
  const finished = { elapsedMs: 360, finished: true }, playing = { playing: true, loop: false, speed: 1 }, paused = { ...playing, playing: false };
  expect(reconcileMediaTime(finished, playing, playing)).toBe(finished); expect(reconcileMediaTime(finished, playing, paused)).toBe(finished);
  expect(reconcileMediaTime(finished, paused, playing)).toEqual(initialMediaTime());
  expect(reconcileMediaTime(finished, playing, { ...playing, loop: true })).toEqual(initialMediaTime());
  const state = { elapsedMs: 120, finished: false }, info = { format: 'gif' as const, durationMs: 360, frameCount: 3, frameDurationsMs: [120, 120, 120] };
  expect(advanceMediaTime(state, info, playing, 500, false)).toEqual({ state, frame: 1 });
  for (const delta of [NaN, Infinity, -1]) expect(() => advanceMediaTime(state, info, playing, delta, true)).toThrow(/delta/);
});
