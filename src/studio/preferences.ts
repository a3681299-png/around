export interface StudioPreferences {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}
export const transientPreferences: StudioPreferences = { read: async () => undefined, write: async () => undefined };
