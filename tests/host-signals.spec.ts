import { test, expect } from '@playwright/test';
import { createSignalSources } from '../src/host/signals';

const originalResizeObserver = globalThis.ResizeObserver;
test.afterEach(() => {
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  else Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

function harness() {
  let reads = 0, serial = 0, onResize: () => void = () => {};
  const values = { scrollLeft: 10, scrollTop: 20, scrollWidth: 1000, scrollHeight: 2000, clientWidth: 500, clientHeight: 600 };
  const root = Object.defineProperties({}, Object.fromEntries(Object.entries(values).map(([key]) => [key, { get() { reads++; return values[key as keyof typeof values]; } }])));
  const listeners = new Map<string, EventListener>(), viewListeners = new Map<string, EventListener>(), frames = new Map<number, FrameRequestCallback>();
  const view = { addEventListener(type: string, listener: EventListener) { viewListeners.set(type, listener); }, removeEventListener(type: string) { viewListeners.delete(type); },
    requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++serial, callback); return serial; }, cancelAnimationFrame(id: number) { frames.delete(id); } };
  const doc = { scrollingElement: root, documentElement: root, body: {}, defaultView: view,
    addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); }, removeEventListener(type: string) { listeners.delete(type); } };
  globalThis.ResizeObserver = class { constructor(callback: () => void) { onResize = callback; } observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  const changes: string[] = [], sources = createSignalSources(doc as unknown as Document, undefined, (source) => changes.push(source));
  return { sources, values, changes, frames, get reads() { return reads; },
    scroll(target: object = doc) { listeners.get('scroll')?.({ target } as Event); }, resize() { onResize(); viewListeners.get('resize')?.({} as Event); },
    frame() { const next = [...frames.values()]; frames.clear(); next.forEach((callback) => callback(16)); } };
}

test('scroll and resize events defer geometry reads and coalesce into the next RAF', () => {
  const h = harness(); h.sources.configure({ pointer: false, video: false, scroll: true });
  try {
    const initial = h.sources.snapshot.scroll; expect(h.reads).toBe(6);
    h.scroll({}); expect(h.frames.size).toBe(0);
    h.values.scrollTop = 300; h.values.scrollHeight = 3000; h.values.scrollWidth = 1200; h.values.clientWidth = 400;
    h.scroll(); h.scroll(); h.resize();
    expect(h.reads).toBe(6); expect(h.sources.snapshot.scroll).toBe(initial); expect(h.changes).toEqual([]); expect(h.frames.size).toBe(1);
    h.frame(); expect(h.reads).toBe(12); expect(h.frames.size).toBe(0); expect(h.changes).toEqual(['page.scroll.progress']);
    expect(h.sources.snapshot.scroll).toEqual({ x: 10, y: 300, maxX: 800, maxY: 2400 });
    h.scroll(); h.frame(); expect(h.changes).toHaveLength(1);
  } finally { h.sources.destroy(); }
});

test('disabling or destroying scroll signals cancels a pending sample', () => {
  const h = harness(); h.sources.configure({ pointer: false, video: false, scroll: true });
  h.scroll(); expect(h.frames.size).toBe(1);
  h.sources.configure({ pointer: false, video: false }); expect(h.frames.size).toBe(0); expect(h.sources.snapshot.scroll).toBeUndefined();
  const before = h.reads; h.frame(); h.scroll(); expect(h.reads).toBe(before); expect(h.changes).toEqual([]);
  h.sources.configure({ pointer: false, video: false, scroll: true }); h.scroll(); expect(h.frames.size).toBe(1);
  h.sources.destroy(); expect(h.frames.size).toBe(0); expect(h.sources.snapshot.scroll).toBeUndefined();
  h.frame(); expect(h.changes).toEqual([]);
});
