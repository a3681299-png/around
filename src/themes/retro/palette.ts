/** Color controls change semantic UI tokens only; media is never filtered. */
export interface PaletteSettings {
  hue: number;
  saturation: number;
  brightness: number;
}

export const PALETTE_PRESETS = Object.freeze({
  silver: Object.freeze({ hue: 252, saturation: 12, brightness: 66 }),
  lavender: Object.freeze({ hue: 264, saturation: 50, brightness: 72 }),
  mint: Object.freeze({ hue: 156, saturation: 42, brightness: 70 }),
  pink: Object.freeze({ hue: 334, saturation: 46, brightness: 76 }),
} satisfies Record<string, PaletteSettings>);

export const DEFAULT_PALETTE: Readonly<PaletteSettings> = PALETTE_PRESETS.silver;
export const PALETTE_CHANNELS = ['hue', 'saturation', 'brightness'] as const;
export type PaletteChannel = (typeof PALETTE_CHANNELS)[number];

export function normalizePaletteChannel(channel: PaletteChannel, value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(channel === 'hue' ? 360 : 100, Math.max(0, value)))
    : DEFAULT_PALETTE[channel];
}

export function normalizePalette(value: Partial<PaletteSettings> = {}): PaletteSettings {
  return Object.fromEntries(
    PALETTE_CHANNELS.map((channel) => [channel, normalizePaletteChannel(channel, value[channel])]),
  ) as unknown as PaletteSettings;
}

function hsl(hue: number, saturation: number, lightness: number): string {
  const h = (hue % 360) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = lightness - c / 2;
  const rgb =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return `#${rgb
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** WCAG sRGB contrast for the opaque colors emitted below. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Slider extremes stay within a pale desktop range, with independently checked text. */
export function createPalette(input: PaletteSettings): Readonly<Record<string, string>> {
  const { hue, saturation, brightness } = normalizePalette(input);
  const s = saturation / 100;
  const b = brightness / 100;
  const color = (sat: number, lightness: number) => hsl(hue, sat, lightness);
  const panel = color(s * 0.28, 0.82 + b * 0.1);
  const page = color(s * 0.25, 0.8 + b * 0.13);
  const paper = color(s * 0.16, 0.94 + b * 0.045);
  const glassTop = color(s * 0.35, 0.96 + b * 0.02);
  const glassMid = color(s * 0.36, 0.83 + b * 0.08);
  const glassBottom = color(s * 0.32, 0.74 + b * 0.08);
  const accentSoft = color(s * 0.32, 0.88 + b * 0.055);
  const surfaces = [page, panel, paper, glassTop, glassMid, glassBottom, accentSoft];
  const readable = (sat: number, initial: number, backgrounds = surfaces) => {
    let lightness = initial;
    while (lightness > 0 && backgrounds.some((background) => contrastRatio(color(sat, lightness), background) < 4.7)) {
      lightness = Math.max(0, lightness - 0.01);
    }
    return color(sat, lightness);
  };
  const ink = readable(0.08 + s * 0.12, 0.17);
  const muted = readable(0.04 + s * 0.1, 0.34);
  const accent = readable(0.12 + s * 0.42, 0.34);
  const titleTop = readable(0.06 + s * 0.32, 0.36, ['#ffffff']);
  const titleMid = readable(0.08 + s * 0.34, 0.29, ['#ffffff']);
  const titleBottom = readable(0.1 + s * 0.32, 0.2, ['#ffffff']);
  const titleInk = '#ffffff';
  const inactive = readable(s * 0.1, 0.39, ['#ffffff']);
  const selection = readable(0.1 + s * 0.32, 0.28, ['#ffffff']);
  const pane = `linear-gradient(180deg, ${glassTop} 0%, ${glassMid} 49%, ${glassBottom} 50%, ${panel} 100%)`;
  return Object.freeze({
    '--ww-retro-page': page,
    '--ww-retro-panel': panel,
    '--ww-retro-paper': paper,
    '--ww-retro-ink': ink,
    '--ww-retro-muted': muted,
    '--ww-retro-border': color(s * 0.16, 0.58 + b * 0.07),
    '--ww-retro-light': '#ffffff',
    '--ww-retro-dark': color(s * 0.16, 0.43 + b * 0.06),
    '--ww-retro-accent': accent,
    '--ww-retro-accent-soft': accentSoft,
    '--ww-retro-glass-top': glassTop,
    '--ww-retro-glass-mid': glassMid,
    '--ww-retro-glass-bottom': glassBottom,
    '--ww-retro-selected-ink': readable(0.13 + s * 0.26, 0.24),
    '--ww-selection': selection,
    '--ww-selection-ink': titleInk,
    '--ww-lcd': '#202723',
    '--ww-lcd-ink': '#d5e7d1',
    '--ww-lcd-muted': '#c0d0bc',
    '--ww-lcd-line': '#69776c',
    '--ww-led': color(0.16 + s * 0.3, 0.8),
    '--ww-titlebar': `linear-gradient(180deg, ${titleTop} 0%, ${titleMid} 49%, ${titleBottom} 50%, ${titleMid} 100%)`,
    '--ww-titlebar-flat': titleMid,
    '--ww-titlebar-ink': titleInk,
    '--ww-titlebar-inactive': inactive,
    '--ww-titlebar-inactive-ink': titleInk,
    '--ww-pane-titlebar': pane,
    // Optional actual-focus treatment intentionally stays blue across presets.
    '--ww-pane-titlebar-active': 'linear-gradient(180deg, #547494 0%, #354f72 49%, #233a5c 50%, #304c70 100%)',
    '--ww-pane-titlebar-active-flat': '#354f72',
    '--ww-pane-titlebar-active-ink': '#ffffff',
    '--ww-pane-titlebar-flat': panel,
    '--ww-pane-titlebar-inactive': panel,
    '--ww-pane-titlebar-inactive-ink': ink,
    '--ww-link': readable(0.25 + s * 0.32, 0.3),
    '--ww-error': '#721d2f',
  });
}

export const PALETTE_VARIABLES = Object.freeze(Object.keys(createPalette(DEFAULT_PALETTE)));
