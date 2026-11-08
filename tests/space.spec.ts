import { test, expect } from '@playwright/test';
import {
  CAMERA_REST,
  PLATE_LIMIT,
  PLATE_PAD_PX,
  PLATE_TEXT,
  READABLE_CONTRAST,
  ROOM_CAMERA_RANGE,
  VIDEO_LIGHT_SLEW,
  cameraSettled,
  cameraTarget,
  contrast,
  glassPlates,
  luminance,
  plateAlpha,
  plateLimit,
  projectCamera,
  stepCamera,
  stepVideoLight,
  videoLightLuminance,
  type UiRegion,
} from '../src/world/space';

const full = { sway: 1, dolly: 1, follow: 0.6 };

test.describe('space: the camera', () => {
  test('the pointer and the scroll never move the camera past the measured room range', () => {
    for (const x of [-5, -1, 0, 1, 5])
      for (const y of [-5, -1, 0, 1, 5])
        for (const scroll of [-1, 0, 0.5, 1, 9, Number.NaN]) {
          const t = cameraTarget(full, { pointer: { x, y }, scroll, reducedMotion: false });
          expect(Math.abs(t.x)).toBeLessThanOrEqual(ROOM_CAMERA_RANGE.x + 1e-9);
          expect(Math.abs(t.y)).toBeLessThanOrEqual(ROOM_CAMERA_RANGE.y + 1e-9);
          expect(t.dolly).toBeGreaterThanOrEqual(0);
          expect(t.dolly).toBeLessThanOrEqual(ROOM_CAMERA_RANGE.dolly + 1e-9);
        }
    // Artwork values past 1 are clamped too.
    const t = cameraTarget(
      { sway: 9, dolly: 9, follow: 1 },
      { pointer: { x: 1, y: 1 }, scroll: 1, reducedMotion: false },
    );
    expect(t.x).toBeCloseTo(ROOM_CAMERA_RANGE.x);
    expect(t.dolly).toBeCloseTo(ROOM_CAMERA_RANGE.dolly);
  });

  test('the pointer to the right moves the camera right; the scroll dollies it back', () => {
    const right = cameraTarget(full, { pointer: { x: 1, y: 0 }, scroll: 0, reducedMotion: false });
    expect(right.x).toBeGreaterThan(0);
    expect(right.dolly).toBe(0);
    const down = cameraTarget(full, { scroll: 1, reducedMotion: false });
    expect(down.dolly).toBeCloseTo(ROOM_CAMERA_RANGE.dolly);
    expect(down.x).toBe(0);
    // Without the pointer, the camera returns to the middle.
    expect(cameraTarget(full, { scroll: 0, reducedMotion: false })).toEqual({ x: 0, y: -0, dolly: 0 });
  });

  test('reduced motion weakens every movement to a quarter', () => {
    const input = { pointer: { x: 1, y: -1 }, scroll: 1 };
    const normal = cameraTarget(full, { ...input, reducedMotion: false }),
      reduced = cameraTarget(full, { ...input, reducedMotion: true });
    expect(reduced.x).toBeCloseTo(normal.x / 4);
    expect(reduced.y).toBeCloseTo(normal.y / 4);
    expect(reduced.dolly).toBeCloseTo(normal.dolly / 4);
  });

  test('following is the same at 60 and 144 frames a second and reaches 95% after `follow`', () => {
    const target = { x: 0.2, y: -0.1, dolly: 1 };
    const run = (fps: number) => {
      let s = CAMERA_REST;
      // 0.5 s is a whole number of frames at both rates.
      for (let i = 0; i < 0.5 * fps; i++) s = stepCamera(s, target, 1 / fps, 0.5);
      return s;
    };
    const a = run(60),
      b = run(144);
    expect(a.dolly).toBeCloseTo(b.dolly, 3);
    expect(a.dolly).toBeCloseTo(0.95, 2);
    let s = CAMERA_REST;
    for (let i = 0; i < 600; i++) s = stepCamera(s, target, 1 / 60, 0.6);
    expect(cameraSettled(s, target)).toBe(true);
    // A long pause between frames (a hidden tab coming back) does not jump past the target.
    const jump = stepCamera(CAMERA_REST, target, 30, 0.6);
    expect(jump.dolly).toBeLessThanOrEqual(1);
  });

  test('the dolly zoom keeps the subject plane the same size on screen', () => {
    const base = { fovDeg: 45.75, subject: 3.2 };
    const size = (fov: number, distance: number) => 2 * distance * Math.tan(((fov / 2) * Math.PI) / 180);
    for (const dolly of [0, 0.5, 1.5]) {
      const p = projectCamera(base, { x: 0, y: 0, dolly });
      expect(p.offset.z).toBe(dolly);
      expect(size(p.fovDeg, base.subject + dolly)).toBeCloseTo(size(base.fovDeg, base.subject), 6);
    }
    expect(projectCamera(base, CAMERA_REST).fovDeg).toBeCloseTo(base.fovDeg, 9);
  });
});

test.describe('space: glass plates', () => {
  const viewport = { width: 1600, height: 900 };
  const region = (importance: UiRegion['importance'], left = 0, top = 0, width = 100, height = 100): UiRegion => ({
    left,
    top,
    width,
    height,
    importance,
  });

  test('free regions get no plate; the others are padded and kept to the viewport', () => {
    const plates = glassPlates(
      [region('free'), region('read', 1144, 56, 456, 3336), region('operate', 16, 68, 1112, 626)],
      viewport,
    );
    expect(plates.map((p) => p.importance)).toEqual(['operate', 'read']);
    expect(plates[0]).toMatchObject({
      left: 16 - PLATE_PAD_PX,
      top: 68 - PLATE_PAD_PX,
      right: 1128 + PLATE_PAD_PX,
      bottom: 694 + PLATE_PAD_PX,
    });
    expect(plates[1]!.bottom).toBe(viewport.height + PLATE_PAD_PX);
    expect(plates[1]!.right).toBe(viewport.width + PLATE_PAD_PX);
  });

  test('regions out of view, empty or broken get no plate, and there are at most PLATE_LIMIT', () => {
    expect(
      glassPlates(
        [
          region('read', 0, 2000),
          region('read', 0, 0, 0, 10),
          region('read', Number.NaN, 0, Number.NaN, 5),
          region('read', -500, 0, 100, 100),
        ],
        viewport,
      ),
    ).toEqual([]);
    const many = Array.from({ length: PLATE_LIMIT + 5 }, (_, i) => region('read', i * 10, 0));
    expect(glassPlates(many, viewport)).toHaveLength(PLATE_LIMIT);
  });

  test('a fallback plate (a column with text the adapter did not recognise) is never dropped by the limit', () => {
    const many = Array.from({ length: PLATE_LIMIT + 5 }, (_, i) => region(i % 2 ? 'operate' : 'read', i * 10, 0));
    const column: UiRegion = { ...region('read', 1144, 56, 456, 800), fallback: true };
    const plates = glassPlates([...many, column], viewport);
    expect(plates).toHaveLength(PLATE_LIMIT);
    expect(plates[0]).toMatchObject({ left: 1144 - PLATE_PAD_PX, importance: 'read', fallback: true });
    expect(plates.slice(1).every((p) => !p.fallback)).toBe(true);
  });
});

test.describe('space: readability', () => {
  test('the luminances of the protected text colours', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 9);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(PLATE_TEXT.dark.text).toBeCloseTo(0.402, 3);
    // On YouTube's own background, the protected text already reads at more than 4.5:1.
    expect(contrast(PLATE_TEXT.dark.text, PLATE_TEXT.dark.base)).toBeGreaterThan(READABLE_CONTRAST);
    expect(contrast(PLATE_TEXT.light.text, PLATE_TEXT.light.base)).toBeGreaterThan(READABLE_CONTRAST);
  });

  for (const scheme of ['dark', 'light'] as const)
    test(`${scheme}: over any room the plate keeps the text at 4.5:1, and white text too`, () => {
      const { text, base } = PLATE_TEXT[scheme];
      for (let i = 0; i <= 100; i++) {
        const room = i / 100;
        const a = plateAlpha(room, scheme, 0);
        const behind = a * base + (1 - a) * room;
        expect(contrast(text, behind)).toBeGreaterThanOrEqual(READABLE_CONTRAST - 1e-9);
        if (scheme === 'dark') expect(contrast(1, behind)).toBeGreaterThanOrEqual(READABLE_CONTRAST);
      }
    });

  test('a dark room needs only the floor; a white room needs nearly the whole plate', () => {
    expect(plateAlpha(0.01, 'dark', 0.15)).toBe(0.15);
    expect(plateAlpha(plateLimit('dark'), 'dark', 0)).toBe(0);
    expect(plateAlpha(1, 'dark', 0)).toBeGreaterThan(0.95);
    // The design's example: a room whose brightest place is a middle grey (0.2) and white text
    // needs about a tenth of the plate; the grey secondary text held to 4.5:1 needs more.
    const whiteOnly = (0.2 - (1.05 / 4.5 - 0.05)) / (0.2 - PLATE_TEXT.dark.base);
    expect(whiteOnly).toBeGreaterThan(0.05);
    expect(whiteOnly).toBeLessThan(0.15);
    expect(plateAlpha(0.2, 'dark', 0)).toBeGreaterThan(whiteOnly);
    expect(plateAlpha(0, 'light', 0)).toBeGreaterThan(0.6);
  });
});

test.describe('space: the video light', () => {
  test('the light never changes faster than the slew limit, so it cannot flash 3 times a second', () => {
    let light = { r: 0, g: 0, b: 0 },
      last = 0;
    // A strobe at 10 Hz between black and white, sampled at 60 frames a second for 2 seconds.
    for (let frame = 0; frame < 120; frame++) {
      const white = Math.floor(frame / 3) % 2 === 0;
      light = stepVideoLight(light, white ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 }, 1 / 60, false);
      const now = videoLightLuminance(light);
      expect(Math.abs(now - last)).toBeLessThanOrEqual(VIDEO_LIGHT_SLEW / 60 + 1e-9);
      last = now;
    }
    // A frame-by-frame strobe never builds a swing of a tenth (the general flash threshold).
    light = { r: 0, g: 0, b: 0 };
    for (let frame = 0; frame < 60; frame++) {
      light = stepVideoLight(light, frame % 2 ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 }, 1 / 60, false);
      expect(videoLightLuminance(light)).toBeLessThan(0.1);
    }
  });

  test('an unreadable sample fades the light out; reduced motion follows slower', () => {
    let light = { r: 0.5, g: 0.5, b: 0.5 };
    light = stepVideoLight(light, undefined, 0.2, false);
    expect(light.r).toBeCloseTo(0.4);
    const reduced = stepVideoLight({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0.2, true);
    expect(reduced.g).toBeCloseTo(0.025);
  });
});
