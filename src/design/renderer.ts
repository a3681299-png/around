import { isDesignId } from './schema';
import { readDesign } from './immutable';
import type { DesignDocument, DesignTarget } from './types';

export const DESIGN_STYLE_ID = 'web-world-themes-design-style';

/** Selectors come only from bundled target definitions, never from saved JSON. */
export function compileDesign(input: DesignDocument, targets: readonly DesignTarget[]): string {
  const design = readDesign(input);
  return design.rules
    .map((rule) => {
      const target = targets.find((candidate) => candidate.id === rule.target);
      if (!target || !isDesignId(target.surface)) throw new Error('このページでは編集対象を利用できません。');
      const declarations: string[] = [];
      if (rule.style.backgroundColor !== undefined)
        declarations.push(`background:${rule.style.backgroundColor} !important;`);
      if (rule.style.border !== undefined) {
        const { color, widthPx } = rule.style.border;
        declarations.push(`box-shadow:${widthPx === 0 ? 'none' : `inset 0 0 0 ${widthPx}px ${color}`} !important;`);
      }
      if (rule.style.borderRadiusPx !== undefined)
        declarations.push(`border-radius:${rule.style.borderRadiusPx}px !important;`);
      if (declarations.length === 0) return '';
      // The explicit hover rule also replaces the built-in card bevel on hover.
      const selector = `html[data-ww-design][data-ww-site] [data-ww-surface~="${target.surface}"]`;
      return `${selector},${selector}:hover{${declarations.join('')}}`;
    })
    .join('\n');
}

export function createDesignRenderer(doc: Document, targets: readonly DesignTarget[]) {
  let style: HTMLStyleElement | undefined;
  const destroy = () => {
    style?.remove();
    style = undefined;
    doc.documentElement.removeAttribute('data-ww-design');
  };
  return {
    update(design: DesignDocument | undefined) {
      const css = design ? compileDesign(design, targets) : '';
      if (!design || !css) {
        destroy();
        return;
      }
      style ??= doc.createElement('style');
      style.id = DESIGN_STYLE_ID;
      if (style.textContent !== css) style.textContent = css;
      doc.documentElement.setAttribute('data-ww-design', design.id);
      if (!style.isConnected) (doc.head ?? doc.documentElement).append(style);
    },
    destroy,
  };
}
