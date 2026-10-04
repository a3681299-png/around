import { FEATURE_REGISTRY, defaultFeaturePreferences, featureEnabled } from '../features';
import type { FeaturePreferences } from '../features';
import { DEFAULT_PALETTE, PALETTE_CHANNELS, normalizePaletteChannel, type PaletteSettings } from '../themes/retro/palette';

export interface UserSettings {
  enabled: boolean;
  strength: number;
  features: FeaturePreferences;
  palette: PaletteSettings;
  noiseStrength: number;
}

/** A feature patch is merged, never used to replace another feature's preferences. */
export type SettingsPatch = Partial<Omit<UserSettings, 'palette'>> & { palette?: Partial<PaletteSettings> };

export const DEFAULT_SETTINGS: Readonly<UserSettings> = Object.freeze({
  enabled: false,
  strength: 60,
  palette: DEFAULT_PALETTE,
  noiseStrength: 22,
  features: Object.freeze(defaultFeaturePreferences()),
});

// Keep the original global keys: existing installations require no destructive migration.
export const SETTINGS_KEYS = {
  enabled: 'webWorldThemes.enabled',
  strength: 'webWorldThemes.strength',
  noiseStrength: 'webWorldThemes.noiseStrength',
} as const;

export const PALETTE_SETTINGS_KEYS = Object.freeze({
  hue: 'webWorldThemes.palette.hue',
  saturation: 'webWorldThemes.palette.saturation',
  brightness: 'webWorldThemes.palette.brightness',
});

export const FEATURE_SETTINGS_KEYS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(FEATURE_REGISTRY.map((feature) => [feature.id, `webWorldThemes.features.${feature.id}`])),
);

function normalizeEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.enabled;
}

export function normalizeStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : DEFAULT_SETTINGS.strength;
}

export function normalizeNoiseStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : DEFAULT_SETTINGS.noiseStrength;
}

export function mergeSettings(settings: UserSettings, patch: SettingsPatch): UserSettings {
  return { ...settings, ...patch, features: { ...settings.features, ...patch.features }, palette: { ...settings.palette, ...patch.palette } };
}

export async function readSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get([
    ...Object.values(SETTINGS_KEYS), ...Object.values(FEATURE_SETTINGS_KEYS), ...Object.values(PALETTE_SETTINGS_KEYS),
  ]);
  return {
    enabled: normalizeEnabled(stored[SETTINGS_KEYS.enabled]),
    strength: normalizeStrength(stored[SETTINGS_KEYS.strength]),
    noiseStrength: normalizeNoiseStrength(stored[SETTINGS_KEYS.noiseStrength]),
    palette: {
      hue: normalizePaletteChannel('hue', stored[PALETTE_SETTINGS_KEYS.hue]),
      saturation: normalizePaletteChannel('saturation', stored[PALETTE_SETTINGS_KEYS.saturation]),
      brightness: normalizePaletteChannel('brightness', stored[PALETTE_SETTINGS_KEYS.brightness]),
    },
    features: Object.fromEntries(FEATURE_REGISTRY.map((feature) => [
      feature.id, featureEnabled(feature, stored[FEATURE_SETTINGS_KEYS[feature.id]!]),
    ])),
  };
}

/** Separate keys prevent concurrent editors from overwriting unrelated preferences. */
export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const values: Record<string, boolean | number> = {};
  if ('enabled' in patch) values[SETTINGS_KEYS.enabled] = normalizeEnabled(patch.enabled);
  if ('strength' in patch) values[SETTINGS_KEYS.strength] = normalizeStrength(patch.strength);
  if ('noiseStrength' in patch) values[SETTINGS_KEYS.noiseStrength] = normalizeNoiseStrength(patch.noiseStrength);
  for (const channel of PALETTE_CHANNELS) {
    if (patch.palette && Object.hasOwn(patch.palette, channel)) {
      values[PALETTE_SETTINGS_KEYS[channel]] = normalizePaletteChannel(channel, patch.palette[channel]);
    }
  }
  for (const feature of FEATURE_REGISTRY) {
    if (patch.features && Object.hasOwn(patch.features, feature.id)) {
      values[FEATURE_SETTINGS_KEYS[feature.id]!] = featureEnabled(feature, patch.features[feature.id]);
    }
  }
  if (Object.keys(values).length > 0) await chrome.storage.local.set(values);
}

/** Subscribe before reading, then merge changes received during the initial read. */
export function watchSettings(
  listener: (settings: UserSettings) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  let initialized = false;
  let current: UserSettings = mergeSettings(DEFAULT_SETTINGS, {});
  let buffered: SettingsPatch = {};

  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !active) return;
    const patch: SettingsPatch = {};
    const enabled = changes[SETTINGS_KEYS.enabled];
    const strength = changes[SETTINGS_KEYS.strength];
    if (enabled) patch.enabled = normalizeEnabled(enabled.newValue);
    if (strength) patch.strength = normalizeStrength(strength.newValue);
    const noiseStrength = changes[SETTINGS_KEYS.noiseStrength];
    if (noiseStrength) patch.noiseStrength = normalizeNoiseStrength(noiseStrength.newValue);
    for (const channel of PALETTE_CHANNELS) {
      const change = changes[PALETTE_SETTINGS_KEYS[channel]];
      if (change) {
        patch.palette ??= {};
        patch.palette[channel] = normalizePaletteChannel(channel, change.newValue);
      }
    }
    const features: Record<string, boolean> = {};
    for (const feature of FEATURE_REGISTRY) {
      const change = changes[FEATURE_SETTINGS_KEYS[feature.id]!];
      if (change) features[feature.id] = featureEnabled(feature, change.newValue);
    }
    if (Object.keys(features).length > 0) patch.features = features;
    if (Object.keys(patch).length === 0) return;
    if (!initialized) {
      buffered = { ...buffered, ...patch, features: { ...buffered.features, ...patch.features }, palette: { ...buffered.palette, ...patch.palette } };
      return;
    }
    current = mergeSettings(current, patch);
    listener(mergeSettings(current, {}));
  };

  chrome.storage.onChanged.addListener(onChanged);
  void readSettings().then((stored) => {
    if (!active) return;
    current = mergeSettings(stored, buffered);
    initialized = true;
    buffered = {};
    listener(mergeSettings(current, {}));
  }).catch((error: unknown) => {
    if (active) onError(error);
  });

  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
