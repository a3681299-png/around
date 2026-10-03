export interface UserSettings {
  enabled: boolean;
  strength: number;
}

export const DEFAULT_SETTINGS: Readonly<UserSettings> = Object.freeze({
  enabled: false,
  strength: 60,
});

export const SETTINGS_KEYS = {
  enabled: 'webWorldThemes.enabled',
  strength: 'webWorldThemes.strength',
} as const;

function normalizeEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.enabled;
}

export function normalizeStrength(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : DEFAULT_SETTINGS.strength;
}

export async function readSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get(Object.values(SETTINGS_KEYS));
  return {
    enabled: normalizeEnabled(stored[SETTINGS_KEYS.enabled]),
    strength: normalizeStrength(stored[SETTINGS_KEYS.strength]),
  };
}

/** Separate keys keep one popup's strength edit from overwriting another's toggle. */
export async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
  const values: Record<string, boolean | number> = {};
  if ('enabled' in patch) values[SETTINGS_KEYS.enabled] = normalizeEnabled(patch.enabled);
  if ('strength' in patch) values[SETTINGS_KEYS.strength] = normalizeStrength(patch.strength);
  if (Object.keys(values).length > 0) await chrome.storage.local.set(values);
}

/** Subscribe before reading, then merge changes received during the initial read. */
export function watchSettings(
  listener: (settings: UserSettings) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  let initialized = false;
  let current: UserSettings = { ...DEFAULT_SETTINGS };
  let buffered: Partial<UserSettings> = {};

  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !active) return;
    const patch: Partial<UserSettings> = {};
    const enabled = changes[SETTINGS_KEYS.enabled];
    const strength = changes[SETTINGS_KEYS.strength];
    if (enabled) patch.enabled = normalizeEnabled(enabled.newValue);
    if (strength) patch.strength = normalizeStrength(strength.newValue);
    if (Object.keys(patch).length === 0) return;
    if (!initialized) {
      buffered = { ...buffered, ...patch };
      return;
    }
    current = { ...current, ...patch };
    listener({ ...current });
  };

  chrome.storage.onChanged.addListener(onChanged);
  void readSettings().then((stored) => {
    if (!active) return;
    current = { ...stored, ...buffered };
    initialized = true;
    buffered = {};
    listener({ ...current });
  }).catch((error: unknown) => {
    if (active) onError(error);
  });

  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChanged);
  };
}
