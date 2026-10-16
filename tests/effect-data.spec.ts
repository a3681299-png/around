import { test, expect } from '@playwright/test';
import { emptyDesign, parseDesign } from '../src/design/schema';
import type { Decoration } from '../src/design/types';
import { defaultCircleMask } from '../src/effects/types';
import { evaluateMask, fadeValue, layerLocal, maskGradient, retargetFade } from '../src/effects/evaluate';
import { SIGNAL_CATALOG, type PlaybackSignal, type PlaybackSource } from '../src/signals/types';
import { createSignalSources } from '../src/signals/sources';
import { createHistory } from '../src/editor/history';

const image = (): Decoration => ({ kind: 'image', id: 'image-world', assetId: `asset-${'c'.repeat(64)}`, name: 'world.png',
  placement: { anchor: { kind: 'surface', target: 'video-player' }, x: .5, y: .5, widthPx: 400, heightPx: 300, rotationDeg: 90 },
  opacity: .7, zIndex: 0, visible: true, locked: false });
const document = () => ({ ...emptyDesign('youtube', null), decorations: [image()] });

test('v1–v4 migrate without adding effects or changing assets; v5 roundtrips shared effect data', () => {
  for (const version of [2, 3, 4]) {
    const layer = image(); if (version === 2) delete (layer as Partial<Decoration>).locked;
    const legacy = { ...document(), schemaVersion: version, decorations: [layer] };
    const before = JSON.stringify(legacy), parsed = parseDesign(legacy);
    expect(parsed.schemaVersion).toBe(5); expect(parsed.decorations[0]).not.toHaveProperty('effects');
    expect(parsed.decorations[0]?.assetId).toBe(layer.assetId); expect(JSON.stringify(legacy)).toBe(before);
  }
  const mask = defaultCircleMask();
  mask.bindings.unshift({ source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: 400 }, target: 'mask.intensity' });
  const input = { ...document(), decorations: [{ ...image(), effects: [mask] }] };
  const parsed = parseDesign(input); expect(parseDesign(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  expect(parsed.decorations[0]?.effects?.[0]?.bindings.map((item) => item.target)).toEqual(['mask.center', 'mask.intensity']);
  expect(input.decorations[0]!.effects[0]!.bindings[0]!.target).toBe('mask.intensity');
  const animation = { ...image(), kind: 'animation', format: 'lottie', playback: { playing: true, loop: true, speed: 1 }, effects: [mask] };
  expect(parseDesign({ ...document(), decorations: [animation] }).decorations[0]?.effects).toEqual(parsed.decorations[0]?.effects);
});

test('untrusted effects reject executable fields, unknown paths, type mismatches and duplicate writers', () => {
  const mask = defaultCircleMask(), pointer = mask.bindings[0]!;
  for (const effects of [
    [mask, mask], [{ ...mask, script: 'alert(1)' }], [{ ...mask, shape: 'url(https://bad.example)' }],
    [{ ...mask, radiusPx: Infinity }], [{ ...mask, radiusPx: 0 }], [{ ...mask, featherPx: -1 }],
    [{ ...mask, intensity: 1.01 }], [{ ...mask, center: { x: NaN, y: .5 } }], [{ ...mask, enabled: 'true' }],
    [{ ...mask, bindings: [pointer, pointer] }], [{ ...mask, bindings: [{ ...pointer, target: 'style.cssText' }] }],
    [{ ...mask, bindings: [{ ...pointer, source: 'video.playing' }] }],
    [{ ...mask, bindings: [{ ...pointer, transform: { kind: 'eval', code: 'window.alert(1)' } }] }],
    [{ ...mask, bindings: [{ source: 'video.pause', transform: { kind: 'boolean-gate', fadeMs: 300 }, target: 'mask.intensity' }] }],
    [{ ...mask, bindings: [{ source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: 5001 }, target: 'mask.intensity' }] }],
  ]) expect(() => parseDesign({ ...document(), decorations: [{ ...image(), effects }] })).toThrow();
  expect(() => parseDesign({ ...document(), schemaVersion: 4, decorations: [{ ...image(), effects: [mask] }] })).toThrow();
});

test('pointer conversion inverts rotated layer placement and recomputes from current anchor geometry', () => {
  const placement = image().placement, frame = { left: 100, top: 200, width: 600, height: 400 };
  expect(layerLocal({ x: 460, y: 400 }, placement, frame)).toEqual({ x: 200, y: 90 });
  expect(layerLocal({ x: 400, y: 460 }, placement, frame)).toEqual({ x: 260, y: 150 });
  const before = JSON.stringify(placement);
  const resized = { left: 50, top: 20, width: 800, height: 600 };
  expect(layerLocal({ x: 510, y: 320 }, placement, resized)).toEqual({ x: 200, y: 90 });
  expect(layerLocal({ x: 510, y: 220 }, placement, { ...resized, top: -80 })).toEqual({ x: 200, y: 90 });
  expect(JSON.stringify(placement)).toBe(before);
});

test('declarative bindings change only runtime center and intensity; disconnect returns static defaults', () => {
  const mask = defaultCircleMask(), placement = image().placement, frame = { left: 0, top: 0, width: 800, height: 600 };
  mask.bindings.push({ source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: 350 }, target: 'mask.intensity' });
  const before = JSON.stringify(mask);
  expect(evaluateMask(mask, placement, frame, { pointer: { x: 460, y: 300 }, playing: false })).toEqual({ center: { x: 200, y: 90 }, gate: 0, fadeMs: 350 });
  expect(evaluateMask(mask, placement, frame, { pointer: undefined, playing: true })).toEqual({ center: { x: 200, y: 150 }, gate: 1, fadeMs: 350 });
  expect(evaluateMask({ ...mask, bindings: [] }, placement, frame, { pointer: { x: 0, y: 0 }, playing: false })).toEqual({ center: { x: 200, y: 150 }, gate: 1, fadeMs: 0 });
  expect(JSON.stringify(mask)).toBe(before);
});

test('pause/resume reverses fade continuously; repeated pointer samples never restart a fade', () => {
  let fade = retargetFade(undefined, 1, 0, 400);
  fade = retargetFade(fade, 0, 100, 400);
  expect(fadeValue(fade, 300)).toBe(.5);
  expect(retargetFade(fade, 0, 300, 400)).toBe(fade);
  fade = retargetFade(fade, 1, 300, 400);
  expect(fadeValue(fade, 300)).toBe(.5); expect(fadeValue(fade, 500)).toBe(.75);
  expect(fadeValue(fade, 10_000)).toBe(1);
  expect(fadeValue(retargetFade(fade, 0, 500, 0), 500)).toBe(0);
});

test('mask composition clamps feather at the center and multiplies configured intensity without changing opacity', () => {
  const mask = { ...defaultCircleMask(), radiusPx: 40, featherPx: 100, intensity: .8 };
  expect(maskGradient(mask, { x: 25, y: 60 }, .5)).toBe('radial-gradient(circle at 25px 60px, rgba(0, 0, 0, 0.4) 0px, transparent 40px)');
  expect(maskGradient({ ...mask, featherPx: 0 }, { x: 0, y: 0 }, 0)).toContain('rgba(0, 0, 0, 0) 40px, transparent 40px');
});

test('signal catalog distinguishes value/state/event; subscriptions are shared, lazy and released', () => {
  expect(SIGNAL_CATALOG['pointer.position'].category).toBe('value');
  expect(SIGNAL_CATALOG['video.playing'].category).toBe('state'); expect(SIGNAL_CATALOG['video.pause'].category).toBe('event');
  const listeners = new Set<(event: PointerEvent) => void>();
  const doc = { addEventListener: (_: string, listener: (event: PointerEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: PointerEvent) => void) => listeners.delete(listener) } as unknown as Document;
  let connected = 0, removed = 0, changes = 0, publish: ((value: PlaybackSignal) => void) | undefined;
  const playback: PlaybackSource = { connect(emit) { connected++; publish = emit; emit({ playing: true }); return { refresh() {}, destroy() { removed++; } }; } };
  const sources = createSignalSources(doc, playback, () => changes++);
  expect(listeners.size).toBe(0); expect(connected).toBe(0);
  for (let i = 0; i < 32; i++) sources.configure({ pointer: true, video: true });
  expect(listeners.size).toBe(1); expect(connected).toBe(1); expect(sources.snapshot.playing).toBe(true);
  listeners.forEach((listener) => listener({ isPrimary: true, clientX: 280, clientY: 160, composedPath: () => [] } as unknown as PointerEvent));
  expect(sources.snapshot.pointer).toEqual({ x: 280, y: 160 });
  publish?.({ playing: false, event: 'video.pause' }); expect(sources.snapshot.playing).toBe(false); expect(changes).toBe(3);
  sources.configure({ pointer: false, video: false }); expect(listeners.size).toBe(0); expect(removed).toBe(1);
  sources.configure({ pointer: true, video: true }); sources.destroy(); sources.destroy();
  expect(listeners.size).toBe(0); expect(connected).toBe(2); expect(removed).toBe(2);
});

test('effect edits share document history; runtime sampling adds no undo records', () => {
  const before = document(), after = parseDesign({ ...before, decorations: [{ ...image(), effects: [defaultCircleMask()] }] });
  const history = createHistory(parseDesign, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  history.record(before, after);
  for (let i = 0; i < 100; i++) evaluateMask(after.decorations[0]!.effects![0]!, image().placement, { left: 0, top: 0, width: 800, height: 600 }, { pointer: { x: i, y: i }, playing: false });
  expect(history.undo(after)).toEqual(before); expect(history.canUndo).toBe(false); expect(history.redo(before)).toEqual(after);
});
