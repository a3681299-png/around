import { personalizationFeatures } from './personalization';
import type { FeatureDefinition, FeaturePreferences } from './types';

const windowChrome: FeatureDefinition = {
  id: 'window-chrome',
  label: '窓の飾り',
  description: 'タイトルバー・動画とリストの小窓・時計を表示',
  defaultEnabled: true,
};

/** The saved toggles' IDs, defaults and labels, in their original order. */
export const FEATURE_REGISTRY: readonly FeatureDefinition[] = Object.freeze([windowChrome, ...personalizationFeatures]);

export function defaultFeaturePreferences(): FeaturePreferences {
  return Object.fromEntries(FEATURE_REGISTRY.map((feature) => [feature.id, feature.defaultEnabled]));
}

export function featureEnabled(feature: FeatureDefinition, value: unknown): boolean {
  return typeof value === 'boolean' ? value : feature.defaultEnabled;
}

export type { FeatureDefinition, FeaturePreferences } from './types';
