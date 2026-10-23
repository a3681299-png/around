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
