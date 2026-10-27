import type { SkinFrame } from './types';

/** Text colours the engine may write when the author's art makes native text unreadable. */
export const INK = Object.freeze({ white: '#ffffff', black: '#000000' } as const);
export type Ink = (typeof INK)[keyof typeof INK];
export type Rgb = readonly [number, number, number];
/** Below this the native text colour is replaced; below the second a warning is shown. */
export const CONTRAST = Object.freeze({ minimum: 3, readable: 4.5 });

export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
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

/** Luminance of the art's centre slice (what is stretched under the text), each pixel composited
 * over the native backdrop: darkest 5%, brightest 5% and mean, so a single dark stroke on a light
 * centre still counts. An empty centre falls back to the whole image. */
export function backdropLuminance(art: ArtPixels, frame: SkinFrame, backdrop: Rgb) {
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

/** Keeps the native ink while it reaches 3:1 against both ends of the backdrop; otherwise
 * white or black, whichever reads better. Warns when neither reaches 4.5:1. */
export function decideInk(backdrop: { dark: number; light: number }, native: Rgb): InkDecision {
  const worst = (ink: number) => Math.min(contrastRatio(ink, backdrop.dark), contrastRatio(ink, backdrop.light));
  const own = worst(luminance(native)),
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
