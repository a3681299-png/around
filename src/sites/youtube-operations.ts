import { createOperationSource, type DiscoveryScan, type OperationCandidate } from '../host/operation-source';
import { createDrawReads, fixedContainingBlock, type CompositionReader } from '../host/operation-composition';
import { LAYERING } from '../host/world-options';
import type { PlacementFrame } from '../world/geometry';

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
  // What YouTube puts over the picture that can be pressed: the end screen's video and channel
  // cards, the autoplay "next" card and its countdown, the info cards' teaser, the products
  // shelf and the advert's own links (the skip button is a button, below). Several are links or
  // focusable boxes rather than buttons, so the generic control selector alone missed them.
  // Over the local plane they are above the artwork by stacking order; elsewhere (a menu, an
  // advert or a central button keeps the local plane off) only these surfaces keep them clear.
  [
    'player.overlay',
    'click',
    '.html5-video-player a[href], .html5-video-player [tabindex]:not([tabindex="-1"]), .ytp-ce-element, .ytp-cards-teaser, .ytp-featured-product, .ytp-suggested-action, .ytp-autonav-endscreen-countdown-overlay',
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
/** YouTube's miniplayer, into which it moves the player (youtube.ts marks the reduced form). */
const MINIPLAYER = 'ytd-miniplayer';

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
  // One draw's styles and stacking chains, shared by its reads (the whole read, the beneath place,
  // the player checks, the pending proofs). Dropped at the end of the task and whenever the
  // document changed since it was made (createDrawReads).
  const reads = createDrawReads(doc);
  // The player, looked up in the whole document only by a whole read (which every added or removed
  // element leads to) or when the one found has left the document. Every draw asks for it (the
  // video slot, the beneath place); the lookup walked the whole page each time, about 1 ms on a
  // watch page (chunk 4 follow-up: CPU profile of the corner character with the bars coming and
  // going, docs/layering-plan.md 「塊4の続き」). A player that appears before the next read is
  // not used until that read: until then the draw has none, which only keeps the plane off.
  const findPlayer = () => doc.querySelector<HTMLElement>('.html5-video-player, #movie_player');
  let knownPlayer: HTMLElement | null | undefined;
  const player = () => {
    if (knownPlayer === undefined || (knownPlayer && !knownPlayer.isConnected)) knownPlayer = findPlayer();
    return knownPlayer;
  };
  const overlaySlot = () => {
    const parent =
      doc.fullscreenElement instanceof HTMLElement ? doc.fullscreenElement : doc.querySelector<HTMLElement>('ytd-app');
    if (!parent) return undefined;
    // Its own reads: the Host shares its answer within the task (verifiedOverlaySlot).
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
    // scrolls(): not in fullscreen and no fixed ancestor, the same test as scrollsWithPage.
    if (doc.fullscreenElement !== parent && !reads.reader().scrolls(parent)) return undefined;
    const menu = [
      ...parent.querySelectorAll<HTMLElement>(
        '.ytp-error, .ytp-ad-player-overlay, .ytp-popup:not(button), .ytp-settings-menu',
      ),
    ].some((e) => e.getBoundingClientRect().height > 0 && reads.reader().style(e).visibility !== 'hidden');
    const r = parent.getBoundingClientRect();
    if (menu || r.height <= 176 || r.width <= 0) return undefined;
    return { parent, r };
  };
  /**
   * Chunk 4 (LAYERING, docs/layering-plan.md). The player is its own stacking context
   * (position:relative; z-index:0) and paints its media at one level (z-index 10) with everything
   * it shows over the picture above it (bars 58/59, menus 73–2300, end screen 36…). A plane
   * inserted directly after the media at the media's level is then under all of that by the
   * browser's own paint order. Only that structure is required here: no menu, advert or central
   * button turns it off. What is not proven to paint over it is checked by the guard as before.
   */
  // `sized`: also a box to draw in. The proofs need only the structure: a read taken while YouTube
  // moves the player (into fullscreen or the miniplayer, its box empty for a moment) still proves
  // its parts, so the next draw is not held for want of a read.
  const beneathPlace = (sized = true) => {
    const why = (reason: string) => {
      WW_GUARD_TRACE: doc.documentElement.setAttribute('data-ww-beneath-place', reason);
      return undefined;
    };
    if (!overlaySlot()) return why('no overlay slot');
    const parent = player();
    if (!parent) return why('no player');
    const composition = reads.reader();
    const style = composition.style(parent);
    if (style.position === 'static' || !Number.isFinite(Number(style.zIndex))) return why('player not a context');
    let media: HTMLElement | undefined;
    for (const child of parent.children)
      if (child instanceof HTMLElement && child.classList.contains('html5-video-container')) media = child;
    if (!media) return why('no media');
    const mediaStyle = composition.style(media);
    const zIndex = Number(mediaStyle.zIndex);
    if (mediaStyle.position === 'static' || !Number.isFinite(zIndex)) return why('media without a level');
    const r = parent.getBoundingClientRect();
    if (sized && (r.height <= 0 || r.width <= 0)) return why('empty player box');
    return { parent, media, zIndex, r };
  };
  /**
   * A control under `root` (inside the player) that is shown and not proven over the plane, as
   * the guard's read would find it: what a class or child change there can have brought out.
   * Only root's own subtree is searched (a bezel wrapper, a bar, the player when its own class
   * changed), never the document. Styles that hide or show a part are what such changes do; the
   * order of the player's parts is proven per control, so an opacity fade changes nothing here.
   */
  /** The stacking proof, the one place it is asked. A development build without it on purpose
   * (WW_NO_STACKING_PROOF=1, scripts/build.mjs) drops the labelled line and takes everything as
   * proven, to see the layering tests fail; every other build keeps the line. */
  const provenOver = (composition: CompositionReader, element: Element, media: HTMLElement) => {
    let proven = true;
    WW_STACKING_PROOF: proven = composition.paintsAbove(element, media);
    return proven;
  };
  const unprovenControls = (
    root: HTMLElement,
    media: HTMLElement,
    composition: CompositionReader,
    near: readonly PlacementFrame[] | undefined,
  ) => {
    const candidates = root.matches(candidateSelector)
      ? [root, ...root.querySelectorAll(candidateSelector)]
      : [...root.querySelectorAll(candidateSelector)];
    return candidates.filter((element) => {
      if (element.closest('[id^="web-world-themes"]') || media.contains(element)) return false;
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      // Only a control near a paint can hold it (the Host's 40 px): one elsewhere needs no proof
      // now, and the next whole read reads it as before. Its box is read first, its styles and
      // stacking chain only when it is near (chunk 4 fix, docs/layering-plan.md 9).
      if (
        near &&
        !near.some((n) => r.left < n.left + n.width && r.right > n.left && r.top < n.top + n.height && r.bottom > n.top)
      )
        return false;
      if (composition.style(element as HTMLElement).visibility === 'hidden') return false;
      return !provenOver(composition, element, media);
    });
  };
  /** The last read's controls over the player's box not proven to paint over the plane: a paint
   * near one of them is held while a read is pending (the ids are for the trace). */
  let beneathRead: { unproven: { id: string; box: PlacementFrame }[] } | undefined;
  return createOperationSource(
    doc,
    (scan) => {
      // Every whole read looks the player up again (a new player, or another one first).
      knownPlayer = findPlayer();
      const composition = reads.reader();
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
          reserved: true,
          envelope: { ...shape, top: r.top + Math.max(0, r.height - 112), height: Math.min(112, r.height) },
        });
        rows.push({
          id: 'player.controls.top',
          element: root,
          kind: 'click',
          scrolls: composition.scrolls(root),
          reserved: true,
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
      // Chunk 4: which surfaces the beneath plane cannot cover. The plane is clipped to the
      // player's box and sits next to the media in paint order, so a surface outside the player
      // either paints over the media (and so over the plane) or under the whole player, where the
      // player already covers it and takes its clicks: only the player's own surfaces need a proof.
      // A player that is not shown (its box empty, not going into fullscreen or the miniplayer:
      // a search or other page over a hidden watch page) carries no paint, so its parts are not
      // proven (chunk 4 fix, docs/layering-plan.md 9, candidate 1). The read after it is shown
      // again (every added or shown part is a page change) proves them; until then a paint there
      // waits for that read ('everywhere'), as at the first read of a page.
      const place = LAYERING ? beneathPlace(false) : undefined;
      const hidden = Boolean(
        place &&
        place.r.width <= 0 &&
        place.r.height <= 0 &&
        !doc.fullscreenElement &&
        !place.parent.closest(MINIPLAYER),
      );
      if (place && !hidden) {
        const p = place.r;
        const unproven: { id: string; box: PlacementFrame }[] = [];
        for (const row of rows) {
          if (row.occlusion === 'allow') continue;
          if (row.element === place.parent) {
            // The player's reserved bands stand for its bars: proven when the bar is.
            const bar = [...place.parent.children].find((c) =>
              c.classList.contains(row.id === 'player.controls.top' ? 'ytp-chrome-top' : 'ytp-chrome-bottom'),
            );
            row.aboveBeneath = Boolean(bar && provenOver(composition, bar, place.media));
          } else if (!place.parent.contains(row.element)) {
            row.aboveBeneath = true;
            continue;
          } else {
            // Every part of the player is proven, shown or not and wherever it is now: the
            // player's box changes (fullscreen, theater, the miniplayer) before the next read, and
            // a part left without a proof would then stop a paint it is drawn over.
            row.aboveBeneath = provenOver(composition, row.element, place.media);
            WW_GUARD_TRACE: {
              const kept = (doc.documentElement.dataset['wwBeneathRows'] ?? '').split('\n').filter(Boolean);
              const note = `${row.id} ${row.element.tagName.toLowerCase()}.${[...row.element.classList].slice(0, 3).join('.')} ${row.aboveBeneath ? 'proven' : 'NOT'}`;
              if (!row.aboveBeneath && !kept.includes(note) && kept.length < 40)
                doc.documentElement.dataset['wwBeneathRows'] = [...kept, note].join('\n');
            }
            // Only one shown over the player's box can be under a paint.
            if (row.visible === false) continue;
            const box = row.envelope ?? row.rect ?? row.element.getBoundingClientRect();
            if (
              box.left >= p.right ||
              box.left + box.width <= p.left ||
              box.top >= p.bottom ||
              box.top + box.height <= p.top
            )
              continue;
          }
          if (!row.aboveBeneath) {
            const r = row.envelope ?? row.rect ?? row.element.getBoundingClientRect();
            unproven.push({
              id: `${row.id} ${row.element.tagName.toLowerCase()}.${row.element.classList[0] ?? ''}`,
              box: { left: r.left, top: r.top, width: r.width, height: r.height },
            });
            // Why it was not proven: the element and its ancestors up to the player as read now,
            // and the media's own level (the trace build only; first 8 kept).
            WW_GUARD_TRACE: {
              // On the document: the plane may not exist yet at the first read.
              const host = doc.documentElement;
              const chain: string[] = [];
              for (let e: Element | null = row.element; e && e !== place.parent; e = e.parentElement) {
                const s = composition.style(e as HTMLElement);
                chain.push(
                  `${e.tagName.toLowerCase()}.${e.classList[0] ?? ''}:${s.position}/${s.zIndex}/${s.opacity}/${s.display}`,
                );
              }
              const media = composition.style(place.media);
              const note = `${performance.now().toFixed(0)}ms ${row.id} [${chain.join(' < ')}] media ${media.position}/${media.zIndex} player ${composition.style(place.parent).zIndex}`;
              const kept = (host.dataset['wwBeneathWhy'] ?? '').split('\n').filter(Boolean);
              if (kept.length < 8 && !kept.some((k) => k.includes(row.id)))
                host.dataset['wwBeneathWhy'] = [...kept, note].join('\n');
            }
          }
        }
        beneathRead = { unproven };
      } else beneathRead = undefined;
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
          reads.reader().style(element).visibility !== 'hidden' &&
          box.bottom > r.top + 64 &&
          box.top < r.bottom - 112
        );
      });
      if (centralControl) return undefined;
      // The media sits in its own positioned container (z-index 10 on YouTube). The local plane
      // goes directly above it, so artwork is over the video yet under every native overlay
      // and control layer; the bands above are clipped and central controls disable it.
      const media = parent.querySelector<HTMLElement>('.html5-video-container');
      const mediaZ = media ? Number.parseInt(reads.reader().style(media).zIndex, 10) : NaN;
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
        // During an advert the player can carry ytp-autohide while the advert's own parts (its
        // badge, links, skip) stay in the bands: they stay clipped then (chunk 3 verification).
        barsKeptClasses: ['ad-showing', 'ad-interrupting'],
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
    undefined,
    (pending, kind, near) => {
      if (!LAYERING) return undefined;
      const place = beneathPlace();
      if (!place) return undefined;
      const { parent, media, zIndex, r } = place;
      const slot = {
        parent,
        after: media,
        zIndex,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      };
      // While a read is pending, where a control not proven to paint over the plane is or may be
      // now: the last read's ones, and the ones the pending changes brought out (only a shown
      // unproven control can be covered; the stacking order covers every other change). Each
      // comes with why, for the guard trace.
      const found: { why: string; box: PlacementFrame }[] = [];
      const everywhere = (() => {
        if (kind === 'none') return false;
        if (!beneathRead) return true;
        for (const { id, box } of beneathRead.unproven) found.push({ why: `unproven ${id}`, box });
        // Searched and proved again on every draw while a read is pending, on purpose: an opacity
        // or transform transition changes the stacking order with no mutation record (the cued
        // thumbnail's fade, docs/layering-plan.md 7), so no record count can say "unchanged". A
        // cache keyed on the page's records was tried and measured: YouTube changes the bars
        // nearly every frame while they show, so it was rebuilt ~80 times in 5 s anyway (chunk 4
        // follow-up, "塊4の続き"). Within the draw, the chains are shared (reads).
        const composition = reads.reader();
        const inPlayer = (root: HTMLElement, why: string) => {
          for (const control of unprovenControls(root, media, composition, near)) {
            const b = control.getBoundingClientRect();
            found.push({
              why: `unproven ${control.tagName}.${control.classList[0] ?? ''} after ${why}`,
              box: { left: b.left, top: b.top, width: b.width, height: b.height },
            });
          }
        };
        // Changes not known one by one (a whole scan is due), or many: the player's own controls.
        if (!pending || pending.length > 64) {
          inPlayer(parent, 'unknown changes');
          return false;
        }
        for (const element of pending) {
          if (!element.isConnected || media.contains(element)) continue;
          // A change of an ancestor (theater, dark mode) re-styles the player's parts too.
          const root = element.contains(parent) ? parent : parent.contains(element) ? element : undefined;
          if (!root || (root === element && provenOver(composition, element, media))) continue;
          // The player's own class (bars shown or hidden, playing, ads…) or a part of it (the
          // bezel's wrapper): what shows there unproven.
          inPlayer(root as HTMLElement, `${element.tagName}.${element.classList[0] ?? ''}`);
          if (root === parent) break;
        }
        return false;
      })();
      // On the extension's own host (its mutations are not the page's): every reason seen so far.
      WW_GUARD_TRACE: if (everywhere || found.length) {
        const host = doc.getElementById('web-world-themes-video-decorations');
        const seen = new Set((host?.dataset['wwBeneathUnsettled'] ?? '').split('|').filter(Boolean));
        for (const why of everywhere ? ['no read'] : found.map((f) => f.why)) seen.add(why);
        host?.setAttribute('data-ww-beneath-unsettled', [...seen].join('|'));
      }
      return {
        ...slot,
        unproven: everywhere ? ('everywhere' as const) : found.map((f) => f.box),
        unprovenShown: beneathRead?.unproven.map((u) => u.box) ?? [],
      };
    },
  );
}
