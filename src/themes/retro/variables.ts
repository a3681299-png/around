import type { UserSettings } from '../../storage/settings';
import { createPalette } from './palette';

/** Built-in theme settings belong to this theme, not the creator renderer. */
export function retroVariables(settings: UserSettings): Readonly<Record<string, string>> {
  return {
    ...(settings.features['palette'] ? createPalette(settings.palette) : {}),
    ...(settings.features['surface-noise'] ? { '--ww-noise-strength': String(settings.noiseStrength / 100) } : {}),
  };
}
