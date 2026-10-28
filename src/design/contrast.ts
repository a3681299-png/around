import type { SkinFrame } from './types';

/** Text colours the engine may write when the author's art makes native text unreadable. */
export const INK = Object.freeze({ white: '#ffffff', black: '#000000' } as const);
export type Ink = (typeof INK)[keyof typeof INK];
export type Rgb = readonly [number, number, number];
/** Below this the native text colour is replaced; below the second a warning is shown. */
export const CONTRAST = Object.freeze({ minimum: 3, readable: 4.5 });

const linear = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** sRGB → linear light for the 256 integer levels; art pixels are integers. */
const LEVELS = Float64Array.from({ length: 256 }, (_, level) => linear(level));
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Downscaled RGBA pixels of one asset; enough to judge what lies under the text. */
export interface ArtPixels {
  /** Natural size of the original image, in the units of the frame's slices. */
  width: number;
  height: number;
  /** Sampled copy (at most a few thousand pixels). */
  sampleWidth: number;
  sampleHeight: number;
  data: Uint8ClampedArray;
}

// One reusable buffer for the sorted luminances: no allocation per call.
let scratch = new Float64Array(96 * 96);

/** Luminance of the art's centre slice (what is stretched under the text), each pixel composited
 * over the native backdrop: darkest 5%, brightest 5% and mean, so a single dark stroke on a light
 * centre still counts. An empty centre falls back to the whole image. Opaque pixels and fully
 * transparent ones (the backdrop alone) take table lookups; only translucent ones are blended. */
export function backdropLuminance(art: ArtPixels, frame: SkinFrame, backdrop: Rgb) {
  const sx = art.sampleWidth / art.width,
    sy = art.sampleHeight / art.height;
  let x0 = Math.floor(frame.slices.left * sx),
    x1 = Math.ceil(art.sampleWidth - frame.slices.right * sx),
    y0 = Math.floor(frame.slices.top * sy),
    y1 = Math.ceil(art.sampleHeight - frame.slices.bottom * sy);
  if (x1 - x0 < 1 || y1 - y0 < 1) [x0, x1, y0, y1] = [0, art.sampleWidth, 0, art.sampleHeight];
  const count = (x1 - x0) * (y1 - y0);
  if (scratch.length < count) scratch = new Float64Array(count);
  const values = scratch.subarray(0, count),
    data = art.data,
    behind = luminance(backdrop);
  let at = 0,
    sum = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * art.sampleWidth + x) * 4,
        a = data[i + 3]!;
      let value: number;
      if (a === 255)
        value = 0.2126 * LEVELS[data[i]!]! + 0.7152 * LEVELS[data[i + 1]!]! + 0.0722 * LEVELS[data[i + 2]!]!;
      else if (a === 0) value = behind;
      else {
        const alpha = a / 255;
        value = luminance([
          data[i]! * alpha + backdrop[0] * (1 - alpha),
          data[i + 1]! * alpha + backdrop[1] * (1 - alpha),
          data[i + 2]! * alpha + backdrop[2] * (1 - alpha),
        ]);
      }
      values[at++] = value;
      sum += value;
    }
  values.sort();
  const pick = (q: number) => values[Math.min(count - 1, Math.floor(q * count))]!;
  return { dark: pick(0.05), light: pick(0.95), mean: sum / count };
}

export interface InkDecision {
  /** Undefined keeps the native colour. */
  ink?: Ink;
  /** Worst contrast of the colour that will be shown, over the dark and light ends. */
  contrast: number;
  /** Best that white or black could reach; below 4.5 the editor warns. */
  best: number;
  warn: boolean;
}

/** Keeps the native ink while every native text colour of the part reaches 3:1 against both ends
 * of the backdrop; otherwise white or black, whichever reads better. Warns when neither reaches
 * 4.5:1. A part's children often set their own colours, so all of them are judged. */
export function decideInk(backdrop: { dark: number; light: number }, native: Rgb | readonly Rgb[]): InkDecision {
  const natives = (typeof native[0] === 'number' ? [native] : native) as readonly Rgb[];
  return decideInkAcross([{ backdrop, natives }]);
}

/** One colour for every part of a kind (CSS is per kind): each visible part is judged against its
 * own backdrop, and the least readable case decides. */
export function decideInkAcross(
  cases: readonly { backdrop: { dark: number; light: number }; natives: readonly Rgb[] }[],
): InkDecision {
  const worst = (ink: number) =>
    Math.min(
      ...cases.map(({ backdrop }) => Math.min(contrastRatio(ink, backdrop.dark), contrastRatio(ink, backdrop.light))),
    );
  const own = Math.min(
      ...cases.flatMap(({ backdrop, natives }) =>
        natives.map((colour) =>
          Math.min(contrastRatio(luminance(colour), backdrop.dark), contrastRatio(luminance(colour), backdrop.light)),
        ),
      ),
    ),
    white = worst(1),
    black = worst(0);
  const best = Math.max(white, black);
  if (own >= CONTRAST.minimum)
    return { contrast: own, best, warn: own < CONTRAST.readable && best < CONTRAST.readable };
  const ink = white >= black ? INK.white : INK.black;
  return { ink, contrast: best, best, warn: best < CONTRAST.readable };
}

/** A validated `#rrggbb` from the schema. */
export const hexRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Parses the computed `rgb()`/`rgba()` the browser reports; anything else is unknown. */
export function parseRgb(value: string): { rgb: Rgb; alpha: number } | undefined {
  const match = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d*(?:\.\d+)?))?\)$/.exec(value);
  if (!match) return;
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}
