import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PALETTE, PALETTE_PRESETS, createPalette, contrastRatio, normalizePalette,
} from '../src/themes/retro/palette';

const colorsIn = (value: string): string[] => value.match(/#[0-9a-f]{6}/g) ?? [];

test('all presets and slider extremes preserve readable foregrounds and titles', () => {
  const inputs = [
    ...Object.values(PALETTE_PRESETS),
    ...Array.from({ length: 37 }, (_, index) => index * 10).flatMap((hue) =>
      [0, 25, 50, 75, 100].flatMap((saturation) => [0, 25, 50, 75, 100].map((brightness) => ({ hue, saturation, brightness })))),
  ];
  let minimum = Infinity;
  const failures: string[] = [];
  for (const input of inputs) {
    const palette = createPalette(input);
    const surfaces = [
      '--ww-retro-page', '--ww-retro-panel', '--ww-retro-paper', '--ww-retro-accent-soft',
      '--ww-retro-glass-top', '--ww-retro-glass-mid', '--ww-retro-glass-bottom',
      '--ww-pane-titlebar', '--ww-pane-titlebar-flat', '--ww-pane-titlebar-inactive',
    ].flatMap((name) => colorsIn(palette[name]!));
    for (const name of ['--ww-retro-ink', '--ww-retro-muted', '--ww-retro-selected-ink', '--ww-link', '--ww-error']) {
      for (const background of surfaces) {
        const ratio = contrastRatio(palette[name]!, background);
        minimum = Math.min(minimum, ratio);
        if (ratio < 4.5) failures.push(`${JSON.stringify(input)}: ${name} on ${background}: ${ratio}`);
      }
    }
    for (const name of ['--ww-titlebar', '--ww-titlebar-flat', '--ww-titlebar-inactive', '--ww-selection', '--ww-pane-titlebar-active', '--ww-pane-titlebar-active-flat']) {
      for (const background of colorsIn(palette[name]!)) {
        const ratio = contrastRatio(palette['--ww-titlebar-ink']!, background);
        minimum = Math.min(minimum, ratio);
        if (ratio < 4.5) failures.push(`${JSON.stringify(input)}: white title on ${background}: ${ratio}`);
      }
    }
    for (const name of ['--ww-lcd-ink', '--ww-lcd-muted']) {
      const ratio = contrastRatio(palette[name]!, palette['--ww-lcd']!);
      if (ratio < 7) failures.push(`${name} LCD contrast: ${ratio}`);
    }
  }
  expect(failures).toEqual([]);
  expect(minimum).toBeGreaterThanOrEqual(4.5);
});

test('channels normalize predictably and no setting produces invalid color values', () => {
  expect(normalizePalette({ hue: 999, saturation: -1, brightness: 12.6 })).toEqual({ hue: 360, saturation: 0, brightness: 13 });
  expect(normalizePalette({ hue: NaN, saturation: Infinity, brightness: -Infinity })).toEqual(DEFAULT_PALETTE);
  expect(createPalette({ hue: 360, saturation: 100, brightness: 0 })).toEqual(createPalette({ hue: 0, saturation: 100, brightness: 0 }));
  expect(Object.values(createPalette({ hue: NaN, saturation: NaN, brightness: NaN })).join('')).not.toMatch(/NaN|Infinity/);
});

test('CSS defaults exactly match the silver preset, including safe titlebar gradients', () => {
  const tokens = readFileSync(new URL('../src/themes/retro/tokens.css', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries(createPalette(DEFAULT_PALETTE))) {
    expect(tokens).toContain(`${name}: ${value};`);
  }
  expect(DEFAULT_PALETTE.saturation).toBeLessThanOrEqual(15);
});


test('optional active pane treatment stays blue independently of the selected palette', () => {
  const reference = createPalette(DEFAULT_PALETTE);
  for (const preset of Object.values(PALETTE_PRESETS)) {
    const palette = createPalette(preset);
    for (const name of ['--ww-pane-titlebar-active', '--ww-pane-titlebar-active-flat', '--ww-pane-titlebar-active-ink']) {
      expect(palette[name]).toBe(reference[name]);
    }
    expect(palette['--ww-pane-titlebar-active-ink']).toBe('#ffffff');
    for (const background of colorsIn(palette['--ww-pane-titlebar-active']!)) {
      expect(contrastRatio(palette['--ww-pane-titlebar-active-ink']!, background)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
