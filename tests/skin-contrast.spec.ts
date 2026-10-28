import { test, expect } from '@playwright/test';
import {
  backdropLuminance,
  contrastRatio,
  decideInk,
  decideInkAcross,
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

test('parts of one kind with different backdrops and colours share one colour that works for all', () => {
  // Chips: the selected one is white on black, the others dark on grey. Light art over both.
  const art96 = art(solid([245, 245, 245, 200].slice(0, 3) as unknown as Rgb, 200));
  const selected = { backdrop: backdropLuminance(art96, frame, [15, 15, 15]), natives: [WHITE] as Rgb[] };
  const plain = { backdrop: backdropLuminance(art96, frame, [242, 242, 242]), natives: [BLACK] as Rgb[] };
  // Judged on the plain chip alone, nothing would change; across both, black is chosen.
  expect(decideInkAcross([plain]).ink).toBeUndefined();
  const both = decideInkAcross([plain, selected]);
  expect(both.ink).toBe(INK.black);
  expect(both.contrast).toBeGreaterThanOrEqual(3);
  // A single case is the same as decideInk.
  expect(decideInkAcross([selected])).toStrictEqual(decideInk(selected.backdrop, WHITE));
});

test('the table-based backdrop luminance equals the straightforward formulation on random art', () => {
  // The formulation UI1.1 shipped: every pixel blended and converted with pow(), then sorted.
  const reference = (art: ArtPixels, frame: SkinFrame, backdrop: Rgb) => {
    const sx = art.sampleWidth / art.width,
      sy = art.sampleHeight / art.height;
    let x0 = Math.floor(frame.slices.left * sx),
      x1 = Math.ceil(art.sampleWidth - frame.slices.right * sx),
      y0 = Math.floor(frame.slices.top * sy),
      y1 = Math.ceil(art.sampleHeight - frame.slices.bottom * sy);
    if (x1 - x0 < 1 || y1 - y0 < 1) [x0, x1, y0, y1] = [0, art.sampleWidth, 0, art.sampleHeight];
    const values: number[] = [];
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * art.sampleWidth + x) * 4,
          alpha = art.data[i + 3]! / 255;
        values.push(
          luminance([
            art.data[i]! * alpha + backdrop[0] * (1 - alpha),
            art.data[i + 1]! * alpha + backdrop[1] * (1 - alpha),
            art.data[i + 2]! * alpha + backdrop[2] * (1 - alpha),
          ]),
        );
      }
    values.sort((a, b) => a - b);
    const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))]!;
    return { dark: at(0.05), light: at(0.95), mean: values.reduce((a, b) => a + b, 0) / values.length };
  };
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 40; round++) {
    const size = 8 + Math.floor(random() * 90);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const kind = random();
      // A mix of opaque, fully transparent and translucent pixels.
      const alpha = kind < 0.4 ? 255 : kind < 0.7 ? 0 : Math.floor(random() * 256);
      data.set([random() * 256, random() * 256, random() * 256, alpha], i * 4);
    }
    const pixels: ArtPixels = { width: size * 2, height: size * 2, sampleWidth: size, sampleHeight: size, data };
    const slices = { top: Math.floor(random() * size), right: Math.floor(random() * size), bottom: 3, left: 2 };
    const backdrop: Rgb = [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)];
    const a = backdropLuminance(pixels, { ...frame, slices }, backdrop),
      b = reference(pixels, { ...frame, slices }, backdrop);
    expect(a.dark).toBeCloseTo(b.dark, 12);
    expect(a.light).toBeCloseTo(b.light, 12);
    expect(a.mean).toBeCloseTo(b.mean, 12);
  }
});

test('an empty centre slice falls back to the whole image', () => {
  const tight = { ...frame, slices: { top: 48, right: 48, bottom: 48, left: 48 } };
  const result = backdropLuminance(art(solid([0, 0, 0])), tight, WHITE);
  // The whole image holds both the black centre and the red band; the centre alone has no red.
  expect(result.dark).toBeCloseTo(luminance([0, 0, 0]), 5);
  expect(result.light).toBeCloseTo(luminance([224, 48, 48]), 5);
});
