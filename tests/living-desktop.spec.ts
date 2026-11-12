import { test, expect } from '@playwright/test';
import {
  APPS,
  BAR_H,
  DOCK_H,
  WALLPAPERS,
  desktopLight,
  focused,
  linear,
  reduceDesktop,
  startDesktop,
  type DesktopAction,
  type DesktopState,
} from '../src/living-room/desktop/state';
import { edgeSamples } from '../src/living-room/desktop/edge';

// The virtual desktop (docs/living-desktop.md): its state is the one source the DOM, the room's
// monitor and the room's light all read. Pure.

const run = (state: DesktopState, ...actions: DesktopAction[]) => actions.reduce(reduceDesktop, state);
const start = () => startDesktop([1280, 720]);

test('opening the desktop the first time brings the resident window; closing keeps the windows', () => {
  const open = run(start(), { type: 'open' });
  expect(open.open).toBe(true);
  expect(open.windows.map((w) => w.id)).toEqual(['resident']);
  const again = run(open, { type: 'app', id: 'ambience' }, { type: 'close' }, { type: 'open' });
  expect(again.windows.map((w) => w.id)).toEqual(['resident', 'ambience']);
});

test('an app opens once: asking again brings it to the front; focus follows the last one touched', () => {
  let s = run(start(), { type: 'open' }, { type: 'app', id: 'ambience' }, { type: 'app', id: 'mirror' });
  expect(focused(s)?.id).toBe('mirror');
  s = run(s, { type: 'app', id: 'ambience' });
  expect(s.windows).toHaveLength(3);
  expect(focused(s)?.id).toBe('ambience');
  s = run(s, { type: 'focus', id: 'resident' });
  expect(focused(s)?.id).toBe('resident');
  // Focusing what is in front already changes nothing (no redraw for it).
  expect(run(s, { type: 'focus', id: 'resident' })).toBe(s);
  s = run(s, { type: 'closeApp', id: 'resident' });
  expect(s.windows.map((w) => w.id).sort()).toEqual(['ambience', 'mirror']);
});

test('a window can be dragged anywhere but never out of reach: its whole frame stays between the bar and the dock', () => {
  let s = run(start(), { type: 'open' });
  for (const [x, y] of [
    [-5000, -5000],
    [5000, 5000],
    [640, -3],
    [NaN, 10],
  ] as const) {
    s = run(s, { type: 'move', id: 'resident', x, y });
    const w = s.windows[0]!;
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.x + w.w).toBeLessThanOrEqual(1280);
    expect(w.y).toBeGreaterThanOrEqual(BAR_H);
    expect(w.y + w.h).toBeLessThanOrEqual(720 - DOCK_H);
  }
});

test('a smaller viewport pulls every window back inside it, at any size', () => {
  let s = run(start(), { type: 'open' }, { type: 'app', id: 'ambience' }, { type: 'app', id: 'mirror' });
  s = run(s, { type: 'move', id: 'mirror', x: 860, y: 300 });
  for (const viewport of [
    [430, 900],
    [360, 420],
    [1920, 1080],
  ] as const) {
    s = run(s, { type: 'viewport', viewport });
    for (const w of s.windows) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(viewport[0]);
      expect(w.y).toBeGreaterThanOrEqual(BAR_H);
      expect(w.w).toBeGreaterThan(100);
    }
  }
  // Back on a large viewport a window gets its full size again.
  expect(s.windows.find((w) => w.id === 'mirror')!.w).toBe(APPS.find((a) => a.id === 'mirror')!.w);
});

test('the light: closed, only the monitor shines; open, the desktop glows in its wallpaper colour', () => {
  const closed = desktopLight(start());
  expect(closed.ui).toEqual([0, 0, 0]);
  expect(Math.max(...closed.screen)).toBeGreaterThan(0.05);
  const open = run(start(), { type: 'open' });
  const moon = desktopLight(open);
  const sunset = desktopLight(
    run(open, { type: 'wallpaper', index: WALLPAPERS.findIndex((w) => w.name === '夕焼け') }),
  );
  // Moonlight is blue, the sunset is red: both the monitor and the glow follow.
  for (const part of ['screen', 'ui'] as const) {
    expect(moon[part][2]).toBeGreaterThan(moon[part][0]);
    expect(sunset[part][0]).toBeGreaterThan(sunset[part][2]);
  }
  // Brightness scales it, within its limits.
  const dim = desktopLight(run(open, { type: 'brightness', value: 0.1 }));
  expect(dim.ui[2]).toBeCloseTo(moon.ui[2] * 0.4, 5);
  expect(run(open, { type: 'wallpaper', index: 99 })).toBe(open);
});

test('mirroring: the monitor takes the real screen colour, the glow is drawn toward it', () => {
  const open = run(start(), { type: 'open' }, { type: 'mirror', on: true });
  const green = desktopLight(open, [0.02, 0.8, 0.05]);
  expect(green.screen).toEqual([0.02, 0.8, 0.05]);
  expect(green.ui[1]).toBeGreaterThan(green.ui[0]);
  expect(green.ui[1]).toBeGreaterThan(green.ui[2]);
  // Mirroring asked for but no picture yet: the desktop's own colour.
  expect(desktopLight(open).screen).toEqual(desktopLight(run(open, { type: 'mirror', on: false })).screen);
});

test('hex colours become linear light', () => {
  expect(linear('#000000')).toEqual([0, 0, 0]);
  expect(linear('#ffffff')).toEqual([1, 1, 1]);
  expect(linear('#808080')[0]).toBeCloseTo(0.2159, 3);
});

test("the places on a window's edge a hand can come to are just outside it, never under it", () => {
  const rect = { left: 200, top: 300, right: 500, bottom: 510 };
  const samples = edgeSamples(rect, 8);
  expect(samples.length).toBeGreaterThanOrEqual(7);
  for (const [x, y] of samples) {
    const inside = x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
    expect(inside).toBe(false);
    // Bottom and lower sides only: a hand does not come down onto the top.
    expect(y).toBeGreaterThan(rect.top + (rect.bottom - rect.top) * 0.4);
  }
  expect(samples.some(([, y]) => y === rect.bottom + 8)).toBe(true);
  expect(samples.some(([x]) => x === rect.left - 8)).toBe(true);
  expect(samples.some(([x]) => x === rect.right + 8)).toBe(true);
});
