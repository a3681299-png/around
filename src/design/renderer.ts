import { isDesignId } from './schema';
import { readDesign } from './immutable';
import { countPageChange } from '../diagnostics/page-change-probe';
import {
  backdropLuminance,
  decideInkAcross,
  hexRgb,
  INK,
  luminance,
  parseRgb,
  type ArtPixels,
  type Ink,
  type InkDecision,
  type Rgb,
} from './contrast';
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
/** Root attribute held only while the engine reads native text colours for its legibility plan. */
export const INK_OFF_ATTRIBUTE = 'data-ww-ink-off';

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

/** border-image never takes part in layout or hit testing; the box, text and input stay native.
 * The native background is kept: transparent art shows it, and only the author's explicit
 * colour (the existing style rule) replaces it. Parts whose children cover their edges, or
 * whose text starts at the edge, draw the frame outward by up to the adapter's measured gap. */
function frameDeclarations(frame: SkinFrame, url: string, outsetLimit: number): string {
  const { top, right, bottom, left } = frame.slices,
    scale = frame.scalePct / 100;
  const widths = [top, right, bottom, left].map((value) => value * scale);
  return (
    `border-image-source:url("${url}") !important;` +
    `border-image-slice:${top} ${right} ${bottom} ${left} fill !important;` +
    `border-image-width:${widths.map(px).join(' ')} !important;` +
    `border-image-outset:${outsetLimit ? widths.map((width) => px(Math.min(width, outsetLimit))).join(' ') : '0'} !important;` +
    `border-image-repeat:${frame.center === 'repeat' ? 'round' : 'stretch'} !important;`
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
  inks: InkPlan | undefined,
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
  const outset = target.skin?.outset ?? 0;
  const element = surfaceSelector(target);
  const lines: string[] = [];
  const paint = (frame: SkinFrame | undefined) => {
    if (!frame) return undefined;
    const value = resolve(frame);
    return value ? frameDeclarations(frame, value, outset) : undefined;
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
      // While a state's new art is still loading, the normal art stands in: the forced preview
      // switches the natural rules off, so a missing rule would flash the bare native part.
      const declarations = paint(skin.states[state]) ?? paint(skin.states.normal);
      if (declarations)
        lines.push(`${ROOT}[${SKIN_FORCE_ATTRIBUTE}="${rule.target}:${state}"]${BOOST} ${element}{${declarations}}`);
    }
  if (skin.compact) {
    const declarations =
      skin.compact.kind === 'color'
        ? // The author chose this colour for small parts; it is the one background a skin writes.
          `border-image-source:none !important;background-color:${skin.compact.color} !important;`
        : paint(skin.compact.frame);
    if (declarations) {
      lines.push(`${ROOT}${BOOST} ${element}[${SKIN_COMPACT_ATTRIBUTE}~="${rule.target}"]{${declarations}}`);
      if (previews)
        lines.push(`${ROOT}[${SKIN_FORCE_COMPACT_ATTRIBUTE}="${rule.target}"]${BOOST} ${element}{${declarations}}`);
    }
  }
  lines.push(...compileInk(rule.target, target, states, inks, previews));
  return lines.join('\n');
}

/** Per mode, per part and per state: white or black, decided by the engine from the art. */
export type InkPlan = {
  readonly [mode in 'light' | 'dark']?: { readonly [target: string]: { readonly [slot: string]: Ink } };
};
const INK_VALUES: readonly string[] = Object.values(INK);
/** `color` is the only property written for legibility. It reaches the part and the adapter's
 * text-bearing descendants (`ink`), mode by mode, in the same state order as the art. */
function compileInk(
  id: string,
  target: DesignTarget,
  states: Record<SkinState, string>,
  inks: InkPlan | undefined,
  previews: boolean,
): string[] {
  const template = target.skin?.ink;
  if (template !== undefined && (!template.includes('&') || /[{};\\]/.test(template)))
    throw new Error('着せ替えの文字色の対象が不正です。');
  const bases = (base: string) => (template ? [base, template.replaceAll('&', base)] : [base]);
  const rule = (prefix: string, base: string, ink: Ink) => {
    if (!INK_VALUES.includes(ink)) throw new Error('文字色が不正です。');
    return `${bases(base)
      .map((selector) => `${prefix} ${selector}`)
      .join(',')}{color:${ink} !important;}`;
  };
  const element = states.normal;
  const lines: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const slots = inks?.[mode]?.[id];
    if (!slots) continue;
    const root = `${ROOT}[data-ww-mode="${mode}"]:not([${INK_OFF_ATTRIBUTE}])`;
    for (const state of SKIN_STATES)
      if (slots[state] && states[state] !== undefined)
        lines.push(rule(`${root}:not([${SKIN_FORCE_ATTRIBUTE}^="${id}:"])${BOOST}`, states[state], slots[state]));
    if (previews)
      for (const state of SKIN_STATES) {
        const ink = slots[state] ?? slots.normal;
        if (ink) lines.push(rule(`${root}[${SKIN_FORCE_ATTRIBUTE}="${id}:${state}"]${BOOST}`, element, ink));
      }
    if (slots.compact) {
      lines.push(rule(`${root}${BOOST}`, `${element}[${SKIN_COMPACT_ATTRIBUTE}~="${id}"]`, slots.compact));
      if (previews)
        lines.push(rule(`${root}[${SKIN_FORCE_COMPACT_ATTRIBUTE}="${id}"]${BOOST}`, element, slots.compact));
    }
  }
  return lines;
}

/** Selectors come only from bundled target definitions, never from saved JSON. */
export function compileDesign(
  input: DesignDocument,
  targets: readonly DesignTarget[],
  url?: AssetUrl,
  options: { previews?: boolean; inks?: InkPlan } = {},
): string {
  const design = readDesign(input);
  WW_TEST_PAGE_CHANGE: countPageChange('compiles');
  return design.rules
    .map((rule) => {
      const target = targets.find((candidate) => candidate.id === rule.target);
      if (!target || !isDesignId(target.surface)) throw new Error('このページでは編集対象を利用できません。');
      const style = compileStyle(rule, target);
      if (!rule.skin) return style;
      const skin = compileSkin(rule, target, url, Boolean(options.previews), options.inks);
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
  /** Downscaled pixels of the same image, for the legibility check. */
  pixels?(assetId: string): Promise<ArtPixels>;
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
    // A mode switch shows other native colours; parts that were absent may have just appeared.
    if (change === 'mode') schedulePlan(true);
    else if (
      pending.size &&
      marked?.some((element) =>
        targets.some((target) => pending.has(target.id) && element.matches(surfaceSelector(target))),
      )
    )
      schedulePlan(true);
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
  // Legibility: decided only when the art, slices, author colour, design or mode change — never per
  // frame. Natives are read once per part and mode, before any engine colour for that mode exists.
  let inks: InkPlan = {},
    planKey = '',
    planTimer: ReturnType<typeof setTimeout> | undefined;
  const decisions = new Map<string, Record<string, InkDecision>>(),
    art = new Map<string, Promise<ArtPixels | undefined>>(),
    pending = new Set<string>();
  const mode = () => (doc.documentElement.getAttribute('data-ww-mode') === 'dark' ? 'dark' : 'light');
  /** Up to eight visible parts of the kind: one colour must suit each of them on its own backdrop. */
  const visibleParts = (target: DesignTarget) => {
    const found: Element[] = [];
    for (const element of doc.querySelectorAll(surfaceSelector(target))) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && found.push(element) >= 8) break;
    }
    return found;
  };
  /** What shows through transparent art: the part's own background over its ancestors'. */
  const backdropOf = (element: Element): Rgb => {
    const view = doc.defaultView!,
      chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
    let rgb: Rgb = mode() === 'dark' ? [15, 15, 15] : [255, 255, 255];
    for (const node of chain.reverse()) {
      const paint = parseRgb(view.getComputedStyle(node).backgroundColor);
      if (paint && paint.alpha > 0)
        rgb = paint.rgb.map((value, index) => value * paint.alpha + rgb[index]! * (1 - paint.alpha)) as unknown as Rgb;
    }
    return rgb;
  };
  // Pseudo-element entries of the list (e.g. ::placeholder) cannot match an element; test the
  // top-level entries one by one (commas inside :not(...) stay with their entry).
  const reaches = (node: Element, list: string) => {
    const entries: string[] = [];
    let depth = 0,
      start = 0;
    for (let index = 0; index < list.length; index++) {
      const char = list[index];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === ',' && depth === 0) {
        entries.push(list.slice(start, index));
        start = index + 1;
      }
    }
    entries.push(list.slice(start));
    return entries.some((selector) => {
      try {
        return node.matches(selector);
      } catch {
        return false;
      }
    });
  };
  /** The native colours of the text the engine's colour would reach: the part itself and the
   * adapter's text descendants. Children often set their own colour (titles, links). */
  const textColours = (element: Element, target: DesignTarget): Rgb[] => {
    const view = doc.defaultView!,
      template = target.skin?.ink;
    const reach = template ? template.replaceAll('&', surfaceSelector(target)) : undefined;
    const colours = new Map<string, Rgb>();
    const add = (node: Element) => {
      const colour = parseRgb(view.getComputedStyle(node).color);
      if (colour) colours.set(colour.rgb.join(), colour.rgb);
    };
    add(element);
    const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = 0;
    for (let node = walker.nextNode(); node && seen < 24; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || !parent.getClientRects().length) continue;
      seen++;
      if (parent === element || (reach && reaches(parent, reach))) add(parent);
    }
    return [...colours.values()];
  };
  const pixelsOf = (assetId: string) => {
    let entry = art.get(assetId);
    if (!entry) {
      entry = assets!.pixels!(assetId).catch(() => undefined);
      art.set(assetId, entry);
    }
    return entry;
  };
  const inkRgb = (ink: Ink): Rgb => (ink === INK.white ? [255, 255, 255] : [0, 0, 0]);
  async function plan() {
    planTimer = undefined;
    const current = design,
      now = mode();
    if (!current || !assets?.pixels || !doc.defaultView) return;
    const next: Record<string, Record<string, Ink>> = {};
    const status = new Map<string, Record<string, InkDecision>>();
    pending.clear();
    // Native colours and backdrops of every sampled part, read with the engine's colours switched
    // off for a moment (one attribute on the root; only while planning, never per frame).
    const samples = new Map<string, { backdrop: Rgb; natives: Rgb[] }[]>();
    const root = doc.documentElement;
    root.setAttribute(INK_OFF_ATTRIBUTE, '');
    try {
      for (const rule of current.rules) {
        const target = targets.find((item) => item.id === rule.target);
        if (!rule.skin || !target?.skin) continue;
        const parts = visibleParts(target);
        if (!parts.length) pending.add(rule.target);
        else
          samples.set(
            rule.target,
            parts
              .map((element) => ({ backdrop: backdropOf(element), natives: textColours(element, target) }))
              .filter((sample) => sample.natives.length),
          );
      }
    } finally {
      root.removeAttribute(INK_OFF_ATTRIBUTE);
    }
    for (const rule of current.rules) {
      const cases = samples.get(rule.target);
      if (!rule.skin || !cases?.length) continue;
      const slots: Record<string, Ink> = {},
        results: Record<string, InkDecision> = {};
      const judge = async (slot: string, frame: SkinFrame, shown?: Rgb) => {
        const pixels = await pixelsOf(frame.assetId);
        if (!pixels) return;
        const decision = decideInkAcross(
          cases.map(({ backdrop, natives }) => ({
            backdrop: backdropLuminance(pixels, frame, backdrop),
            natives: shown ? [shown] : natives,
          })),
        );
        results[slot] = decision;
        if (decision.ink) slots[slot] = decision.ink;
      };
      await judge('normal', rule.skin.states.normal);
      // Other states start from what the normal rule already shows.
      const shown = slots.normal ? inkRgb(slots.normal) : undefined;
      for (const state of SKIN_STATES)
        if (state !== 'normal' && rule.skin.states[state]) await judge(state, rule.skin.states[state]!, shown);
      if (rule.skin.compact?.kind === 'frame') await judge('compact', rule.skin.compact.frame, shown);
      else if (rule.skin.compact?.kind === 'color') {
        // An opaque author colour: one level for both ends.
        const level = luminance(hexRgb(rule.skin.compact.color));
        const decision = decideInkAcross(
          cases.map(({ natives }) => ({ backdrop: { dark: level, light: level }, natives: shown ? [shown] : natives })),
        );
        results.compact = decision;
        if (decision.ink) slots.compact = decision.ink;
      }
      if (Object.keys(slots).length) next[rule.target] = slots;
      status.set(rule.target, results);
    }
    // A newer design or mode replans; this result would be stale.
    if (current !== design || now !== mode()) return schedulePlan(true);
    decisions.clear();
    status.forEach((value, key) => decisions.set(key, value));
    const changed = JSON.stringify(inks[now] ?? {}) !== JSON.stringify(next);
    inks = { ...inks, [now]: next };
    if (changed) render();
    else onStatus?.();
  }
  const schedulePlan = (force = false) => {
    if (!assets?.pixels || !design) return;
    const key = JSON.stringify([
      mode(),
      design.rules.map((rule) => [rule.target, rule.skin, rule.style.backgroundColor]),
      [...urls.keys()].sort(),
    ]);
    if (!force && key === planKey) return;
    planKey = key;
    planTimer ??= setTimeout(() => void plan(), 0);
  };
  function render() {
    const css = design ? compileDesign(design, targets, (id) => urls.get(id), { previews, inks }) : '';
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
    schedulePlan();
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
    /** Legibility per state of one part in the current mode, for the editor. */
    inkStatus: (target: string): Readonly<Record<string, InkDecision>> | undefined => decisions.get(target),
    destroy() {
      destroy();
      design = undefined;
      release(new Set());
    },
    dispose() {
      alive = false;
      if (planTimer !== undefined) clearTimeout(planTimer);
      planTimer = undefined;
      destroy();
      design = undefined;
      release(new Set());
    },
  };
}
