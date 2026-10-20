import { createFeatureController } from '../features/controller';
import { compileDesign, createDesignRenderer } from '../design/renderer';
import { parseDesign } from '../design/schema';
import type { DesignDocument } from '../design/types';
import { createImageRenderer, type ImageEditing } from '../design/image-renderer';
import type { SiteAdapter } from '../sites/types';
import type { UserSettings } from '../storage/settings';
import type { ThemeDefinition } from './types';
import { createTimelineHost, type TimelineHost } from '../host/timeline';
import { createTakeStorage } from '../browser/take-storage';

const STYLE_ID = 'web-world-themes-style';

export interface ThemeController {
  timeline: TimelineHost;
  update(settings: UserSettings): void;
  updateDesign(design: DesignDocument | undefined): void;
  setImageEditing(editing: ImageEditing | undefined): void;
  validateDesign(design: DesignDocument | undefined): void;
  destroy(): void;
}

export function createThemeController(
  doc: Document,
  site: SiteAdapter,
  theme: ThemeDefinition,
  onSurfacesChanged?: () => void,
): ThemeController {
  const features = createFeatureController({ document: doc, site });
  const designRenderer = createDesignRenderer(doc, site.designTargets ?? []);
  const timeline = createTimelineHost(doc, site.id, createTakeStorage(site.id));
  const images = createImageRenderer(doc, site.decorationAnchors ?? [], site.signals?.videoPlayback, timeline);
  const variables = new Set<string>();
  let disconnect: (() => void) | undefined;
  let style: HTMLStyleElement | undefined;
  let current: UserSettings | undefined;
  let design: DesignDocument | undefined;
  const root = doc.documentElement;
  const css = [site.stylesheet, ...theme.stylesheets].join('\n');

  const clearVariables = () => {
    variables.forEach((name) => root.style.removeProperty(name));
    variables.clear();
  };
  const removeBase = () => {
    style?.remove();
    style = undefined;
    root.removeAttribute('data-ww-theme');
    root.style.removeProperty('--ww-strength');
    clearVariables();
  };
  const deactivate = () => {
    images.destroy();
    designRenderer.destroy();
    features.destroy();
    disconnect?.();
    disconnect = undefined;
    removeBase();
  };

  const render = () => {
    if (!current?.enabled || current.strength === 0) return;
    if (design?.baseThemeId === null) {
      // Independent designs use native site styling plus their own rules only.
      features.destroy();
      removeBase();
    } else {
      root.setAttribute('data-ww-theme', theme.id);
      root.style.setProperty('--ww-strength', String(current.strength / 100));
      const next = theme.variables?.(current) ?? {};
      for (const name of variables) if (!Object.hasOwn(next, name)) root.style.removeProperty(name);
      variables.clear();
      for (const [name, value] of Object.entries(next)) {
        root.style.setProperty(name, value);
        variables.add(name);
      }
      if (!style) {
        style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
      }
      if (!style.isConnected) (doc.head ?? root).append(style);
      features.update(current.features);
      features.refresh();
    }
    designRenderer.update(design);
    images.update(design?.decorations ?? [], design?.groups ?? [], design?.signalRules ?? []);
    onSurfacesChanged?.();
  };

  const validateDesign = (input: DesignDocument | undefined) => {
    const next = input ? parseDesign(input) : undefined;
    if (next && (next.siteId !== site.id || (next.baseThemeId !== null && next.baseThemeId !== theme.id))) {
      throw new Error('このサイトまたは基底テーマには対応していません。');
    }
    if (next) compileDesign(next, site.designTargets ?? []);
    if (
      next?.decorations.some(
        (item) =>
          item.placement.anchor.kind === 'surface' &&
          !site.decorationAnchors?.some(
            (anchor) => item.placement.anchor.kind === 'surface' && anchor.id === item.placement.anchor.target,
          ),
      )
    ) {
      throw new Error('このサイトでは画像の配置基準を利用できません。');
    }
    return next;
  };
  return {
    timeline,
    update(settings) {
      current = settings;
      if (!settings.enabled || settings.strength === 0) {
        deactivate();
        return;
      }
      disconnect ??= site.connect(render);
      render();
    },
    updateDesign(input) {
      design = validateDesign(input);
      render();
    },
    setImageEditing(editing) {
      images.edit(editing);
    },
    validateDesign(input) {
      validateDesign(input);
    },
    destroy() {
      current = undefined;
      deactivate();
    },
  };
}
