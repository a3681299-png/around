import { test, expect } from '@playwright/test';
import { createTimelineHost } from '../src/host/timeline';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';
import { createTakeSampler } from '../src/world/takes';
import { worldScenario } from './helpers/world-scenario';
import type { TakeStorage } from '../src/timeline/types';
import { defaultFollowMotion } from '../src/signals/motion';
import { defaultSignalRule } from '../src/signals/keyframes';

function harness() {
  const { scene, inputs } = worldScenario(2);
  scene.decorations.forEach((layer) => {
    layer.visible = true;
    layer.opacity = 1;
  });
  scene.groups!.forEach((group) => {
    group.visible = true;
    group.opacity = 1;
  });
  let clock = 0,
    state = initialWorldState(),
    playing = true,
    pointer = inputs[0]!.signals.pointer,
    pointerTimeMs = 0,
    events = inputs[0]!.events,
    last: ReturnType<typeof evaluateWorld> | undefined;
  const listeners = new Map<string, EventListener>();
  const doc = {
    hidden: false,
    defaultView: { performance: { now: () => clock } },
    addEventListener(type: string, callback: EventListener) {
      listeners.set(type, callback);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
  };
  const storage: TakeStorage = {
    list: async () => [],
    get: async () => {
      throw new Error('missing');
    },
    put: async () => undefined,
    remove: async () => undefined,
  };
  const host = createTimelineHost(doc as unknown as Document, 'youtube', storage);
  const expected = new Map<number, ReturnType<typeof evaluateWorld>>();
  function paint() {
    const input = {
      ...inputs[0]!,
      timeMs: clock,
      deltaMs: state.timeMs === null ? 0 : clock - state.timeMs,
      events,
      signals: {
        ...inputs[0]!.signals,
        pointer,
        pointerTimeMs,
        playing,
        scroll: { x: 0, y: clock, maxX: 0, maxY: 2000 },
      },
    };
    events = [];
    const previous = state,
      overridden = host.preview(scene);
    last = overridden ?? evaluateWorld(scene, state, input);
    state = last.state;
    if (!overridden) {
      if (host.recording) expected.set(clock, last);
      host.capture(scene, previous, input, last);
    }
  }
  const detach = host.attach({
    refresh: paint,
    reset() {
      state = initialWorldState();
    },
  });
  paint();
  return {
    host,
    expected,
    scene,
    storage,
    doc,
    listeners,
    detach,
    paint,
    get frame() {
      return last!.frame;
    },
    step(time: number, nextPlaying = playing, nextPointer?: { x: number; y: number }) {
      clock = time;
      if (nextPointer) {
        pointer = nextPointer;
        pointerTimeMs = time;
      }
      if (playing !== nextPlaying) events = [{ type: nextPlaying ? 'video.play' : 'video.pause' }];
      playing = nextPlaying;
      paint();
    },
  };
}

test('motion recording retains every evaluated input; seek, reverse and live isolation preserve complete frames', async () => {
  const h = harness();
  h.scene.decorations[0]!.motion = defaultFollowMotion();
  h.paint();
  try {
    await h.host.command('test', { type: 'record' });
    for (let index = 1; index <= 100; index++)
      h.step(index * 10, true, { x: 200 + index * 4, y: 300 + Math.sin(index / 10) * 100 });
    await h.host.command('test', { type: 'stop' });
    await Promise.resolve();
    const take = h.host.snapshot().take!,
      sampler = createTakeSampler(h.scene, take);
    expect(take.inputs.length).toBeGreaterThan(95);
    for (const input of [...take.inputs].reverse())
      expect(sampler.at(input.timeMs - take.inputs[0]!.timeMs).frame).toEqual(h.expected.get(input.timeMs)!.frame);
    await h.host.command('test', { type: 'seek', timeMs: 500 });
    await Promise.resolve();
    const frame = h.frame;
    h.step(3000, false, { x: 10000, y: 10000 });
    expect(h.frame).toEqual(frame);
  } finally {
    h.detach();
  }
});

test('numeric driver tracking and isolated signal previews use the same evaluator, including speed and anchor coordinates', async () => {
  const h = harness();
  try {
    for (const source of [
      { signal: 'pointer.x', axis: 'x', space: 'viewport', inputRange: [0, 1] },
      { signal: 'pointer.angle', axis: 'y', space: 'layer', inputRange: [-180, 180] },
      { signal: 'pointer.speed', axis: 'y', space: 'viewport', inputRange: [0, 2000] },
    ] as const) {
      const rule = defaultSignalRule('image-0', 'position.x', { ...source, inputRange: [...source.inputRange] });
      h.scene.signalRules = [rule];
      await h.host.command('test', { type: 'track', rule });
      const progress = source.inputRange[0] + (source.inputRange[1] - source.inputRange[0]) * 0.75;
      await h.host.command('test', { type: 'preview', progress, rule });
      await Promise.resolve();
      const layer = h.frame.layout.layers[0]!,
        base = h.scene.decorations[0]!;
      expect((layer.layer.placement.x - base.placement.x) * layer.frame!.width).toBeCloseTo(100, 5);
      expect(h.host.snapshot().status.source).toBe('signal');
      await h.host.command('test', { type: 'live' });
      await Promise.resolve();
    }
  } finally {
    h.detach();
  }
});
test('recording starts mid-fade without resetting the live state, and sampled frames replay identically', async () => {
  const h = harness();
  try {
    h.step(100, false);
    h.step(200);
    const before = h.frame.effects[0]!.mask!.intensity;
    expect(before).toBeGreaterThan(0.5);
    await h.host.command('test', { type: 'record' });
    await Promise.resolve();
    expect(h.frame.effects[0]!.mask!.intensity).toBeCloseTo(before, 12);
    h.step(250);
    h.step(300);
    h.step(350);
    await h.host.command('test', { type: 'stop' });
    const take = h.host.snapshot().take!,
      sampler = createTakeSampler(h.scene, take);
    for (const input of take.inputs)
      expect(sampler.at(input.timeMs - take.inputs[0]!.timeMs).frame).toEqual(h.expected.get(input.timeMs)!.frame);
  } finally {
    h.detach();
  }
});
test('continuous recording stays bounded, hidden tabs stop it, and late load cannot re-enter preview', async () => {
  const h = harness();
  try {
    await h.host.command('test', { type: 'record' });
    for (let time = 10; time <= 1000; time += 10) h.step(time);
    expect(h.host.snapshot().status.samples).toBeGreaterThan(15);
    expect(h.host.snapshot().status.samples).toBeLessThan(30);
    h.doc.hidden = true;
    h.listeners.get('visibilitychange')!({} as Event);
    expect(h.host.recording).toBe(false);
    let finish: (value: NonNullable<ReturnType<typeof h.host.snapshot>['take']>) => void = () => {};
    const take = h.host.snapshot().take!;
    h.storage.get = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const load = h.host.command('test', { type: 'load', id: take.id });
    h.host.resumeLive();
    finish(take);
    await load;
    expect(h.host.snapshot().status.source).toBe('live');
  } finally {
    h.detach();
  }
});

test('preview publishes its new progress immediately and throttled live telemetry delivers the final value once', async () => {
  const h = harness(),
    progress: number[] = [],
    off = h.host.subscribe((update) => progress.push(update.status.progress));
  try {
    await h.host.command('test', { type: 'observe', value: true });
    h.step(10);
    h.step(20);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(progress.at(-1)).toBe(0.01);
    await h.host.command('test', { type: 'preview', progress: 0.5 });
    expect(progress.at(-1)).toBe(0.5);
    expect(h.host.snapshot().status.source).toBe('signal');
    h.host.resumeLive();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(progress.at(-1)).toBe(0.01);
  } finally {
    off();
    h.detach();
  }
});
