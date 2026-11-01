import { isDesignId } from '../design/schema';
import { SKIN_FORCE_ATTRIBUTE, SKIN_FORCE_COMPACT_ATTRIBUTE, type SkinAssetStatus } from '../design/renderer';
import type { DesignTarget } from '../design/types';
import type { SkinPreview } from '../editor-core/types';
import type { SkinPageInfo } from './skin-panel';
import type { PageMarks } from './page-marks';

const PICKING = 'data-ww-skin-picking',
  SELECTED = 'data-ww-skin-selected';
// Generic native controls; a site adds its own (custom elements, thumbnails) through the adapter.
const CONTROL =
  'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [contenteditable="true"], img';

/** Space between the part's edges and its nearest visible text: a frame wider than this covers text. */
function textInset(element: Element) {
  const box = element.getBoundingClientRect();
  const inset = { top: Infinity, right: Infinity, bottom: Infinity, left: Infinity };
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      inset.top = Math.min(inset.top, rect.top - box.top);
      inset.right = Math.min(inset.right, box.right - rect.right);
      inset.bottom = Math.min(inset.bottom, box.bottom - rect.bottom);
      inset.left = Math.min(inset.left, rect.left - box.left);
    }
  }
  return Number.isFinite(inset.top) ? inset : undefined;
}

export interface SkinHit {
  element: Element;
  /** Undefined: a native control with no skin support (shown as 未対応). */
  target?: DesignTarget;
}

/** Page side of the skin editor. Event-driven only; nothing runs per frame while idle. */
export function createSkinPicker(
  doc: Document,
  targets: readonly DesignTarget[],
  marks: PageMarks,
  siteControls?: string,
  /** The site's SiteAdapter.beneathOverlay: a part under the site's own layer is still framed. */
  beneath?: (node: Element, x: number, y: number) => Element | undefined,
) {
  const controls = siteControls ? `${CONTROL}, ${siteControls}` : CONTROL;
  const parts = targets.filter((target) => target.skin && isDesignId(target.surface));
  const selector = (target: DesignTarget) => `[data-ww-surface~="${target.surface}"]`;
  const root = doc.documentElement;
  let active = false,
    pointer: Element | undefined,
    at = { x: 0, y: 0 },
    request: number | undefined,
    shownKey = '',
    tag = '';
  const hover = marks.mark('web-world-themes-skin-hover');

  const hit = (node: Element | undefined): SkinHit | undefined => {
    if (!node || node.closest('[data-ww-signal-control], [id^="web-world-themes-"]')) return;
    let best: SkinHit | undefined;
    for (const target of parts) {
      const element = node.closest(selector(target));
      // The innermost part wins, e.g. a chip inside a toolbar.
      if (element && (!best || best.element.contains(element))) best = { element, target };
    }
    if (best) return best;
    const control = node.closest(controls);
    return control ? { element: control } : undefined;
  };

  const hide = () => {
    hover.hide();
    shownKey = '';
  };
  const draw = () => {
    request = undefined;
    // Once per frame, and a hit test only while the pointer is on the site's own layer.
    const found = active && pointer ? hit(beneath?.(pointer, at.x, at.y) ?? pointer) : undefined;
    if (!found) return hide();
    const rect = found.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return hide();
    const key = found.target ? found.target.id : 'unsupported';
    if (key !== shownKey) {
      shownKey = key;
      const count = found.target ? doc.querySelectorAll(selector(found.target)).length : 0;
      tag = found.target
        ? `${found.target.label}${count > 1 ? `・ページ上に${count}個` : ''}　クリックで選択`
        : '未対応';
    }
    // A new part under the pointer draws its frame in; the same part only follows scrolling.
    hover.show(rect, found.element, found.target ? 'mark' : 'unsupported', tag);
  };
  const schedule = () => {
    request ??= doc.defaultView!.requestAnimationFrame(draw);
  };
  const onMove = (event: PointerEvent) => {
    const node = event.composedPath()[0];
    pointer = node instanceof Element ? node : undefined;
    at = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const onLeave = (event: PointerEvent) => {
    if (!event.relatedTarget) {
      pointer = undefined;
      schedule();
    }
  };

  const setActive = (value: boolean) => {
    if (value === active) return;
    active = value;
    root.toggleAttribute(PICKING, value);
    if (value) {
      doc.addEventListener('pointermove', onMove, { capture: true, passive: true });
      doc.addEventListener('pointerout', onLeave, { capture: true, passive: true });
      doc.addEventListener('scroll', schedule, { capture: true, passive: true });
    } else {
      doc.removeEventListener('pointermove', onMove, { capture: true });
      doc.removeEventListener('pointerout', onLeave, { capture: true });
      doc.removeEventListener('scroll', schedule, { capture: true });
      pointer = undefined;
      hide();
    }
  };

  return {
    hit,
    setActive,
    /** Static rules from bundled targets: outlines show every part of the selected kind. */
    css: () =>
      parts
        .map(
          (target) =>
            // Ruled, not inked: every part of the kind, wherever it scrolls, without tracking each one.
            `html[${SELECTED}="${target.id}"] ${selector(target)}{outline:1px solid rgb(43 81 184 / 0.5) !important;outline-offset:4px !important;}`,
        )
        .join('\n') + `\nhtml[${PICKING}] body{cursor:crosshair !important;}`,
    /** Outlines are hidden while a forced preview shows the true look. */
    setSelection(targetId: string | undefined, outline: boolean) {
      const value = targetId && outline && parts.some((target) => target.id === targetId) ? targetId : undefined;
      if (value === undefined) root.removeAttribute(SELECTED);
      else if (root.getAttribute(SELECTED) !== value) root.setAttribute(SELECTED, value);
    },
    setPreview(targetId: string | undefined, preview: SkinPreview | undefined) {
      const state = targetId && preview?.state ? `${targetId}:${preview.state}` : undefined;
      const compact = targetId && preview?.compact ? targetId : undefined;
      if (state === undefined) root.removeAttribute(SKIN_FORCE_ATTRIBUTE);
      else if (root.getAttribute(SKIN_FORCE_ATTRIBUTE) !== state) root.setAttribute(SKIN_FORCE_ATTRIBUTE, state);
      if (compact === undefined) root.removeAttribute(SKIN_FORCE_COMPACT_ATTRIBUTE);
      else if (root.getAttribute(SKIN_FORCE_COMPACT_ATTRIBUTE) !== compact)
        root.setAttribute(SKIN_FORCE_COMPACT_ATTRIBUTE, compact);
    },
    /** One query per part, only while the skin tool is open. */
    pageInfo(
      asset: (targetId: string) => SkinAssetStatus | undefined,
      ink: (targetId: string) => SkinPageInfo['ink'] | undefined,
    ): SkinPageInfo[] {
      return parts.map((target) => {
        const elements = doc.querySelectorAll(selector(target));
        let width = 0,
          height = 0,
          minWidth = Infinity,
          minHeight = Infinity,
          first: Element | undefined;
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          if (!first) {
            first = element;
            width = rect.width;
            height = rect.height;
          }
          minWidth = Math.min(minWidth, rect.width);
          minHeight = Math.min(minHeight, rect.height);
        }
        const status = asset(target.id),
          legibility = ink(target.id),
          inset = first && textInset(first);
        return {
          id: target.id,
          count: elements.length,
          ...(elements.length ? { width, height } : {}),
          ...(first ? { minWidth, minHeight } : {}),
          ...(inset ? { textInset: inset } : {}),
          ...(status ? { asset: status } : {}),
          ...(legibility ? { ink: legibility } : {}),
        };
      });
    },
    destroy() {
      setActive(false);
      if (request !== undefined) doc.defaultView?.cancelAnimationFrame(request);
      hide();
      root.removeAttribute(SELECTED);
      root.removeAttribute(SKIN_FORCE_ATTRIBUTE);
      root.removeAttribute(SKIN_FORCE_COMPACT_ATTRIBUTE);
    },
  };
}
