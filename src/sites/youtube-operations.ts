import { createOperationSource, type OperationCandidate } from '../host/operation-source';
import { fixedContainingBlock, nativeAbove, scrollsWithPage } from '../host/operation-composition';

export function youtubeOperations(doc: Document) {
  const player = () => doc.querySelector<HTMLElement>('.html5-video-player, #movie_player');
  const overlaySlot = () => {
    const parent =
      doc.fullscreenElement instanceof HTMLElement ? doc.fullscreenElement : doc.querySelector<HTMLElement>('ytd-app');
    if (!parent) return undefined;
    for (let node: HTMLElement | null = parent; node; node = node.parentElement)
      if (fixedContainingBlock(doc.defaultView!.getComputedStyle(node))) return undefined;
    return { parent, zIndex: 1 };
  };
  return createOperationSource(
    doc,
    () => {
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
          scrolls: scrollsWithPage(root),
          nativeAbove: Boolean(overlay && nativeAbove(root, overlay.parent, overlay.zIndex)),
        });
        // Controls stay reserved while auto-hidden, including focus/preview spill.
        rows.push({
          id: 'player.controls.bottom',
          element: root,
          kind: 'drag',
          scrolls: scrollsWithPage(root),
          envelope: { ...shape, top: r.top + Math.max(0, r.height - 112), height: Math.min(112, r.height) },
        });
        rows.push({
          id: 'player.controls.top',
          element: root,
          kind: 'click',
          scrolls: scrollsWithPage(root),
          envelope: { ...shape, height: Math.min(64, r.height) },
        });
      }
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
        [
          'menu',
          'native-menu',
          '.ytp-popup, .ytp-settings-menu, ytd-menu-popup-renderer, tp-yt-paper-dialog, [role="menu"], [role="dialog"], [role="listbox"], select',
        ],
        [
          'control',
          'click',
          'button, a[role="button"], [role="button"], input, textarea, [contenteditable="true"], [role="slider"]',
        ],
      ];
      const seen = new Set<Element>();
      for (const [id, kind, selector] of selectors) {
        let index = 0;
        for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
          if (seen.has(element) || element.closest('[id^="web-world-themes"]')) continue;
          seen.add(element);
          rows.push({
            id: `${id}.${index++}`,
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
            scrolls: scrollsWithPage(element),
            nativeAbove: Boolean(overlay && nativeAbove(element, overlay.parent, overlay.zIndex)),
            unsupported: kind === 'native-menu' && element.matches('select') && element === doc.activeElement,
          });
        }
      }
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
      if (!overlaySlot()) return undefined;
      const parent = player();
      if (!parent) return undefined;
      // A non-fullscreen fixed player uses the single screen composition. A
      // separate local context could otherwise reorder overlapping anchors.
      if (doc.fullscreenElement !== parent && !scrollsWithPage(parent)) return undefined;
      const menu = [
        ...parent.querySelectorAll<HTMLElement>('.ytp-error, .ytp-ad-player-overlay, .ytp-popup, .ytp-settings-menu'),
      ].some(
        (e) => e.getBoundingClientRect().height > 0 && doc.defaultView!.getComputedStyle(e).visibility !== 'hidden',
      );
      const r = parent.getBoundingClientRect();
      if (menu || r.height <= 176 || r.width <= 0) return undefined;
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
      return { parent, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, top: 64, bottom: 112 };
    },
    overlaySlot,
  );
}
