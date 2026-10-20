import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inspectAsset } from '../src/assets/inspect';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { frameAt, frameAtTimeline, prepareMediaTimeline } from '../src/world/media-time';
import { worldScenario } from './helpers/world-scenario';
import { createWorldRecorder, parseWorldRecording, replayWorld } from '../src/world/recording';
import { initialWorldState } from '../src/world/evaluate';

test('APNG validates chunk bounds, CRC, sequence and timing; long GIF is not expanded or duration-limited', async () => {
  const apng = new Uint8Array(await readFile('tests/fixtures/motion/petal.apng'));
  expect(inspectAsset(apng, 'image/apng')).toMatchObject({
    mime: 'image/png',
    width: 64,
    height: 48,
    animation: { format: 'apng', frameCount: 3, durationMs: 360, loopCount: 0 },
  });
  for (const position of [45, 80, apng.length - 2]) {
    const broken = apng.slice();
    broken[position] = broken[position]! ^ 255;
    expect(() => inspectAsset(broken)).toThrow();
  }
  expect(() => inspectAsset(apng.subarray(0, apng.length - 1))).toThrow();
  const long = inspectAsset(new Uint8Array(await readFile('tests/fixtures/motion/long.gif')));
  expect(long.animation).toMatchObject({ frameCount: 303, durationMs: 36_360, loopCount: 0 });
  const timeline = prepareMediaTimeline(long.animation!);
  for (let time = 0; time <= long.animation!.durationMs; time += 13)
    expect(frameAtTimeline(timeline, time)).toBe(frameAt(long.animation!, time));
  const large = inspectAsset(new Uint8Array(await readFile('tests/fixtures/motion/large.gif')));
  expect(large.width).toBe(1080);
  expect(large.width * large.height * large.animation!.frameCount).toBeGreaterThan(8 * 1024 * 1024);
});

test('v7 modes and raster speed preserve old v6 defaults; legacy recordings remain replayable', () => {
  const { scene, inputs } = worldScenario(4),
    base = { ...emptyDesign('youtube', null), ...scene, groups: [] };
  const image = base.decorations[0]!;
  const animation = {
    ...image,
    kind: 'animation',
    format: 'apng',
    playback: { playing: true, loop: true, speed: 2, mode: 'auto' },
  };
  expect(parseDesign({ ...base, decorations: [animation] }).decorations[0]).toMatchObject({
    playback: animation.playback,
  });
  expect(() => parseDesign({ ...base, schemaVersion: 6, decorations: [animation] })).toThrow();
  const old = { ...animation, format: 'gif', playback: { playing: true, loop: true, speed: 1 } };
  expect(parseDesign({ ...base, schemaVersion: 6, decorations: [old] }).decorations[0]).toMatchObject({
    playback: old.playback,
  });
  expect(parseDesign({ ...base, schemaVersion: 6, decorations: [old] }).decorations[0]).not.toHaveProperty(
    'playback.mode',
  );
  const recorder = createWorldRecorder();
  recorder.start(scene, initialWorldState());
  recorder.capture(scene, inputs[0]!);
  const recording = recorder.stop()!,
    legacy = { ...recording, formatVersion: 1 };
  expect(parseWorldRecording(legacy).formatVersion).toBe(3);
  expect(replayWorld(legacy)).toEqual(replayWorld(recording));
});

test('finalized VP9 alpha WebM supports 1080p and long duration; malformed containers/MIME are rejected', async () => {
  for (const [file, width, height, durationMs] of [
    ['alpha1080.webm', 1920, 1080, 2000],
    ['long.webm', 64, 48, 45_000],
  ] as const) {
    const bytes = new Uint8Array(await readFile(`tests/fixtures/motion/${file}`));
    expect(inspectAsset(bytes, 'video/webm')).toMatchObject({
      mime: 'video/webm',
      width,
      height,
      animation: { format: 'webm', durationMs, frameCount: 0, codec: 'vp9', alpha: true },
    });
    expect(() => inspectAsset(bytes, 'image/gif')).toThrow();
    expect(() => inspectAsset(bytes.subarray(0, bytes.length - 100))).toThrow();
    const broken = bytes.slice();
    broken[4] = 0;
    expect(() => inspectAsset(broken)).toThrow();
    const fake = bytes.slice(),
      codec = Buffer.from(fake).indexOf('V_VP9');
    expect(codec).toBeGreaterThan(0);
    fake[codec + 4] = 49;
    expect(() => inspectAsset(fake)).toThrow();
  }
});
