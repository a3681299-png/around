/** Conservative stacking proof. No native styles/parents are changed. */
export function fixedContainingBlock(style: CSSStyleDeclaration): boolean {
  return (
    [
      style.transform,
      style.translate,
      style.rotate,
      style.scale,
      style.perspective,
      style.filter,
      style.backdropFilter,
    ].some((v) => Boolean(v && v !== 'none')) ||
    /transform|filter|perspective/.test(style.willChange) ||
    /layout|paint|strict|content/.test(style.contain)
  );
}
export function nativeAbove(element: HTMLElement, root: HTMLElement, zIndex: number): boolean {
  if (!root.contains(element) || element === root) return false;
  let rank = 0;
  for (let current: HTMLElement | null = element; current && current !== root; current = current.parentElement) {
    const style = current.ownerDocument.defaultView!.getComputedStyle(current);
    if (
      style.zIndex !== 'auto' ||
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      fixedContainingBlock(style) ||
      Number(style.opacity) < 1 ||
      style.isolation === 'isolate' ||
      style.mixBlendMode !== 'normal' ||
      style.clipPath !== 'none' ||
      style.maskImage !== 'none' ||
      style.transformStyle === 'preserve-3d' ||
      style.containerType !== 'normal' ||
      style.willChange !== 'auto'
    ) {
      // The outermost context below the common root determines paint order.
      // Static/flex special cases and unknown contexts fall back to exclusion.
      rank =
        style.position !== 'static' && style.zIndex !== 'auto' && Number.isFinite(Number(style.zIndex))
          ? Number(style.zIndex)
          : 0;
    }
  }
  return rank > zIndex;
}
export function scrollsWithPage(element: HTMLElement): boolean {
  const doc = element.ownerDocument;
  if (doc.fullscreenElement?.contains(element)) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement)
    if (doc.defaultView!.getComputedStyle(current).position === 'fixed') return false;
  return true;
}

/** A single, synchronous DOM read. Never retain computed facts across updates. */
export function createCompositionReader(doc: Document) {
  const styles = new WeakMap<HTMLElement, CSSStyleDeclaration>();
  const fixed = new WeakMap<HTMLElement, boolean>();
  const ranks = new WeakMap<HTMLElement, { found: boolean; rank: number }>();
  const scrollers = new WeakMap<HTMLElement, HTMLElement | null>();
  const stickies = new WeakMap<HTMLElement, HTMLElement | null>();
  const stickyAncestor = (element: HTMLElement): HTMLElement | null => {
    const cached = stickies.get(element);
    if (cached !== undefined) return cached;
    const value =
      style(element).position === 'sticky'
        ? element
        : element.parentElement
          ? stickyAncestor(element.parentElement)
          : null;
    stickies.set(element, value);
    return value;
  };
  let rankRoot: HTMLElement | undefined;
  const style = (element: HTMLElement) => {
    let value = styles.get(element);
    if (!value) {
      value = doc.defaultView!.getComputedStyle(element);
      styles.set(element, value);
    }
    return value;
  };
  const fixedAncestor = (element: HTMLElement): boolean => {
    const cached = fixed.get(element);
    if (cached !== undefined) return cached;
    const value =
      Boolean(element.parentElement && fixedAncestor(element.parentElement)) || style(element).position === 'fixed';
    fixed.set(element, value);
    return value;
  };
  const rank = (element: HTMLElement, root: HTMLElement): { found: boolean; rank: number } => {
    if (element === root) return { found: false, rank: 0 };
    const cached = ranks.get(element);
    if (cached) return cached;
    const parent = element.parentElement;
    const above = parent ? rank(parent, root) : { found: false, rank: 0 };
    // The outermost context below root owns the whole subtree's paint order.
    if (above.found) {
      ranks.set(element, above);
      return above;
    }
    const s = style(element);
    const found =
      s.zIndex !== 'auto' ||
      s.position === 'fixed' ||
      s.position === 'sticky' ||
      fixedContainingBlock(s) ||
      Number(s.opacity) < 1 ||
      s.isolation === 'isolate' ||
      s.mixBlendMode !== 'normal' ||
      s.clipPath !== 'none' ||
      s.maskImage !== 'none' ||
      s.transformStyle === 'preserve-3d' ||
      s.containerType !== 'normal' ||
      s.willChange !== 'auto';
    const value = {
      found,
      rank:
        found && s.position !== 'static' && s.zIndex !== 'auto' && Number.isFinite(Number(s.zIndex))
          ? Number(s.zIndex)
          : 0,
    };
    ranks.set(element, value);
    return value;
  };
  // An element that clips overflowing content can move its descendants without the page
  // moving. Hidden overflow counts too: script may still scroll it.
  const nearestScroller = (element: HTMLElement): HTMLElement | null => {
    const parent = element.parentElement;
    if (!parent || parent === doc.body || parent === doc.documentElement) return null;
    const cached = scrollers.get(parent);
    if (cached !== undefined) return cached;
    const s = style(parent);
    const value =
      [s.overflowX, s.overflowY].some((v) => v === 'auto' || v === 'scroll' || v === 'hidden') &&
      (parent.scrollWidth > parent.clientWidth || parent.scrollHeight > parent.clientHeight)
        ? parent
        : nearestScroller(parent);
    scrollers.set(parent, value);
    return value;
  };
  return {
    style,
    scrollBox(element: HTMLElement) {
      // A stuck element moves against the page along its whole column.
      const sticky = stickyAncestor(element);
      if (sticky) {
        const r = sticky.getBoundingClientRect();
        return { left: r.left - 4, top: -1e7, width: r.width + 8, height: 2e7 };
      }
      const scroller = nearestScroller(element);
      if (!scroller) return undefined;
      const r = scroller.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    scrolls(element: HTMLElement) {
      return !doc.fullscreenElement?.contains(element) && !fixedAncestor(element);
    },
    above(element: HTMLElement, root: HTMLElement, zIndex: number) {
      if (rankRoot !== root) {
        // A read has one overlay root. Reject accidental reuse with another root.
        if (rankRoot) return nativeAbove(element, root, zIndex);
        rankRoot = root;
      }
      return element !== root && root.contains(element) && rank(element, root).rank > zIndex;
    },
  };
}
