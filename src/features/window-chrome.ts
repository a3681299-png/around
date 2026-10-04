import type { FeatureDefinition } from './types';

/** Selectors and page layout remain in the adapter, not in the feature registry. */
export const windowChrome: FeatureDefinition = {
  id: 'window-chrome',
  label: 'Window chrome',
  description: 'タイトルバーとナビゲーションを表示',
  // Preserve the existing appearance for users who have no feature preference yet.
  defaultEnabled: true,
  mount: ({ site }) => site.features?.['window-chrome']?.mount(),
};
