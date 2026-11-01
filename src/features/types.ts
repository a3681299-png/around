/** Only registered IDs are persisted. Missing values use registry defaults. */
export type FeaturePreferences = Readonly<Record<string, boolean>>;

/** A retro display option's saved toggle. The page no longer draws any of them (the retro theme
 * is gone, docs/theme-removal.md); the settings keep reading and writing them until round 3. */
export interface FeatureDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
}
