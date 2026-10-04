import type { SiteAdapter, SiteFeatureInstance } from '../sites/types';

/** Only registered IDs are persisted or mounted. Missing values use registry defaults. */
export type FeaturePreferences = Readonly<Record<string, boolean>>;

export interface FeatureContext {
  readonly document: Document;
  readonly site: SiteAdapter;
}

export interface FeatureDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
  /** Return undefined when this site does not support the feature. */
  mount(context: FeatureContext): SiteFeatureInstance | undefined;
}
