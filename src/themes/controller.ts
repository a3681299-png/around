import { createFeatureController } from '../features/controller';
import type { SiteAdapter } from '../sites/types';
import type { UserSettings } from '../storage/settings';
import type { ThemeDefinition } from './types';

const STYLE_ID = 'web-world-themes-style';

export function createThemeController(
  doc: Document,
  site: SiteAdapter,
  theme: ThemeDefinition,
): { update(settings: UserSettings): void; destroy(): void } {
  const features = createFeatureController({ document: doc, site });
  let disconnect: (() => void) | undefined;
  let style: HTMLStyleElement | undefined;
  let strength = 0;
  const root = doc.documentElement;
  const css = [site.stylesheet, ...theme.stylesheets].join('\n');

  const render = () => {
    root.setAttribute('data-ww-theme', theme.id);
    root.style.setProperty('--ww-strength', String(strength / 100));
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
    }
    if (!style.isConnected) (doc.head ?? root).append(style);
    features.refresh();
  };

  const destroy = () => {
    features.destroy();
    disconnect?.();
    disconnect = undefined;
    style?.remove();
    style = undefined;
    root.removeAttribute('data-ww-theme');
    root.style.removeProperty('--ww-strength');
  };

  return {
    update(settings) {
      strength = settings.strength;
      // Zero is an exact original-style boundary, including native corner radii.
      if (!settings.enabled || strength === 0) {
        destroy();
        return;
      }
      disconnect ??= site.connect(render);
      features.update(settings.features);
      render();
    },
    destroy,
  };
}

