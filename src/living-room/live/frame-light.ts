/**
 * The picture as light (docs/living-live.md). A frame of the video, scaled down by the browser to
 * a small grid, is read where it is: the colour of its left, its middle and its right, of its top
 * and its bottom, and of the whole, in linear light. Those go to the room's lamps: what is red on
 * the left of the picture lights the left of the room red.
 *
 * The room does not follow the picture frame for frame. It eases after it (a cut sweeps through
 * the room in a few frames), and a picture that strobes is not passed on as a strobe: the faster
 * the picture's brightness swings back and forth, the slower the room follows.
 *
 * Pure: bytes in, numbers out.
 */
export const GRID_W = 16;
export const GRID_H = 9;

export type Rgb = readonly [number, number, number];
export interface FrameLight {
  all: Rgb;
  left: Rgb;
  centre: Rgb;
  right: Rgb;
  top: Rgb;
  bottom: Rgb;
  /** How bright the whole is to the eye, 0–1. */
  level: number;
  /**
   * Where the picture's light is: the middle of what is brighter than the rest of it, −1 (left,
   * bottom) to 1 (right, top); [0, 0] for an even picture. The room's light comes from there.
   */
  focus: readonly [number, number];
}

const LIN = Float32Array.from({ length: 256 }, (_, v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
/** A cell this dark on every channel is black (a letterbox bar is made of them). */
const BLACK = 14;
export const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** `data`: GRID_W × GRID_H cells of RGBA bytes (sRGB), row by row from the top. */
export function readFrame(data: ArrayLike<number>): FrameLight {
  const dark = (x: number, y: number) => {
    const i = (y * GRID_W + x) * 4;
    return data[i]! < BLACK && data[i + 1]! < BLACK && data[i + 2]! < BLACK;
  };
  const rowDark = (y: number) => {
    for (let x = 0; x < GRID_W; x++) if (!dark(x, y)) return false;
    return true;
  };
  const colDark = (x: number) => {
    for (let y = 0; y < GRID_H; y++) if (!dark(x, y)) return false;
    return true;
  };
  // Black bars (a wide film in a 16:9 frame, an old 4:3 one) are not part of the picture: they
  // would only dim the edges' light. At most a quarter of the frame is taken for bars each way.
  let y0 = 0,
    y1 = GRID_H,
    x0 = 0,
    x1 = GRID_W;
  while (y0 < 2 && rowDark(y0)) y0++;
  while (GRID_H - y1 < 2 && rowDark(y1 - 1)) y1--;
  while (x0 < 3 && colDark(x0)) x0++;
  while (GRID_W - x1 < 3 && colDark(x1 - 1)) x1--;
  const mean = (ax: number, bx: number, ay: number, by: number): Rgb => {
    let r = 0,
      g = 0,
      b = 0;
    for (let y = ay; y < by; y++)
      for (let x = ax; x < bx; x++) {
        const i = (y * GRID_W + x) * 4;
        r += LIN[data[i]!]!;
        g += LIN[data[i + 1]!]!;
        b += LIN[data[i + 2]!]!;
      }
    const n = Math.max(1, (bx - ax) * (by - ay));
    return [r / n, g / n, b / n];
  };
  // Thirds of the picture (the middle third shares a cell with each side: light spreads).
  const w = x1 - x0,
    h = y1 - y0;
  const third = Math.max(1, Math.round(w / 3)),
    band = Math.max(1, Math.ceil(h / 3));
  const all = mean(x0, x1, y0, y1);
  // Where its light is: each cell weighs in by how much brighter it is than the whole (a stage
  // lamp, a window, a face in a dark shot: the cells that stand out), so an even picture has its
  // light in the middle and a dark one with one lamp has it at the lamp.
  const level = luminance(all);
  let weight = 0,
    fx = 0,
    fy = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * GRID_W + x) * 4;
      const over = luminance([LIN[data[i]!]!, LIN[data[i + 1]!]!, LIN[data[i + 2]!]!]) - level;
      if (over <= 0) continue;
      weight += over;
      fx += over * (((x + 0.5 - x0) / w) * 2 - 1);
      fy += over * (1 - ((y + 0.5 - y0) / h) * 2);
    }
  // (Hardly anything stands out: no place to speak of.)
  const found = weight > 0.02 * w * h * Math.max(level, 0.02);
  return {
    focus: found ? [fx / weight, fy / weight] : [0, 0],
    all,
    left: mean(x0, x0 + third, y0, y1),
    centre: mean(x0 + third, x1 - third, y0, y1),
    right: mean(x1 - third, x1, y0, y1),
    top: mean(x0, x1, y0, y0 + band),
    bottom: mean(x0, x1, y1 - band, y1),
    level,
  };
}

export interface LightState {
  light: FrameLight;
  /** How often the brightness has lately turned about (it fades in about a second). */
  flips: number;
  rising: boolean;
}

const ZERO: Rgb = [0, 0, 0];
export const DARK: FrameLight = {
  all: ZERO,
  left: ZERO,
  centre: ZERO,
  right: ZERO,
  top: ZERO,
  bottom: ZERO,
  level: 0,
  focus: [0, 0],
};
export const startLight = (): LightState => ({ light: DARK, flips: 0, rising: false });

/** Seconds for the room to come most of the way to a new picture: a cut, and the same held back
 * for a picture that flickers. */
const FOLLOW_S = 0.09;
const HELD_S = 0.9;

export function easeLight(state: LightState, target: FrameLight, dt: number): LightState {
  const d = Math.min(0.25, Math.max(0, dt));
  // A turn-about: the picture, brighter than the room a moment ago, is now clearly darker (or the
  // other way round).
  const gap = target.level - state.light.level;
  let { flips, rising } = state;
  flips *= Math.exp(-d);
  if (Math.abs(gap) > 0.2 && gap > 0 !== rising) {
    rising = gap > 0;
    flips += 1;
  }
  // More than a turn or two a second is a flicker: the room follows it slowly, and so stays near
  // its middle instead of flashing with it (the picture itself is not touched).
  const follow = Math.min(HELD_S, FOLLOW_S + 0.25 * Math.max(0, flips - 1.5));
  const k = 1 - Math.exp(-d / follow);
  const mix = (a: Rgb, b: Rgb): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const from = state.light;
  const all = mix(from.all, target.all);
  return {
    light: {
      all,
      left: mix(from.left, target.left),
      centre: mix(from.centre, target.centre),
      right: mix(from.right, target.right),
      top: mix(from.top, target.top),
      bottom: mix(from.bottom, target.bottom),
      level: luminance(all),
      // (The place moves more slowly than the colour: a lamp that wanders, not one that jumps.)
      focus: [
        from.focus[0] + (target.focus[0] - from.focus[0]) * k * 0.35,
        from.focus[1] + (target.focus[1] - from.focus[1]) * k * 0.35,
      ],
    },
    flips,
    rising,
  };
}
