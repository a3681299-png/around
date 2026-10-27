// UI1.1 frame-method comparison on the real YouTube DOM. Bundled by scripts/ui1/methods.mjs and
// evaluated in an extension-free page; it marks one visible element per part and applies one
// candidate drawing method at a time through a test-only stylesheet.
import { YOUTUBE_SKIN_MARKS } from '../../src/sites/youtube-targets';
import { isYouTubeVideoCard, VIDEO_CARD_SELECTOR } from '../../src/sites/youtube-cards';

type Method = 'inset' | 'outset' | 'overlay';
const WIDTH = 6;
const scope = globalThis as typeof globalThis & { __ui1Methods?: unknown };

function elementsOf(part: string): Element[] {
  if (part === 'video-card') return [...document.querySelectorAll(VIDEO_CARD_SELECTOR)].filter(isYouTubeVideoCard);
  const mark = YOUTUBE_SKIN_MARKS.find((item) => item.part === part);
  return mark ? [...document.querySelectorAll(mark.selector)] : [];
}
const rects = (root: Element) =>
  [root, ...root.querySelectorAll('*')].slice(0, 400).map((node) => {
    const r = node.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
const textRects = (root: Element) => {
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    out.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
  }
  return out;
};

scope.__ui1Methods = {
  parts: () => YOUTUBE_SKIN_MARKS.map((mark) => mark.part).concat('video-card'),
  /** Marks the first visible element of the part and returns its baseline. */
  pick(part: string) {
    document.querySelectorAll('[data-ui1-method]').forEach((node) => node.removeAttribute('data-ui1-method'));
    const element = elementsOf(part).find((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.setAttribute('data-ui1-method', '');
    return true;
  },
  /** Applies one method; returns geometry, hits, text and neighbour checks. */
  apply(method: Method | 'none', url: string) {
    const element = document.querySelector('[data-ui1-method]')!;
    const style =
      (document.getElementById('ui1-method-style') as HTMLStyleElement | null) ?? document.createElement('style');
    style.id = 'ui1-method-style';
    document.head.append(style);
    const before = rects(element),
      box = element.getBoundingClientRect();
    const points = [
      [0.5, 0.5],
      [0.05, 0.05],
      [0.95, 0.05],
      [0.05, 0.95],
      [0.95, 0.95],
    ].map(([x, y]) => [box.x + box.width * x!, box.y + box.height * y!] as const);
    const hitsBefore = points.map(([x, y]) => document.elementFromPoint(x, y));
    const image = `url("${url}") 24 / ${WIDTH}px`;
    const staticBox = getComputedStyle(element).position === 'static';
    style.textContent =
      method === 'inset'
        ? `[data-ui1-method]{border-image:${image} / 0 stretch !important;}`
        : method === 'outset'
          ? `[data-ui1-method]{border-image:${image} / ${WIDTH}px stretch !important;}`
          : method === 'overlay'
            ? `[data-ui1-method]{${staticBox ? 'position:relative !important;' : ''}}[data-ui1-method]::before{content:"" !important;position:absolute !important;inset:0 !important;pointer-events:none !important;border-image:${image} / 0 stretch !important;}`
            : '';
    const after = rects(element);
    const moved = Math.max(0, ...after.flatMap((r, i) => r.map((v, j) => Math.abs(v - before[i]![j]!))));
    const hitsAfter = points.map(([x, y]) => document.elementFromPoint(x, y));
    // Text within the drawn band (inside for inset/overlay; outset draws outside the box).
    const band = method === 'outset' ? 0 : WIDTH;
    const touching = textRects(element).filter(
      (r) =>
        r.left < box.left + band ||
        r.right > box.right - band ||
        r.top < box.top + band ||
        r.bottom > box.bottom - band,
    ).length;
    // Outset paints over whatever lies in the 6px ring outside the box.
    let neighbours = 0;
    if (method === 'outset')
      for (const [x, y] of [
        [box.left - 3, box.top + box.height / 2],
        [box.right + 3, box.top + box.height / 2],
        [box.left + box.width / 2, box.top - 3],
        [box.left + box.width / 2, box.bottom + 3],
      ] as const) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !element.contains(hit) && !hit.contains(element) && hit.closest('button,a,input,[role],[tabindex]'))
          neighbours++;
      }
    return {
      method,
      staticBox,
      box: [box.x, box.y, box.width, box.height],
      descendantsMovedPx: moved,
      hitsSame: hitsAfter.every((hit, i) => hit === hitsBefore[i]),
      textInBand: touching,
      operableNeighboursUnderOutset: neighbours,
      ownPseudo: [getComputedStyle(element, '::before').content, getComputedStyle(element, '::after').content],
    };
  },
  clear() {
    document.getElementById('ui1-method-style')?.remove();
  },
};
