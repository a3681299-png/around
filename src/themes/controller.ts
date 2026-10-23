import { createFeatureController } from '../features/controller';
import { compileDesign, createDesignRenderer } from '../design/renderer';
import { readDesign } from '../design/immutable';
import type { DesignDocument } from '../design/types';
import { createImageRenderer, type ImageEditing } from '../design/image-renderer';
import type { SiteAdapter, SitePageChange } from '../sites/types';
import type { UserSettings } from '../storage/settings';
import type { ThemeDefinition } from './types';
import { createTimelineHost, type TimelineHost } from '../host/timeline';
import { createTakeStorage } from '../browser/take-storage';
import { createOperationGuardHost, type OperationGuardHost } from '../host/operation-guard';

const STYLE_ID = 'web-world-themes-style';

export interface ThemeController {
  safety: OperationGuardHost | undefined;
  suspend(value: boolean): void;
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
  const safety = site.operationSurfaces
    ? createOperationGuardHost(doc, site.operationSurfaces(), (stop) => {
        if (stop) images.holdSafety(stop === true ? undefined : stop);
        images.refresh();
      })
    : undefined;
  const images = createImageRenderer(doc, site.decorationAnchors ?? [], site.signals?.videoPlayback, timeline, safety);
  let suspended = false;
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
    safety?.setActive(false);
    images.destroy();
    designRenderer.destroy();
    features.destroy();
    disconnect?.();
    disconnect = undefined;
    removeBase();
  };

  const followPage = (change?: SitePageChange) => {
    if (suspended || !current?.enabled || current.strength === 0) return;
    if (design?.baseThemeId !== null) {
      // Reattach the cached sheet after head replacement; settings have not changed.
      if (style && !style.isConnected) (doc.head ?? root).append(style);
      if (change !== 'content') features.refresh();
    }
    designRenderer.refresh();
    images.refresh();
    // Text can alter geometry too; active editors compare their anchor snapshot.
    onSurfacesChanged?.();
  };

  const render = () => {
    if (suspended || !current?.enabled || current.strength === 0) return;
    safety?.setActive(true);
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
    const next = input ? readDesign(input) : undefined;
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
    safety,
    suspend(value) {
      if (value === suspended) return;
      suspended = value;
      if (value) deactivate();
      else if (current?.enabled && current.strength > 0) {
        disconnect ??= site.connect(followPage);
        render();
      }
    },
    timeline,
    update(settings) {
      current = settings;
      if (suspended || !settings.enabled || settings.strength === 0) {
        deactivate();
        return;
      }
      disconnect ??= site.connect(followPage);
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
      safety?.destroy();
    },
  };
}
