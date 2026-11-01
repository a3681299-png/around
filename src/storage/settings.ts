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

/**
 * Reads the settings. The first read after the retro theme's removal settles 作品を表示する for
 * someone who turned the theme off with the strength slider: with the new key unsaved and the old
 * strength at 0%, OFF is saved once. Every later read finds the new key and changes nothing, so
 * any number of reads, from any page, give the same result.
 */
export async function readSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get([
    ...Object.values(SETTINGS_KEYS),
    ...Object.values(LEGACY_SETTINGS_KEYS),
  ]);
  const saved = stored[SETTINGS_KEYS.enabled];
  let enabled: boolean;
  if (typeof saved === 'boolean') enabled = saved;
  else {
    if (legacyStrengthOff(stored[LEGACY_SETTINGS_KEYS.strength])) {
      enabled = false;
      await chrome.storage.local.set({ [SETTINGS_KEYS.enabled]: false });
    } else {
      const legacy = stored[LEGACY_SETTINGS_KEYS.enabled];
      enabled = typeof legacy === 'boolean' ? legacy : DEFAULT_SETTINGS.enabled;
    }
  }
  return { creatorMode: stored[SETTINGS_KEYS.creatorMode] === true, enabled };
}

/** Separate keys prevent concurrent editors from overwriting unrelated preferences. */
export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const values: Record<string, boolean> = {};
  if ('creatorMode' in patch) values[SETTINGS_KEYS.creatorMode] = patch.creatorMode === true;
  if ('enabled' in patch) values[SETTINGS_KEYS.enabled] = patch.enabled !== false;
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
  let reread = 0;

  const apply = (patch: SettingsPatch) => {
    if (!initialized) {
      buffered = { ...buffered, ...patch };
      return;
    }
    current = mergeSettings(current, patch);
    listener(mergeSettings(current, {}));
  };
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local' || !active) return;
    const patch: SettingsPatch = {};
    const creatorMode = changes[SETTINGS_KEYS.creatorMode];
    if (creatorMode) patch.creatorMode = creatorMode.newValue === true;
    const enabled = changes[SETTINGS_KEYS.enabled];
    if (enabled) {
      if (typeof enabled.newValue === 'boolean') patch.enabled = enabled.newValue;
      // Removed (a storage reset): the value is derived again, as on a first read.
      else reread++;
    } else if (Object.values(LEGACY_SETTINGS_KEYS).some((key) => changes[key])) reread++;
    if (Object.keys(patch).length > 0) apply(patch);
    if (reread > 0 && initialized) derive();
  };
  /** 作品を表示する depends on the legacy keys while it is unsaved: derive it again. */
  const derive = () => {
    const ticket = reread;
    void readSettings().then(
      (stored) => {
        if (!active || ticket !== reread) return;
        reread = 0;
        if (stored.enabled !== current.enabled) apply({ enabled: stored.enabled });
      },
      (error: unknown) => {
        if (active) onError(error);
      },
    );
  };

  chrome.storage.onChanged.addListener(onChanged);
  void readSettings()
    .then((stored) => {
      if (!active) return;
      current = mergeSettings(stored, buffered);
      initialized = true;
      buffered = {};
      listener(mergeSettings(current, {}));
      // A legacy key changed while the first read was on its way.
      if (reread > 0) derive();
    })
    .catch((error: unknown) => {
      if (active) onError(error);
    });

  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
