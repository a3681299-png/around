/** Deliberately excluded from artwork, Undo, and backup restoration. */
export const EMERGENCY_KEY = 'webWorldThemes.safety.emergencyOff';
export const EMERGENCY_COMMAND = 'emergency-off';
export const SAFETY_SHORTCUT = 'web-world-themes:safety-shortcut';
export function safetyShortcut(): Promise<string> {
  if (chrome.commands?.getAll)
    return chrome.commands
      .getAll()
      .then((commands) => commands.find((c) => c.name === EMERGENCY_COMMAND)?.shortcut ?? '');
  return chrome.runtime.sendMessage({ type: SAFETY_SHORTCUT });
}
export async function setEmergencyOff(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [EMERGENCY_KEY]: value });
}
export function watchEmergencyOff(changed: (value: boolean) => void): () => void {
  let active = true,
    revision = 0;
  const listener = (values: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && values[EMERGENCY_KEY]) {
      revision++;
      changed(values[EMERGENCY_KEY]!.newValue === true);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  const initial = revision;
  void chrome.storage.local.get(EMERGENCY_KEY).then(
    (values) => {
      if (active && initial === revision) changed(values[EMERGENCY_KEY] === true);
    },
    () => {
      if (active) changed(true);
    },
  );
  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(listener);
  };
}
