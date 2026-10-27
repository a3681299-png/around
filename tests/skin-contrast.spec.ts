import { test, expect } from '@playwright/test';
import {
  backdropLuminance,
  contrastRatio,
  decideInk,
  INK,
  luminance,
  parseRgb,
  type ArtPixels,
  type Rgb,
} from '../src/design/contrast';
import type { SkinFrame } from '../src/design/types';

const frame: SkinFrame = {
  assetId: `asset-${'a'.repeat(64)}`,
  slices: { top: 24, right: 24, bottom: 24, left: 24 },
  center: 'stretch',
  scalePct: 25,
};
/** A 96×96 frame like tests/fixtures/skins: red border band, the given centre. */
function art(centre: (x: number, y: number) => [number, number, number, number]): ArtPixels {
  const data = new Uint8ClampedArray(96 * 96 * 4);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++) {
      const inside = x >= 24 && x < 72 && y >= 24 && y < 72;
      data.set(inside ? centre(x, y) : [224, 48, 48, 255], (y * 96 + x) * 4);
    }
  return { width: 96, height: 96, sampleWidth: 96, sampleHeight: 96, data };
}
const solid =
  (rgb: Rgb, alpha = 255) =>
  () =>
    [...rgb, alpha] as [number, number, number, number];
const WHITE: Rgb = [241, 241, 241],
  BLACK: Rgb = [15, 15, 15];

test('the luminance and ratio follow WCAG', () => {
  expect(contrastRatio(luminance([255, 255, 255]), luminance([0, 0, 0]))).toBeCloseTo(21, 5);
  expect(contrastRatio(luminance([119, 119, 119]), 1)).toBeCloseTo(4.48, 2);
  expect(parseRgb('rgba(0, 0, 0, 0.05)')).toStrictEqual({ rgb: [0, 0, 0], alpha: 0.05 });
  expect(parseRgb('rgb(15, 15, 15)')).toStrictEqual({ rgb: [15, 15, 15], alpha: 1 });
  expect(parseRgb('color(srgb 1 0 0)')).toBeUndefined();
});

test('white native text on a light centre becomes black; dark text on a dark centre becomes white', () => {
  const light = backdropLuminance(art(solid([245, 245, 245])), frame, BLACK);
  // The subscribe button: native white text on #0f0f0f, art centre #f5f5f5 → 1.05:1.
  const subscribe = decideInk(light, WHITE);
  expect(subscribe.ink).toBe(INK.black);
  expect(subscribe.contrast).toBeGreaterThan(15);
  expect(subscribe.warn).toBe(false);
  const dark = backdropLuminance(art(solid([17, 17, 17])), frame, WHITE);
  const like = decideInk(dark, BLACK);
  expect(like.ink).toBe(INK.white);
  expect(like.warn).toBe(false);
});

test('transparent art shows the native background, so native text stays', () => {
  // Transparent centre over the native black button: white text keeps 17:1.
  const clear = backdropLuminance(art(solid([0, 0, 0], 0)), frame, BLACK);
  const decision = decideInk(clear, WHITE);
  expect(decision.ink).toBeUndefined();
  expect(decision.warn).toBe(false);
  // Only the centre slice counts: the red border band does not change the result.
  expect(clear.light).toBeCloseTo(luminance(BLACK), 5);
});

test('the darkest and brightest ends count, not only the mean', () => {
  // Half white, half black stripes: the mean is mid grey, but text crosses both.
  const stripes = backdropLuminance(
    art((x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
    frame,
    WHITE,
  );
  const decision = decideInk(stripes, BLACK);
  expect(decision.ink).toBeDefined();
  expect(decision.best).toBeLessThan(1.1);
  expect(decision.warn).toBe(true);
  // A single thin dark line on a light centre still sets the dark end.
  const line = backdropLuminance(
    art((x) => (x === 40 || x === 41 || x === 42 ? [0, 0, 0, 255] : [250, 250, 250, 255])),
    frame,
    BLACK,
  );
  expect(line.dark).toBeLessThan(0.01);
  expect(decideInk(line, WHITE).warn).toBe(true);
});

test('mid tones: switch below 3:1, warn only when neither white nor black reaches 4.5:1', () => {
  // #767676 is the classic 4.5:1 grey against white; black reaches 4.7:1 → black, no warning.
  const grey = backdropLuminance(art(solid([118, 118, 118])), frame, WHITE);
  const decision = decideInk(grey, [200, 200, 200]);
  expect(decision.ink).toBe(INK.black);
  expect(decision.warn).toBe(false);
  // Native ink at 3.x:1 is kept (the engine's minimum is 3:1).
  const kept = decideInk(backdropLuminance(art(solid([255, 255, 255])), frame, WHITE), [130, 130, 130]);
  expect(kept.ink).toBeUndefined();
  expect(kept.contrast).toBeGreaterThanOrEqual(3);
  expect(kept.warn).toBe(false);
});

test('a part whose text uses several colours is judged by the least readable one', () => {
  // A dark-mode card on light art: the card element is black, but its title is white.
  const light = backdropLuminance(art(solid([245, 245, 245])), frame, BLACK);
  const decision = decideInk(light, [[0, 0, 0], WHITE, [170, 170, 170]]);
  expect(decision.ink).toBe(INK.black);
  // All dark: nothing to change.
  expect(decideInk(light, [[0, 0, 0], BLACK]).ink).toBeUndefined();
  // A single colour still works as before.
  expect(decideInk(light, WHITE).ink).toBe(INK.black);
});

test('an empty centre slice falls back to the whole image', () => {
  const tight = { ...frame, slices: { top: 48, right: 48, bottom: 48, left: 48 } };
  const result = backdropLuminance(art(solid([0, 0, 0])), tight, WHITE);
  // The whole image holds both the black centre and the red band; the centre alone has no red.
  expect(result.dark).toBeCloseTo(luminance([0, 0, 0]), 5);
  expect(result.light).toBeCloseTo(luminance([224, 48, 48]), 5);
});
