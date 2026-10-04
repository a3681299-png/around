import { windowChrome } from './window-chrome';
import type { FeatureDefinition, FeaturePreferences } from './types';

/** Add a module here to expose its default, saved toggle, and lifecycle together. */
export const FEATURE_REGISTRY: readonly FeatureDefinition[] = Object.freeze([
  windowChrome,
]);

export function defaultFeaturePreferences(): FeaturePreferences {
  return Object.fromEntries(FEATURE_REGISTRY.map((feature) => [feature.id, feature.defaultEnabled]));
}

export function featureEnabled(feature: FeatureDefinition, value: unknown): boolean {
  return typeof value === 'boolean' ? value : feature.defaultEnabled;
}

export type { FeatureContext, FeatureDefinition, FeaturePreferences } from './types';
