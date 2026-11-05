// The user's settings: their shape, keys and defaults. Reading and writing them is the
// browser's job (src/browser/settings-store.ts); a host without extension storage keeps its own.
export interface UserSettings {
  creatorMode: boolean;
  /** 作品を表示する: the artwork is drawn and edited on the page. */
  enabled: boolean;
}

export type SettingsPatch = Partial<UserSettings>;

export const DEFAULT_SETTINGS: Readonly<UserSettings> = Object.freeze({
  creatorMode: false,
  // A new creator's artwork shows at once; with no artwork nothing is drawn.
  enabled: true,
});

export const SETTINGS_KEYS = {
  creatorMode: 'webWorldThemes.creatorMode',
  enabled: 'webWorldThemes.showArtwork',
} as const;

/** Written until the retro theme was removed (docs/theme-removal.md). They are read only while
 * 作品を表示する has never been saved, and never written or removed. */
export const LEGACY_SETTINGS_KEYS = Object.freeze({
  enabled: 'webWorldThemes.enabled',
  strength: 'webWorldThemes.strength',
});

/** The retro strength slider at 0% meant OFF; its stored value was normalized like this. */
export function legacyStrengthOff(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.round(Math.min(100, Math.max(0, value))) === 0;
}

export function mergeSettings(settings: UserSettings, patch: SettingsPatch): UserSettings {
  return { ...settings, ...patch };
}
