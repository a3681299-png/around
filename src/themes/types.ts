import type { UserSettings } from '../storage/settings';

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly stylesheets: readonly string[];
  readonly editorStylesheets: readonly string[];
  readonly variables?: (settings: UserSettings) => Readonly<Record<string, string>>;
}
