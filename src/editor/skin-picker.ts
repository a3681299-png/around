import { isDesignId } from '../design/schema';
import { SKIN_FORCE_ATTRIBUTE, SKIN_FORCE_COMPACT_ATTRIBUTE, type SkinAssetStatus } from '../design/renderer';
import type { DesignTarget } from '../design/types';
import type { SkinPreview } from '../editor-core/types';
import type { SkinPageInfo } from './skin-panel';

const PICKING = 'data-ww-skin-picking',
  SELECTED = 'data-ww-skin-selected';
// Generic native controls; a site adds its own (custom elements, thumbnails) through the adapter.
const CONTROL =
  'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [contenteditable="true"], img';

export interface SkinHit {
  element: Element;
  /** Undefined: a native control with no skin support (shown as 未対応). */
  target?: DesignTarget;
}

/** Page side of the skin editor. Event-driven only; nothing runs per frame while idle. */
export function createSkinPicker(doc: Document, targets: readonly DesignTarget[], siteControls?: string) {
  const controls = siteControls ? `${CONTROL}, ${siteControls}` : CONTROL;
  const parts = targets.filter((target) => target.skin && isDesignId(target.surface));
  const selector = (target: DesignTarget) => `[data-ww-surface~="${target.surface}"]`;
  const root = doc.documentElement;
  let active = false,
    pointer: Element | undefined,
    request: number | undefined,
    shownKey = '',
    box: HTMLDivElement | undefined,
    label: HTMLSpanElement | undefined;

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

  const ensureBox = () => {
    if (box) return box;
    box = doc.createElement('div');
    box.id = 'web-world-themes-skin-hover';
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147482999;pointer-events:none;box-sizing:border-box;border-radius:4px;display:none;';
    label = doc.createElement('span');
    label.style.cssText =
      'position:absolute;left:-2px;bottom:100%;margin-bottom:4px;padding:2px 7px;border-radius:5px;font:600 12px/1.5 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 6px #0006;';
    box.append(label);
    (doc.body ?? root).append(box);
    return box;
  };
  const hide = () => {
    if (box) box.style.display = 'none';
    shownKey = '';
  };
  const draw = () => {
    request = undefined;
    const found = active ? hit(pointer) : undefined;
    if (!found) return hide();
    const rect = found.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return hide();
    const element = ensureBox();
    const supported = Boolean(found.target);
    const key = found.target ? found.target.id : 'unsupported';
    if (key !== shownKey) {
      shownKey = key;
      const count = found.target ? doc.querySelectorAll(selector(found.target)).length : 0;
      label!.textContent = found.target
        ? `${found.target.label}${count > 1 ? `・ページ上に${count}個` : ''}　クリックで選択`
        : '未対応：この部品は着せ替えできません';
      label!.style.color = supported ? '#16101f' : '#f1f1f1';
      label!.style.background = supported ? '#baa0f8' : '#55545f';
      element.style.border = supported ? '2px solid #baa0f8' : '2px dashed #8d8b99';
      element.style.background = supported ? '#baa0f81f' : '#00000014';
    }
    element.style.display = 'block';
    element.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    // Keep the name readable at the top edge of the window.
    label!.style.top = rect.top < 26 ? '100%' : '';
    label!.style.bottom = rect.top < 26 ? '' : '100%';
    label!.style.marginTop = rect.top < 26 ? '4px' : '';
  };
  const schedule = () => {
    request ??= doc.defaultView!.requestAnimationFrame(draw);
  };
  const onMove = (event: PointerEvent) => {
    const node = event.composedPath()[0];
    pointer = node instanceof Element ? node : undefined;
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
            `html[${SELECTED}="${target.id}"] ${selector(target)}{outline:2px dashed #baa0f8 !important;outline-offset:2px !important;}`,
        )
        .join('\n') +
      `\nhtml[${PICKING}] body{cursor:crosshair !important;}` +
      // A forced preview shows the true look, without the editor's selection outline.
      `\nhtml[data-ww-editing]:is([${SKIN_FORCE_ATTRIBUTE}],[${SKIN_FORCE_COMPACT_ATTRIBUTE}]) [data-ww-editor-selected]{outline:none !important;}`,
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
    pageInfo(asset: (targetId: string) => SkinAssetStatus | undefined): SkinPageInfo[] {
      return parts.map((target) => {
        const elements = doc.querySelectorAll(selector(target));
        let width = 0,
          height = 0;
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          if (rect.width && rect.height) {
            width = rect.width;
            height = rect.height;
            break;
          }
        }
        const status = asset(target.id);
        return {
          id: target.id,
          count: elements.length,
          ...(elements.length ? { width, height } : {}),
          ...(status ? { asset: status } : {}),
        };
      });
    },
    destroy() {
      setActive(false);
      if (request !== undefined) doc.defaultView?.cancelAnimationFrame(request);
      box?.remove();
      box = undefined;
      root.removeAttribute(SELECTED);
      root.removeAttribute(SKIN_FORCE_ATTRIBUTE);
      root.removeAttribute(SKIN_FORCE_COMPACT_ATTRIBUTE);
    },
  };
}
