import { isDesignId } from './schema';
import { readDesign } from './immutable';
import {
  SKIN_STATES,
  type DesignDocument,
  type DesignTarget,
  type SkinFrame,
  type SkinState,
  type SurfaceStyleRule,
} from './types';

export const DESIGN_STYLE_ID = 'web-world-themes-design-style';
/** Root attributes the editor sets to preview one skin state or the compact look on the real page. */
export const SKIN_FORCE_ATTRIBUTE = 'data-ww-skin-force';
export const SKIN_FORCE_COMPACT_ATTRIBUTE = 'data-ww-skin-force-compact';
/** Element attribute the renderer maintains for parts smaller than their frame's edges. */
export const SKIN_COMPACT_ATTRIBUTE = 'data-ww-skin-compact';

export type AssetUrl = (assetId: string) => string | undefined;
// Only object URLs the engine created itself are written into CSS.
const OBJECT_URL =
  /^blob:https?:\/\/[a-z0-9.-]+(?::\d{1,5})?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROOT = 'html[data-ww-design][data-ww-site]';
// Two ID-weight guards keep every skin rule above theme selectors that use IDs. The adapter's
// conditions sit inside :where(), so all states weigh the same and source order decides.
const BOOST = ':not(#ww-skin-a):not(#ww-skin-b)';
const px = (value: number) => `${Math.round(value * 100) / 100}px`;

function surfaceSelector(target: DesignTarget): string {
  if (!isDesignId(target.surface)) throw new Error('このページでは編集対象を利用できません。');
  return `[data-ww-surface~="${target.surface}"]`;
}

function compileStyle(rule: SurfaceStyleRule, target: DesignTarget): string {
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
  const selector = `html[data-ww-design][data-ww-site] ${surfaceSelector(target)}`;
  return `${selector},${selector}:hover{${declarations.join('')}}`;
}

/** border-image never takes part in layout or hit testing; the box, text and input stay native. */
function frameDeclarations(frame: SkinFrame, url: string, background: string): string {
  const { top, right, bottom, left } = frame.slices,
    scale = frame.scalePct / 100;
  return (
    `border-image-source:url("${url}") !important;` +
    `border-image-slice:${top} ${right} ${bottom} ${left} fill !important;` +
    `border-image-width:${px(top * scale)} ${px(right * scale)} ${px(bottom * scale)} ${px(left * scale)} !important;` +
    `border-image-outset:0 !important;` +
    `border-image-repeat:${frame.center === 'repeat' ? 'round' : 'stretch'} !important;` +
    `background-color:${background} !important;background-image:none !important;`
  );
}

/** Every state selector keeps the part's attribute as its key, so the browser files the rules
 * under that attribute instead of checking them against every element on each recalculation.
 * The adapter's condition runs on the same element as `*` inside :where(). */
function conditions(target: DesignTarget): Record<SkinState, string> {
  if (!target.skin) throw new Error(`${target.label}は着せ替えに対応していません。`);
  const element = surfaceSelector(target);
  const result = { normal: element } as Record<SkinState, string>;
  for (const state of SKIN_STATES) {
    if (state === 'normal') continue;
    const condition = target.skin.states[state];
    if (condition === undefined) continue;
    if (condition.split('&').length !== 2 || /[{};\\]/.test(condition))
      throw new Error('着せ替えの状態条件が不正です。');
    result[state] = `${element}:where(${condition.replace('&', '*')})`;
  }
  return result;
}

function compileSkin(
  rule: SurfaceStyleRule,
  target: DesignTarget,
  url: AssetUrl | undefined,
  previews: boolean,
): string {
  const skin = rule.skin!;
  const states = conditions(target);
  const resolve = (frame: SkinFrame) => {
    const value = url?.(frame.assetId);
    return value !== undefined && OBJECT_URL.test(value) ? value : undefined;
  };
  const normal = resolve(skin.states.normal);
  // Until the normal art is ready the part keeps its native look.
  if (!normal) return '';
  const background = rule.style.backgroundColor ?? 'transparent';
  const element = surfaceSelector(target);
  const lines: string[] = [];
  const paint = (frame: SkinFrame | undefined) => {
    if (!frame) return undefined;
    const value = resolve(frame);
    return value ? frameDeclarations(frame, value, background) : undefined;
  };
  for (const state of SKIN_STATES) {
    const declarations = paint(skin.states[state]);
    if (declarations && states[state] !== undefined)
      lines.push(`${ROOT}:not([${SKIN_FORCE_ATTRIBUTE}^="${rule.target}:"])${BOOST} ${states[state]}{${declarations}}`);
  }
  // Forced previews show a state without hovering or pressing; a missing state shows normal.
  // They exist only while the skin editor is open, so viewers never pay for their matching.
  if (previews)
    for (const state of SKIN_STATES) {
      const declarations = paint(skin.states[state] ?? skin.states.normal);
      if (declarations)
        lines.push(`${ROOT}[${SKIN_FORCE_ATTRIBUTE}="${rule.target}:${state}"]${BOOST} ${element}{${declarations}}`);
    }
  if (skin.compact) {
    const declarations =
      skin.compact.kind === 'color'
        ? `border-image-source:none !important;background-color:${skin.compact.color} !important;background-image:none !important;`
        : paint(skin.compact.frame);
    if (declarations) {
      lines.push(`${ROOT}${BOOST} ${element}[${SKIN_COMPACT_ATTRIBUTE}~="${rule.target}"]{${declarations}}`);
      if (previews)
        lines.push(`${ROOT}[${SKIN_FORCE_COMPACT_ATTRIBUTE}="${rule.target}"]${BOOST} ${element}{${declarations}}`);
    }
  }
  return lines.join('\n');
}

/** Selectors come only from bundled target definitions, never from saved JSON. */
export function compileDesign(
  input: DesignDocument,
  targets: readonly DesignTarget[],
  url?: AssetUrl,
  options: { previews?: boolean } = {},
): string {
  const design = readDesign(input);
  return design.rules
    .map((rule) => {
      const target = targets.find((candidate) => candidate.id === rule.target);
      if (!target || !isDesignId(target.surface)) throw new Error('このページでは編集対象を利用できません。');
      const style = compileStyle(rule, target);
      if (!rule.skin) return style;
      const skin = compileSkin(rule, target, url, Boolean(options.previews));
      return [style, skin].filter(Boolean).join('\n');
    })
    .join('\n');
}

export interface CompactNeed {
  target: string;
  minWidth: number;
  minHeight: number;
}
/** A part is compact while its box is smaller than the normal frame's drawn edges. */
export function skinCompactNeeds(design: DesignDocument): CompactNeed[] {
  return design.rules.flatMap((rule) => {
    if (!rule.skin?.compact) return [];
    const { slices, scalePct } = rule.skin.states.normal,
      scale = scalePct / 100;
    return [
      {
        target: rule.target,
        minWidth: (slices.left + slices.right) * scale,
        minHeight: (slices.top + slices.bottom) * scale,
      },
    ];
  });
}

export type SkinAssetStatus = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };
export interface SkinAssetPort {
  /** Resolves to an object URL of a validated static image. */
  load(assetId: string): Promise<string>;
  revoke(url: string): void;
}

export function createDesignRenderer(
  doc: Document,
  targets: readonly DesignTarget[],
  assets?: SkinAssetPort,
  onStatus?: () => void,
) {
  let style: HTMLStyleElement | undefined;
  let designId: string | undefined;
  let design: DesignDocument | undefined;
  let alive = true,
    previews = false;
  const urls = new Map<string, string>(),
    status = new Map<string, SkinAssetStatus>();
  // Compact detection uses one ResizeObserver; it runs only when a size changes, never per frame.
  let needs: CompactNeed[] = [];
  let resize: ResizeObserver | undefined;
  const observed = new Set<Element>();
  const compactOf = (element: Element, width: number, height: number) => {
    const ids = needs
      .filter((need) => {
        const target = targets.find((item) => item.id === need.target);
        return target && element.matches(surfaceSelector(target)) && (width < need.minWidth || height < need.minHeight);
      })
      .map((need) => need.target);
    const value = ids.join(' ');
    if (value) {
      if (element.getAttribute(SKIN_COMPACT_ATTRIBUTE) !== value) element.setAttribute(SKIN_COMPACT_ATTRIBUTE, value);
    } else if (element.hasAttribute(SKIN_COMPACT_ATTRIBUTE)) element.removeAttribute(SKIN_COMPACT_ATTRIBUTE);
  };
  const stopCompact = () => {
    resize?.disconnect();
    resize = undefined;
    observed.forEach((element) => element.removeAttribute(SKIN_COMPACT_ATTRIBUTE));
    observed.clear();
  };
  /** `candidates`: elements the site just marked. Without them (initial render, other sites),
   * one whole-document query finds the parts. */
  const observeCompact = (prune: boolean, candidates?: readonly Element[]) => {
    if (!needs.length) return stopCompact();
    const View = doc.defaultView?.ResizeObserver;
    if (!View) return;
    resize ??= new View((entries) => {
      for (const entry of entries) {
        const box = entry.borderBoxSize?.[0];
        compactOf(
          entry.target,
          box ? box.inlineSize : entry.contentRect.width,
          box ? box.blockSize : entry.contentRect.height,
        );
      }
    });
    if (prune)
      for (const element of observed)
        if (!element.isConnected) {
          element.removeAttribute(SKIN_COMPACT_ATTRIBUTE);
          resize.unobserve(element);
          observed.delete(element);
        }
    const selector = needs
      .map((need) => targets.find((item) => item.id === need.target))
      .filter((target): target is DesignTarget => Boolean(target))
      .map(surfaceSelector)
      .join(',');
    if (!selector) return;
    const elements = candidates
      ? candidates.filter((element) => element.isConnected && element.matches(selector))
      : doc.querySelectorAll(selector);
    for (const element of elements)
      if (!observed.has(element)) {
        observed.add(element);
        resize.observe(element, { box: 'border-box' });
      }
  };
  const refresh = (change?: string, marked?: readonly Element[]) => {
    if (!style || !designId) return;
    if (doc.documentElement.getAttribute('data-ww-design') !== designId)
      doc.documentElement.setAttribute('data-ww-design', designId);
    if (!style.isConnected) (doc.head ?? doc.documentElement).append(style);
    if (!needs.length) return;
    // With the site's list of newly marked parts, only those are checked; otherwise text-only
    // updates cannot add parts, and structure or navigation falls back to one query.
    if (marked) {
      if (marked.length || change === 'navigation') observeCompact(change === 'navigation', marked);
    } else if (change !== 'content') observeCompact(change === 'navigation');
  };
  const destroy = () => {
    style?.remove();
    style = undefined;
    designId = undefined;
    stopCompact();
    doc.documentElement.removeAttribute('data-ww-design');
  };
  const release = (keep: ReadonlySet<string>) => {
    for (const [id, url] of urls)
      if (!keep.has(id)) {
        assets?.revoke(url);
        urls.delete(id);
      }
    for (const id of status.keys()) if (!keep.has(id)) status.delete(id);
  };
  const wanted = (next: DesignDocument | undefined) =>
    new Set(
      next?.rules.flatMap((rule) => {
        if (!rule.skin) return [];
        const frames = Object.values(rule.skin.states) as SkinFrame[];
        if (rule.skin.compact?.kind === 'frame') frames.push(rule.skin.compact.frame);
        return frames.map((frame) => frame.assetId);
      }) ?? [],
    );
  const load = (ids: ReadonlySet<string>) => {
    if (!assets) return;
    for (const id of ids) {
      if (status.has(id)) continue;
      status.set(id, { state: 'loading' });
      void assets
        .load(id)
        .then((url) => {
          if (!alive || !wanted(design).has(id) || status.get(id)?.state !== 'loading') return assets.revoke(url);
          urls.set(id, url);
          status.set(id, { state: 'ready' });
          render();
        })
        .catch((error: unknown) => {
          if (!alive || status.get(id)?.state !== 'loading') return;
          status.set(id, {
            state: 'error',
            message: error instanceof Error ? error.message : '素材を読み込めません。',
          });
          onStatus?.();
        });
    }
  };
  function render() {
    const css = design ? compileDesign(design, targets, (id) => urls.get(id), { previews }) : '';
    if (!design || !css) {
      destroy();
      onStatus?.();
      return;
    }
    style ??= doc.createElement('style');
    style.id = DESIGN_STYLE_ID;
    if (style.textContent !== css) style.textContent = css;
    designId = design.id;
    const nextNeeds = skinCompactNeeds(design);
    if (JSON.stringify(nextNeeds) !== JSON.stringify(needs)) {
      stopCompact();
      needs = nextNeeds;
    }
    refresh('structure');
    onStatus?.();
  }
  return {
    update(next: DesignDocument | undefined) {
      design = next;
      const ids = wanted(next);
      release(ids);
      load(ids);
      render();
    },
    refresh,
    /** The skin editor's forced-state rules are compiled only while it is open. */
    setPreviews(value: boolean) {
      if (value === previews) return;
      previews = value;
      if (design) render();
    },
    /** Per-asset loading state, for the editor's "not applied" reasons. */
    assetStatus: (id: string): SkinAssetStatus | undefined => status.get(id),
    destroy() {
      destroy();
      design = undefined;
      release(new Set());
    },
    dispose() {
      alive = false;
      destroy();
      design = undefined;
      release(new Set());
    },
  };
}
