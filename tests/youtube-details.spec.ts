import { test, expect } from '@playwright/test';
import { dailyYouTubeDetail, mountYouTubeFocus } from '../src/sites/youtube-details';

test('calendar details are stable during a day, vary daily, and repeat deterministically', () => {
  const morning = new Date(2026, 9, 4, 0, 1);
  const evening = new Date(2026, 9, 4, 23, 59);
  expect(dailyYouTubeDetail(morning)).toBe(dailyYouTubeDetail(evening));
  expect(dailyYouTubeDetail(morning)).not.toBe(dailyYouTubeDetail(new Date(2026, 9, 5, 0, 1)));
  expect(dailyYouTubeDetail(morning)).toBe(dailyYouTubeDetail(new Date(2026, 9, 11, 0, 1)));
  expect(dailyYouTubeDetail(new Date(1960, 0, 1))).toBeTruthy();
});

test('focus lifecycle follows real focus and visibility after event settlement and ignores synthetic activation', () => {
  const attributes = new Map<string, string>();
  const root = {
    toggleAttribute(name: string, value: boolean) { if (value) attributes.set(name, ''); else attributes.delete(name); },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
  };
  let focused = true;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const view = Object.assign(new EventTarget(), {
    Element: class {},
    queueMicrotask,
    setTimeout(callback: () => void) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root, defaultView: view, activeElement: null, body: {}, hidden: false,
    hasFocus: () => focused,
    querySelector: () => null,
  });
  const flushTasks = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach(callback => callback());
  };
  const instance = mountYouTubeFocus(doc as unknown as Document);
  expect(attributes.has('data-ww-document-active')).toBe(true);
  // Model a browser whose blur callback precedes its hasFocus() state update.
  view.dispatchEvent(new Event('blur'));
  focused = false;
  flushTasks();
  expect(attributes.has('data-ww-document-active')).toBe(false);
  view.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('pointerdown'));
  doc.dispatchEvent(new Event('focusin'));
  flushTasks();
  expect(attributes.has('data-ww-document-active')).toBe(false);
  expect(attributes.has('data-ww-active-pane')).toBe(false);
  focused = true;
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  view.dispatchEvent(new Event('focus'));
  flushTasks();
  expect(attributes.has('data-ww-document-active')).toBe(false);
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(attributes.has('data-ww-document-active')).toBe(true);
  view.dispatchEvent(new Event('blur'));
  expect(timers.size).toBe(1);
  instance.destroy();
  expect(timers.size).toBe(0);
  expect(attributes.size).toBe(0);
  view.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  flushTasks();
  expect(timers.size).toBe(0);
  expect(attributes.size).toBe(0);
});
