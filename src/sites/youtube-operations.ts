import { createOperationSource, type DiscoveryScan, type OperationCandidate } from '../host/operation-source';
import { createCompositionReader, fixedContainingBlock, scrollsWithPage } from '../host/operation-composition';

const selectors: [string, OperationCandidate['kind'], string][] = [
  ['player.seek', 'drag', '.ytp-progress-bar-container, .ytp-progress-bar'],
  ['player.volume', 'drag', '.ytp-volume-panel, .ytp-volume-slider'],
  ['search', 'text-input', 'ytd-searchbox, yt-searchbox'],
  ['comment', 'text-input', 'ytd-comment-simplebox-renderer, ytd-comments [contenteditable="true"]'],
  [
    'navigation',
    'click',
    'ytd-guide-entry-renderer a[href], ytd-mini-guide-entry-renderer a[href], ytd-masthead a[href]',
  ],
  // The player's unmute button also carries ytp-popup; it is a button, not a menu over the window.
  [
    'menu',
    'native-menu',
    '.ytp-popup:not(button), .ytp-settings-menu, ytd-menu-popup-renderer, tp-yt-paper-dialog, [role="menu"], [role="dialog"], [role="listbox"], select',
  ],
  [
    'control',
    'click',
    'button, a[role="button"], [role="button"], input, textarea, [contenteditable="true"], [role="slider"]',
  ],
];
// One document traversal finds every candidate; each element then belongs to the first
// selector (in this order) that matches it, exactly as when each selector had its own query.
const candidateSelector = selectors.map(([, , selector]) => selector).join(', ');

/**
 * The elements any selector can match, kept in document order between reads. A whole-document
 * query only runs for a full scan; otherwise the inserted subtrees and attribute-changed
 * elements the source reported are the only places the candidate set can have changed.
 */
function createCandidateIndex(doc: Document) {
  let ordered: HTMLElement[] | undefined;
  const byDocumentOrder = (a: Element, b: Element) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  return (scan: DiscoveryScan): readonly HTMLElement[] => {
    if (scan.full || !ordered) return (ordered = [...doc.querySelectorAll<HTMLElement>(candidateSelector)]);
    const members = new Set(ordered.filter((element) => element.isConnected));
    let reorder = false;
    const include = (element: HTMLElement) => {
      if (members.has(element)) reorder = true;
      else (members.add(element), (reorder = true));
    };
    for (const root of scan.added) {
      if (!root.isConnected) continue;
      if (root.matches(candidateSelector)) include(root as HTMLElement);
      for (const element of root.querySelectorAll<HTMLElement>(candidateSelector)) include(element);
    }
    for (const element of scan.touched as readonly HTMLElement[]) {
      if (!element.isConnected) continue;
      if (!element.matches(candidateSelector)) members.delete(element);
      else if (!members.has(element)) include(element);
    }
    ordered = [...members];
    if (reorder) ordered.sort(byDocumentOrder);
    return ordered;
  };
}

export function youtubeOperations(doc: Document) {
  const candidates = createCandidateIndex(doc);
  const player = () => doc.querySelector<HTMLElement>('.html5-video-player, #movie_player');
  const overlaySlot = () => {
    const parent =
      doc.fullscreenElement instanceof HTMLElement ? doc.fullscreenElement : doc.querySelector<HTMLElement>('ytd-app');
    if (!parent) return undefined;
    for (let node: HTMLElement | null = parent; node; node = node.parentElement)
      if (fixedContainingBlock(doc.defaultView!.getComputedStyle(node))) return undefined;
    return { parent, zIndex: 1 };
  };
  /** The player when its centre is the native video gesture: no menu, error or advert over it,
   * tall enough for both control bands, and scrolling with the page (or fullscreen). */
  const verifiedPlayer = () => {
    if (!overlaySlot()) return undefined;
    const parent = player();
    if (!parent) return undefined;
    // A non-fullscreen fixed player uses the single screen composition. A
    // separate local context could otherwise reorder overlapping anchors.
    if (doc.fullscreenElement !== parent && !scrollsWithPage(parent)) return undefined;
    const menu = [
      ...parent.querySelectorAll<HTMLElement>(
        '.ytp-error, .ytp-ad-player-overlay, .ytp-popup:not(button), .ytp-settings-menu',
      ),
    ].some((e) => e.getBoundingClientRect().height > 0 && doc.defaultView!.getComputedStyle(e).visibility !== 'hidden');
    const r = parent.getBoundingClientRect();
    if (menu || r.height <= 176 || r.width <= 0) return undefined;
    return { parent, r };
  };
  return createOperationSource(
    doc,
    (scan) => {
      const composition = createCompositionReader(doc);
      const rows: OperationCandidate[] = [];
      const root = player(),
        overlay = overlaySlot();
      if (root) {
        const r = root.getBoundingClientRect(),
          shape = { left: r.left, top: r.top, width: r.width, height: r.height };
        rows.push({
          id: 'player.video',
          element: root,
          kind: 'gesture',
          envelope: shape,
          occlusion: 'allow',
          scrolls: composition.scrolls(root),
          nativeAbove: Boolean(overlay && composition.above(root, overlay.parent, overlay.zIndex)),
        });
        // Controls stay reserved while auto-hidden, including focus/preview spill.
        rows.push({
          id: 'player.controls.bottom',
          element: root,
          kind: 'drag',
          scrolls: composition.scrolls(root),
          envelope: { ...shape, top: r.top + Math.max(0, r.height - 112), height: Math.min(112, r.height) },
        });
        rows.push({
          id: 'player.controls.top',
          element: root,
          kind: 'click',
          scrolls: composition.scrolls(root),
          envelope: { ...shape, height: Math.min(64, r.height) },
        });
      }
      const seen = new Set<Element>();
      const buckets = selectors.map(() => [] as HTMLElement[]);
      for (const element of candidates(scan)) {
        if (element.closest('[id^="web-world-themes"]')) continue;
        seen.add(element);
        buckets[selectors.findIndex(([, , selector]) => element.matches(selector))]!.push(element);
      }
      selectors.forEach(([id, kind], bucket) => {
        buckets[bucket]!.forEach((element, index) => {
          const r = element.getBoundingClientRect();
          const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
          const visible = r.width > 0 && r.height > 0 && composition.style(element).visibility !== 'hidden';
          rows.push({
            id: `${id}.${index}`,
            kind: element.matches('input[type="range"],[role="slider"]') ? 'drag' : kind,
            element,
            ...(kind === 'native-menu'
              ? {
                  envelope: {
                    left: 0,
                    top: 0,
                    width: doc.defaultView!.innerWidth,
                    height: doc.defaultView!.innerHeight,
                  },
                }
              : {}),
            rect,
            visible,
            scrolls: visible ? composition.scrolls(element) : true,
            ...((box) => (box ? { scrollBox: box } : {}))(visible ? composition.scrollBox(element) : undefined),
            nativeAbove: Boolean(visible && overlay && composition.above(element, overlay.parent, overlay.zIndex)),
            unsupported: kind === 'native-menu' && element.matches('select') && element === doc.activeElement,
          });
        });
      });
      const active = doc.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== doc.body &&
        active !== root &&
        !seen.has(active) &&
        !active.closest('[id^="web-world-themes"]')
      )
        rows.push({ id: 'native.focus', kind: 'gesture', element: active });
      return overlay
        ? rows
        : [{ id: 'composition.unavailable', kind: 'gesture', element: doc.documentElement, unsupported: true }];
    },
    () => {
      const verified = verifiedPlayer();
      if (!verified) return undefined;
      const { parent, r } = verified;
      // The center is native gesture space; explicit editor ownership may only
      // replace that gesture, never another native button/input placed here.
      const centralControl = [
        ...parent.querySelectorAll<HTMLElement>('button,[role="button"],input,[role="slider"]'),
      ].some((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          doc.defaultView!.getComputedStyle(element).visibility !== 'hidden' &&
          box.bottom > r.top + 64 &&
          box.top < r.bottom - 112
        );
      });
      if (centralControl) return undefined;
      // The media sits in its own positioned container (z-index 10 on YouTube). The local plane
      // goes directly above it, so artwork is over the video yet under every native overlay
      // and control layer; the bands above are clipped and central controls disable it.
      const media = parent.querySelector<HTMLElement>('.html5-video-container');
      const mediaZ = media ? Number.parseInt(doc.defaultView!.getComputedStyle(media).zIndex, 10) : NaN;
      return {
        parent,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        top: 64,
        bottom: 112,
        zIndex: Number.isFinite(mediaZ) ? mediaZ + 1 : 1,
        // YouTube puts ytp-autohide on the player while it hides both control bars (playing, no
        // pointer or key for a while). It is removed before the bars fade in: on pointer moves,
        // keys, pause, ads and end screens. The bands are then clipped again (see videoSlot).
        barsHiddenClass: 'ytp-autohide',
      };
    },
    overlaySlot,
    () => {
      if (doc.fullscreenElement) return undefined;
      const verified = verifiedPlayer();
      if (!verified) return undefined;
      const { r } = verified;
      return { left: r.left, top: r.top + 64, width: r.width, height: r.height - 176 };
    },
    // D11: an inserted subtree with no element any selector can match adds no control. The same
    // test as incremental discovery's, on the inserted subtree only.
    (root, deep = true) => root.matches(candidateSelector) || (deep && Boolean(root.querySelector(candidateSelector))),
  );
}
