import { test, expect } from '@playwright/test';
import { createWorldSession } from '../src/host/world-session';
import { evaluateWorld, initialWorldState, layoutEffectTargets } from '../src/world/evaluate';
import { worldScenario } from './helpers/world-scenario';
import type { TimelineHost } from '../src/host/timeline';
import type { WorldFrame } from '../src/world/types';

test('paused take fades freeze without self-scheduling RAF; live fades keep advancing', () => {
  const { scene, inputs } = worldScenario(2); scene.decorations.forEach((layer) => { layer.visible = true; layer.opacity = 1; }); scene.groups!.forEach((group) => { group.visible = true; group.opacity = 1; });
  const initial = { ...inputs[0]!, timeMs: 0, signals: { pointer: { x: 200, y: 200 }, playing: true } };
  const first = evaluateWorld(scene, initialWorldState(), initial), paused = { ...initial, timeMs: 100, deltaMs: 100, signals: { ...initial.signals, playing: false } };
  const second = evaluateWorld(scene, first.state, paused), frozenInput = { ...paused, timeMs: 200 }, frozen = evaluateWorld(scene, second.state, frozenInput);
  expect(frozen.frame.needsFrame).toBe(true); expect(frozen.frame.effects[0]!.mask!.intensity).toBeGreaterThan(.5);
  let serial = 0, override = true, playing = false, applied: WorldFrame | undefined, refresh: (() => void) | undefined;
  const frames = new Map<number, FrameRequestCallback>(), listeners = new Map<string, EventListener>();
  const view = { performance: { now: () => 250 }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame(callback: FrameRequestCallback) { const id = ++serial; frames.set(id, callback); return id; }, cancelAnimationFrame(id: number) { frames.delete(id); } };
  const doc = { hidden: false, defaultView: view, addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); }, removeEventListener(type: string) { listeners.delete(type); } };
  const timeline = { get observing() { return false; }, get recording() { return false; }, get playing() { return playing; }, get overriding() { return override; },
    attach(binding: { refresh(): void }) { refresh = binding.refresh; return () => {}; }, preview() { return override ? { ...frozen, input: frozenInput } : undefined; }, capture() {} } as unknown as TimelineHost;
  const session = createWorldSession(doc as unknown as Document, undefined, (frame) => { applied = frame; }, undefined, timeline);
  try {
    session.update(layoutEffectTargets(frozen.frame.layout), { scene, geometry: frozenInput }); expect(applied).toEqual(frozen.frame); expect(frames.size).toBe(0);
    playing = true; refresh!(); expect(frames.size).toBe(0); // Playback time comes from the take clock's explicit ticks.
    override = false; playing = false; refresh!(); expect(frames.size).toBe(1); expect(applied!.effects[0]!.mask!.intensity).toBeLessThan(frozen.frame.effects[0]!.mask!.intensity);
  } finally { session.destroy(); }
  expect(frames.size).toBe(0);
});
