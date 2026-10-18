import type { StudioPreferences } from '../studio/preferences';
export const browserStudioPreferences: StudioPreferences = {
  read: async (key) => (await chrome.storage.local.get(key))[key] as unknown,
  write: (key, value) => chrome.storage.local.set({ [key]: value }),
};
