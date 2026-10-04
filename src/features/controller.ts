import type { SiteFeatureInstance } from '../sites/types';
import { FEATURE_REGISTRY, featureEnabled } from './index';
import type { FeatureContext, FeatureDefinition, FeaturePreferences } from './types';

/** Idempotent mounts with per-feature teardown, driven by the active theme lifetime. */
export function createFeatureController(
  context: FeatureContext,
  definitions: readonly FeatureDefinition[] = FEATURE_REGISTRY,
): { update(preferences?: FeaturePreferences): void; refresh(): void; destroy(): void } {
  const mounted = new Map<string, SiteFeatureInstance>();

  const unmount = (id: string) => {
    const instance = mounted.get(id);
    // Remove first so a repeated destroy never calls a feature's cleanup twice.
    mounted.delete(id);
    instance?.destroy();
  };

  return {
    update(preferences = {}) {
      for (const feature of definitions) {
        if (!featureEnabled(feature, preferences[feature.id])) {
          unmount(feature.id);
          continue;
        }
        if (!mounted.has(feature.id)) {
          const instance = feature.mount(context);
          if (instance) mounted.set(feature.id, instance);
        }
      }
    },
    refresh() {
      for (const instance of mounted.values()) instance.refresh?.();
    },
    destroy() {
      // The reverse order also permits future modules to layer decorations safely.
      for (const id of [...mounted.keys()].reverse()) unmount(id);
    },
  };
}
