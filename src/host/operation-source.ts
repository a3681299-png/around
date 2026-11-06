import type { OperationSnapshot, OperationSurface } from '../world/operations';
import type { PlacementFrame } from '../world/geometry';
import { scrollsWithPage } from './operation-composition';
import { g11CaptureEnd, g11CaptureStart } from '../diagnostics/g11-hooks';
import { ANSWER_CHECK_MS, COALESCE_MS, SWEEP_GROUPS, TRUST_MS, createAnswerCheck } from './answer-check';
import {
  traceGeometryCause,
  traceGeometryRead,
  traceMissedInput,
  traceMovedInput,
  traceSkipSweep,
  traceSubtreeCheck,
  traceSweep,
} from './guard-trace';

/** Attributes a site selector may test; a change can add or drop a candidate by itself. */
const MATCHING_ATTRIBUTES = new Set(['class', 'role', 'href', 'contenteditable']);
/** A mutation burst this large is cheaper to answer with a whole-document scan. */
const MAX_INCREMENTAL_ROOTS = 64;
/** Bounds how long a change the observer could not describe can go unnoticed. */
const FULL_SCAN_INTERVAL_MS = 1000;
export { COALESCE_MS };
/** A look change (class/style) above more controls than this is treated as a layout change. The
 * player's own class (its controls shown or auto-hidden) sits above about 40 of them (round 2). */
const MAX_LOOK_ROWS = 64;
/** The two attributes a control's look changes through (hover marks, inline styles). The others
 * the observer sees (hidden, disabled, aria-*, role, tabindex, contenteditable, href) can show,
 * hide, open or change what a control is, so they always count as a layout change. */
const LOOK_ATTRIBUTES = new Set(['class', 'style']);
/** subtree (G1.3, D11): elements were added or removed where no read control is, and none of the
 * added ones can be a control. Everything is hidden until the next read checks those subtrees. */
export type PendingChange = 'none' | 'scroll' | 'look' | 'subtree' | 'layout';
const RANK: Record<PendingChange, number> = { none: 0, scroll: 1, look: 2, subtree: 3, layout: 4 };
/** Sticky columns are read as unbounded boxes (±1e7); they never move with a page scroll. */
const UNBOUNDED_BOX = 1e6;
/** Document coordinates are compared at 1/100 px, below any rounding a scroll can introduce. */
const round = (value: number) => Math.round(value * 100) / 100;
/** `frame` moved by (-dx, -dy): where a box that scrolls with the page is after the page scrolled
 * by (dx, dy). */
const moved = (frame: PlacementFrame, dx: number, dy: number) =>
  Object.freeze({ left: frame.left - dx, top: frame.top - dy, width: frame.width, height: frame.height });
/** Snapshots from older callers carry no layout generation; their geometry stands in. */
export const layoutOf = (snapshot: OperationSnapshot) => snapshot.generation.layout ?? snapshot.generation.geometry;

let nextDocumentId = 0;
const documentIds = new WeakMap<Document, number>();

export interface OperationCandidate {
  id: string;
  element: HTMLElement;
  kind: OperationSurface['kind'];
  envelope?: PlacementFrame;
  occlusion?: 'allow';
  scrolls?: boolean;
  unsupported?: boolean;
  nativeAbove?: boolean;
  /** Proven to paint over the beneath plane by stacking order (chunk 4, LAYERING). */
  aboveBeneath?: boolean;
  /** Kept for native controls whether or not one is shown (the player's bands). */
  reserved?: boolean;
  /** Optional readings from the adapter's same synchronous discovery pass. */
  rect?: PlacementFrame;
  visible?: boolean;
  /** Clip box of an inner scroll container, when the candidate is inside one. */
  scrollBox?: PlacementFrame;
}
/** What changed since the adapter's previous discovery. */
export interface DiscoveryScan {
  /** Enumerate the whole document: first read, input check, overflow or periodic sweep. */
  full: boolean;
  /** Subtree roots inserted into the document. */
  added: readonly Element[];
  /** Elements whose class/role/href/contenteditable changed, so their own match may differ. */
  touched: readonly Element[];
}
export interface OperationSource {
  active(value: boolean): void;
  subscribe(listener: () => void): () => void;
  /** coalesce: the caller holds drawing while a burst of changes is pending (see COALESCE_MS).
   * fresh: an input-time read of the whole document that never trusts a cached snapshot. */
  capture(options?: { coalesce?: boolean; fresh?: boolean }): OperationSnapshot;
  validate(snapshot: OperationSnapshot, event?: Event): boolean;
  /** Milliseconds until a pending layout change may be read; 0 when the last capture is current or
   * only a page scroll or a checked look change is pending (those reads are shifted, G1.3). */
  deferredFor(): number;
  /** Milliseconds until a pending change of any kind is read again. */
  settlesIn(): number;
  /** Milliseconds until the last read is no longer trusted without checking every group (TRUST_MS
   * after the oldest group's check), 0 once it is past; undefined before the first read. A read
   * past it checks the page, so artwork drawn from it is rechecked then even if nothing redraws
   * (G1.4). */
  trustExpiresIn(): number | undefined;
  /** The kind of change since the last read. */
  pending(): PendingChange;
  /** While only looks changed: the envelopes of those controls, where they are now. */
  lookRegions(): readonly PlacementFrame[];
  /** zIndex: the local plane's order inside the player, just above its media and below its UI. */
  videoSlot():
    | {
        parent: HTMLElement;
        rect: PlacementFrame;
        top: number;
        bottom: number;
        zIndex: number;
        /** A class the player carries exactly while its control bars are hidden. While the
         * player has it, the bands hold no visible control and the local plane may paint there;
         * the moment the class goes (the bars appear), the band clip is back in the same style
         * recalculation, so no frame can show artwork over a shown bar. Absent: always clipped. */
        barsHiddenClass?: string;
        /** Classes under which the bands stay clipped even with barsHiddenClass: the player
         * shows something of its own there then (an advert's parts while its bars are hidden,
         * docs/chunk3-verification.md). Decided by the same style recalculation. */
        barsKeptClasses?: readonly string[];
      }
    | undefined;
  overlaySlot(): { parent: HTMLElement; zIndex: number } | undefined;
  /** Chunk 4 (LAYERING, docs/layering-plan.md): a place inside the player's own stacking
   * context, directly after its media and at the media's level, so that whatever the player paints
   * over its picture is painted over this plane too, by the browser's stacking order. */
  beneathSlot?(near?: readonly PlacementFrame[]): BeneathSlot | undefined;
  /** The extension changed the page's structure (inserted, moved or removed one of its hosts):
   * the reads shared within this draw (the overlay slot, the adapter's composition reads) are
   * dropped, so no later read in the same task decides on a page from before the write. */
  wrote?(): void;
  /** A place under the page's content for atmosphere layers, when the adapter owns the page's
   * stacking (the Playground). Undefined on sites we only decorate (YouTube): there, atmosphere
   * stays over the content with its opacity cap. Drawn under the content, it covers nothing. */
  underlaySlot(): { parent: HTMLElement; zIndex: number } | undefined;
  /** Explicit editing only: the player's video centre (minus its control bands) while no menu,
   * error or advert covers it. Unlike videoSlot it stays available when native controls appear in
   * the centre; those are cut from the clip and refused at input time instead. */
  editorCentre(): PlacementFrame | undefined;
  /** The overlay parent when a child placed at the document origin scrolls with the page. */
  pageSlot(): { parent: HTMLElement; zIndex: number } | undefined;
  destroy(): void;
}
export interface BeneathSlot {
  /** The stacking context (the player); the plane is its child. */
  parent: HTMLElement;
  /** The plane is inserted directly after this child (the media) and takes its level. */
  after: HTMLElement;
  zIndex: number;
  rect: PlacementFrame;
  /** While a read is pending: where a control not proven to paint over the plane is, or may have
   * been brought out by the pending changes ('everywhere' when that cannot be told). A paint near
   * none of these needs no hold while the read is pending; the stacking order covers the rest. */
  unproven: readonly PlacementFrame[] | 'everywhere';
  /** The last read's shown controls over the player's box that are not proven to paint over the
   * plane (the autoplay card at the end, a thumbnail's play button while it fades). Artwork that
   * meets one is drawn the cut-out way instead: the stacking order cannot keep that control clear. */
  unprovenShown: readonly PlacementFrame[];
}
/** DOM identities stay here; the site adapter alone supplies discovery/selectors. */
export function createOperationSource(
  doc: Document,
  discover: (scan: DiscoveryScan) => readonly OperationCandidate[],
  videoSlot: OperationSource['videoSlot'],
  overlaySlot: OperationSource['overlaySlot'] = () => ({ parent: doc.body ?? doc.documentElement, zIndex: 2147482000 }),
  editorCentre: OperationSource['editorCentre'] = () => undefined,
  /** The adapter's candidate test for an inserted subtree (the same selectors its incremental
   * discovery uses). Without it, every element added or removed is a layout change. */
  holdsCandidate?: (root: Element, deep?: boolean) => boolean,
  underlaySlot: OperationSource['underlaySlot'] = () => undefined,
  /** Chunk 4: given the elements changed since the last read (undefined: not known,
   * a whole scan is due), the adapter's beneath place. `near`: where the paints are, already
   * widened by the distance at which a control counts as near them (BENEATH_NEAR_PX); a control
   * elsewhere needs no proof for a pending read (the next whole read still reads it). */
  beneathSlot: (
    pending: readonly Element[] | undefined,
    kind: PendingChange,
    near?: readonly PlacementFrame[],
  ) => BeneathSlot | undefined = () => undefined,
  /** Drops the adapter's reads shared within one draw (createDrawReads) when the extension writes. */
  dropReads?: () => void,
): OperationSource {
  if (!documentIds.has(doc)) documentIds.set(doc, ++nextDocumentId);
  const documentId = documentIds.get(doc)!;
  const issued = new WeakSet<OperationSnapshot>();
  let generation = 0,
    previous = '',
    layoutGeneration = 0,
    previousLayout = '',
    /** The rows' identities at the last whole read; a replaced box keeps them. */
    readIdentity: readonly unknown[] = [],
    rows: readonly OperationCandidate[] = [],
    dragging: Element | undefined,
    captured: Element | undefined;
  const identities = new WeakMap<Element, number>();
  let observed = new Set<HTMLElement>();
  let dirty = true,
    cached: OperationSnapshot | undefined;
  const listeners = new Set<() => void>();
  let readActive: Element | null = null,
    readFocus = false;
  let fullScan = true,
    lastFullScan = -Infinity,
    forced = false,
    capturedAt = -Infinity,
    deferredUntil = 0;
  /** Each group's last check (a whole read checks them all). Unlike `capturedAt`, they do not move
   * the coalescing window; a read is only as current as the oldest of them. */
  const answer = createAnswerCheck();
  const added = new Set<Element>(),
    touched = new Set<Element>();
  /** What changed since the last read (G1.3), in rising order: nothing that moves a surface
   * (focus, pointer state); only the page scrolled, which moves every surface that scrolls with it
   * by the same amount; the look of a few controls changed while their boxes stayed (checked when
   * the change arrives); or anything that can move surfaces around. Only the last keeps callers
   * waiting for a read (deferredFor). */
  let pending: PendingChange = 'none';
  const changedLooks = new Set<HTMLElement>();
  /** Per element, the rows read for it at the last read, with what a look change may not alter. */
  let readRows = new Map<
    Element,
    {
      id: string;
      rect: PlacementFrame;
      visible: boolean;
      disabled: boolean;
      scrolls: boolean;
      /** In a sticky column: stuck or travelling at any scroll, so its height in the page is free. */
      sticky: boolean;
      plain: boolean;
    }[]
  >();
  /** What else arrived since the read, for when a subtree check lowers the pending kind again. */
  let sawScroll = false,
    sawLook = false;
  const raise = (kind: PendingChange) => {
    if (kind === 'scroll') sawScroll = true;
    if (kind === 'look') sawLook = true;
    if (RANK[kind] <= RANK[pending]) return false;
    pending = kind;
    return true;
  };
  const collect = (records: readonly MutationRecord[]) => {
    for (const r of records) {
      if (fullScan) return;
      if (!(r.target instanceof Element)) {
        fullScan = true;
        return;
      }
      if (r.target.closest('[id^="web-world-themes"]')) continue;
      if (r.type === 'attributes') {
        if (MATCHING_ATTRIBUTES.has(r.attributeName ?? '')) touched.add(r.target);
      } else
        for (const node of r.addedNodes)
          if (node instanceof Element && !node.id.startsWith('web-world-themes')) added.add(node);
      if (added.size + touched.size > MAX_INCREMENTAL_ROOTS) {
        fullScan = true;
        added.clear();
        touched.clear();
      }
    }
  };
  // Focus and pointer state never move a surface; only geometry changes are coalesced.
  let geometryDirty = false;
  /** Resize, fonts and ResizeObserver (a surface's size changed): anything may have moved. */
  const changed = () => {
    // The trace tells scroll, resize and fonts apart with its own listeners; the rest is resize-observer.
    WW_GUARD_TRACE: traceGeometryCause('changed');
    geometryDirty = true;
    change('layout');
  };
  /** A page scroll moves every surface that scrolls with the page by the same amount, which a
   * shifted snapshot follows exactly. A scroll inside an element moves only its contents. */
  const scrolled = (event: Event) => {
    WW_GUARD_TRACE: traceGeometryCause('changed');
    geometryDirty = true;
    change(event.target === doc ? 'scroll' : 'layout');
  };
  /** Focus, pointer or capture state changed: only a whole read records it (never a group check). */
  let stateDirty = false;
  const mark = () => {
    stateDirty = true;
    if (!dirty) {
      dirty = true;
      listeners.forEach((listener) => listener());
    }
  };
  // Records taken synchronously by capture() notify listeners at the same microtask
  // checkpoint the observer callback would have used, never inside the caller's frame.
  let notifyPending = false;
  /** Listeners hear the first change after a read and every rise in its kind, since what they
   * hide depends on it (pending()). */
  const change = (kind: PendingChange, deliver = true) => {
    const rose = raise(kind);
    if (dirty && !rose) return;
    dirty = true;
    if (deliver) listeners.forEach((listener) => listener());
    else if (!notifyPending) {
      notifyPending = true;
      queueMicrotask(() => {
        notifyPending = false;
        listeners.forEach((listener) => listener());
      });
    }
  };
  const handle = (records: readonly MutationRecord[], deliver: boolean) => {
    collect(records);
    if (!relevant(records)) return;
    geometryDirty = true;
    const kind = classify(records);
    WW_GUARD_TRACE: traceGeometryCause(`mutation-${kind}`, records);
    change(kind, deliver);
  };
  /** True when every one of these read controls is where the last read put it (moved only by the
   * page scroll since), as large, shown or hidden and enabled or disabled as it was, and is cut
   * from the clip rather than drawn above the artwork (an order a box cannot show). */
  const unchanged = (elements: readonly HTMLElement[], cutOnly = true) =>
    elements.every((element) => same(element, cutOnly));
  /** One read control against the last read: where the read put it (moved only by the page scroll
   * since), as large, shown or hidden and enabled or disabled as it was. `cutOnly`: it must also be
   * cut from the clip rather than drawn above the artwork, an order a box cannot show. A resized
   * control is not "the same": a resize can push controls anywhere else on the page, which only a
   * whole read sees (the D14① replacement exposed such a control and was removed). */
  const same = (element: HTMLElement, cutOnly = true) => {
    const view = doc.defaultView!,
      dx = view.scrollX - (cached?.scroll?.x ?? view.scrollX),
      dy = view.scrollY - (cached?.scroll?.y ?? view.scrollY);
    const read = readRows.get(element);
    if (!read || (cutOnly && read.some((entry) => !entry.plain)) || !element.isConnected) return false;
    const box = element.getBoundingClientRect();
    const visible = box.width > 0 && box.height > 0 && view.getComputedStyle(element).visibility !== 'hidden';
    const disabled = element.matches(':disabled,[aria-disabled="true"]');
    for (const entry of read) {
      const sx = entry.scrolls ? dx : 0,
        sy = entry.scrolls ? dy : 0;
      if (entry.visible !== visible || entry.disabled !== disabled) return false;
      // A control that is not shown has no box anyone uses (it reads as 0×0 at the origin).
      if (!visible) continue;
      if (
        Math.abs(box.left - (entry.rect.left - sx)) > 0.5 ||
        // A sticky column's control may be stuck: only its column is compared, as everywhere.
        (!entry.sticky && Math.abs(box.top - (entry.rect.top - sy)) > 0.5) ||
        Math.abs(box.width - entry.rect.width) > 0.5 ||
        Math.abs(box.height - entry.rect.height) > 0.5
      )
        return false;
    }
    return true;
  };
  /** The answer check in groups (D14②): when a window that only scrolled, changed looks or changed
   * subtrees ends, the read controls are compared with the page one group per frame (box, shown,
   * enabled) instead of reading the whole page in one frame. Any difference reads the whole page
   * at once. A round with no difference makes the shifted read current. Which groups a read
   * compares, and each group's last check, are in `answer` (src/host/answer-check.ts). */
  const sweep = (now: number, catchUp = false): 'pending' | 'done' | 'changed' => {
    // One group per frame: later reads in the same frame share the result (no groups due).
    const due = answer.due(now, catchUp);
    if (!due.length) return 'pending';
    const elements = [...readRows.keys()] as HTMLElement[],
      size = Math.ceil(elements.length / SWEEP_GROUPS);
    for (const sweepGroup of due) {
      const group = elements.slice(sweepGroup * size, (sweepGroup + 1) * size);
      let started = 0;
      WW_GUARD_TRACE: started = doc.defaultView!.performance.now();
      const differs = group.find((element) => !same(element, false));
      WW_GUARD_TRACE: traceSweep(
        doc,
        sweepGroup,
        SWEEP_GROUPS,
        group.length,
        doc.defaultView!.performance.now() - started,
        differs
          ? `changed ${differs.tagName} ${JSON.stringify(readRows.get(differs))} now ${JSON.stringify(differs.getBoundingClientRect())} scroll ${doc.defaultView!.scrollY} read ${cached?.scroll?.y}`
          : 'same',
      );
      if (differs) {
        answer.changed();
        return 'changed';
      }
      answer.passed(sweepGroup, now);
    }
    return answer.roundDone() ? 'done' : 'pending';
  };
  /** One step of the answer check, caught up when the oldest group's check is past TRUST_MS. */
  const check = (now: number) => sweep(now, now - answer.oldest() > TRUST_MS);
  /** Subtrees whose children changed since the last read, checked once by the next read (D11). */
  const changedSubtrees = new Set<Element>();
  /** The kind of a batch of relevant records:
   * - look: only a class or style changed, on a control or an element holding at most
   *   MAX_LOOK_ROWS of them, and those controls' boxes (read now, before the next paint) did not
   *   change (D9);
   * - subtree: elements were added or removed, none of the added ones holds a candidate and none
   *   of the removed ones held a read control; their parents are checked by the next read (D11);
   * - layout: anything else, which hides everything until a full read as before. */
  const classify = (records: readonly MutationRecord[]): PendingChange => {
    if (!cached?.scroll || !cached.supported || pending === 'layout') return 'layout';
    const looks: HTMLElement[] = [];
    let kind: PendingChange = 'look';
    for (const r of records) {
      if (!(r.target instanceof Element) || r.target.closest('[id^="web-world-themes"]')) continue;
      const target = r.target;
      if (r.type === 'childList') {
        const own = (n: Node): n is Element => n instanceof Element && !n.id.startsWith('web-world-themes');
        const addedElements = [...r.addedNodes].filter(own),
          removedElements = [...r.removedNodes].filter(own);
        if (!addedElements.length && !removedElements.length) continue;
        if (!holdsCandidate || addedElements.some((n) => holdsCandidate(n))) return 'layout';
        if (removedElements.some((n) => rows.some((row) => n === row.element || n.contains(row.element))))
          return 'layout';
        changedSubtrees.add(target);
        kind = 'subtree';
        continue;
      }
      if (!LOOK_ATTRIBUTES.has(r.attributeName ?? '')) {
        if (relevant([r])) return 'layout';
        continue;
      }
      const under = rows.filter((row) => row.element === target || target.contains(row.element));
      if (!under.length) continue;
      if (under.length > MAX_LOOK_ROWS) return 'layout';
      const elements = [...new Set(under.map((row) => row.element))];
      if (!unchanged(elements)) return 'layout';
      looks.push(...elements);
    }
    looks.forEach((element) => changedLooks.add(element));
    return kind;
  };
  /** The next read's check of the changed subtrees (D11), once however many changes the frame had:
   * every read control inside them is unchanged. Elements outside are not read; one an addition
   * pushed is either seen by the ResizeObserver on the root (the page grew) or by the full read at
   * the end of the window, which compares the whole layout. */
  const subtreesUnchanged = () => {
    const roots = [...changedSubtrees];
    changedSubtrees.clear();
    const inside = [
      ...new Set(
        rows
          .filter((row) => roots.some((root) => root === row.element || root.contains(row.element)))
          .map((r) => r.element),
      ),
    ];
    const result = roots.every((root) => root.isConnected) && unchanged(inside);
    WW_GUARD_TRACE: traceSubtreeCheck(doc, result, roots.length, inside.length);
    return result;
  };
  const relevant = (records: readonly MutationRecord[]) =>
    records.some(
      (r) =>
        r.target instanceof Element &&
        !r.target.closest('[id^="web-world-themes"]') &&
        ((r.type === 'attributes' &&
          // While composition is unverified, any observed attribute may restore it.
          (cached?.supported === false ||
            ['role', 'tabindex', 'contenteditable'].includes(r.attributeName ?? '') ||
            rows.some((row) => r.target === row.element || (r.target as Element).contains(row.element)))) ||
          [...r.addedNodes, ...r.removedNodes].some(
            (n) => n instanceof Element && !n.id.startsWith('web-world-themes'),
          )),
    );
  const observer = new MutationObserver((records) => handle(records, true));
  const root = doc.documentElement;
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'hidden',
      'disabled',
      'aria-expanded',
      'aria-disabled',
      'role',
      'tabindex',
      'contenteditable',
      'href',
    ],
  });
  /** The root's box at the last read, for the ResizeObserver reports below. */
  let rootSize: PlacementFrame | undefined;
  // Observing an element starts with a report of its current size. A report of the size the last
  // read already saw is no change; only a different size (or one not read) can have moved others.
  const resize = new ResizeObserver((entries) => {
    const different = entries.some((entry) => {
      const box = entry.borderBoxSize?.[0],
        read = entry.target === root ? rootSize : readRows.get(entry.target)?.[0]?.rect;
      return (
        !box || !read || Math.abs(box.inlineSize - read.width) > 0.5 || Math.abs(box.blockSize - read.height) > 0.5
      );
    });
    if (different) changed();
  });
  resize.observe(doc.documentElement);
  // The extension's own UI (editor handles, panels) is never a native surface; its gestures
  // must not mark the page as changed, or a drag would hold and hide its own handles.
  const owned = (event: Event) =>
    event.composedPath().some((node) => node instanceof Element && node.id.startsWith('web-world-themes'));
  // Focus moving between the extension's own nodes (a layer, its handle) is not native state.
  const focusChanged = (event: Event) => {
    const related = (event as FocusEvent).relatedTarget;
    if (owned(event) && (!(related instanceof Element) || related.closest('[id^="web-world-themes"]'))) return;
    WW_GUARD_TRACE: traceGeometryCause('focus');
    mark();
  };
  doc.addEventListener('scroll', scrolled, { capture: true, passive: true });
  doc.addEventListener('focusin', focusChanged, true);
  doc.addEventListener('focusout', focusChanged, true);
  doc.defaultView!.addEventListener('resize', changed);
  doc.fonts?.addEventListener('loadingdone', changed);
  WW_GUARD_TRACE: {
    doc.addEventListener('scroll', (event) => traceGeometryCause('scroll', event), { capture: true, passive: true });
    doc.defaultView!.addEventListener('resize', () => traceGeometryCause('resize'));
    doc.fonts?.addEventListener('loadingdone', () => traceGeometryCause('fonts'));
  }
  let serial = 0;
  const down = (event: Event) => {
    if (owned(event)) return;
    dragging = event.composedPath().find((node): node is Element => node instanceof Element);
    mark();
  };
  const up = (event?: Event) => {
    if (event && owned(event) && !dragging && !captured) return;
    dragging = undefined;
    captured = undefined;
    mark();
  };
  const capturePointer = (event: Event) => {
    if (owned(event)) return;
    captured = event.target instanceof Element ? event.target : undefined;
    mark();
  };
  const types = ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'] as const;
  const handlers = [down, up, up, capturePointer, up];
  doc.defaultView!.addEventListener('blur', up);
  doc.defaultView!.addEventListener('focus', mark);
  types.forEach((type, i) => doc.addEventListener(type, handlers[i]!, { capture: true, passive: true }));
  /** Milliseconds until the pending change of any kind is read again (the answer check). */
  const settlesIn = () =>
    dirty && geometryDirty && deferredUntil ? Math.max(0, deferredUntil - doc.defaultView!.performance.now()) : 0;
  /** The last read as it is after the page scrolled: every surface that scrolls with the page
   * moved by the same amount, the rest unchanged. The same layout generation, a new scroll. One
   * object per offset, so the frame's readers share it. */
  let shift: { base: OperationSnapshot; x: number; y: number; snapshot: OperationSnapshot } | undefined;
  const shifted = (base: OperationSnapshot): OperationSnapshot => {
    const view = doc.defaultView!,
      x = view.scrollX,
      y = view.scrollY;
    const dx = x - (base.scroll?.x ?? x),
      dy = y - (base.scroll?.y ?? y);
    if (!dx && !dy) return base;
    if (shift?.base === base && shift.x === x && shift.y === y) return shift.snapshot;
    // A surface in a sticky column stays where it was read: it may be stuck, and every plane
    // excludes its whole column anyway.
    // Only visible surfaces are moved: nothing reads the box of one that is not shown.
    const surfaces = base.surfaces.map((surface) =>
      surface.availability.visible &&
      surface.scrolls &&
      !(surface.scrollBox && surface.scrollBox.height >= UNBOUNDED_BOX)
        ? Object.freeze({
            ...surface,
            shape: moved(surface.shape, dx, dy),
            protectedEnvelope: moved(surface.protectedEnvelope, dx, dy),
            ...(surface.scrollBox && surface.scrollBox.height < UNBOUNDED_BOX
              ? { scrollBox: moved(surface.scrollBox, dx, dy) }
              : {}),
          })
        : surface,
    );
    const snapshot = Object.freeze({
      generation: base.generation,
      scroll: Object.freeze({ x, y }),
      viewport: base.viewport,
      supported: base.supported,
      surfaces: Object.freeze(surfaces),
    });
    issued.add(snapshot);
    shift = { base, x, y, snapshot };
    return snapshot;
  };
  function capture(options?: { coalesce?: boolean; fresh?: boolean }): OperationSnapshot {
    if (options?.fresh) {
      dirty = true;
      fullScan = true;
      forced = true;
    }
    // Undelivered records are the only way a read element can have left the document.
    const taken = observer.takeRecords();
    if (taken.length) handle(taken, false);
    // Focus can leave with a removed element without any focus event; compare it directly.
    if (doc.activeElement !== readActive || doc.hasFocus() !== readFocus) dirty = stateDirty = true;
    const now = doc.defaultView!.performance.now();
    // Current: the read, shifted by any page scroll a round of the answer check has accepted.
    // A control can move with no notification at all (an animation, a transform from a style
    // sheet), so a quiet read is trusted for ANSWER_CHECK_MS only: after that, rounds of the
    // answer check run while the page is read, and a read whose last check is older than TRUST_MS
    // checks every group still unchecked first. A silent move is found within TRUST_MS (G1.3
    // verification: a quiet spell kept a moved control at its old box for 500ms and more).
    if (!dirty && cached && doc.documentElement === root) {
      if (now - answer.oldest() <= ANSWER_CHECK_MS || check(now) !== 'changed') return shifted(cached);
      dirty = geometryDirty = true;
      forced = true;
    }
    const inWindow = now - capturedAt < COALESCE_MS;
    // A page scroll, a checked look change or changed subtrees after a quiet period open a window
    // of their own (G1.3, D11): the shifted read serves now, and the whole page is read once at
    // the window's end to check it. Other changes are read at once, as before.
    const shiftable = pending === 'scroll' || pending === 'look' || pending === 'subtree';
    if (!inWindow && shiftable && !deferredUntil && geometryDirty && cached && !forced)
      deferredUntil = now + ANSWER_CHECK_MS;
    // A burst of native changes is read once per window, not once per frame. The stale
    // snapshot is only for callers that hold drawing; input checks force a fresh read.
    // Other reads inside the same held window share that caller's snapshot.
    if (
      (options?.coalesce || deferredUntil > now) &&
      geometryDirty &&
      cached &&
      !forced &&
      doc.documentElement === root &&
      (inWindow || (shiftable && deferredUntil > now))
    ) {
      if (inWindow) deferredUntil = capturedAt + (shiftable ? ANSWER_CHECK_MS : COALESCE_MS);
      // Added or removed elements: this read checks their subtrees once (D11). Unchanged, the
      // pending kind is what else arrived; changed, it is a layout change and drawing waits.
      if (pending === 'subtree')
        if (subtreesUnchanged()) pending = sawLook ? 'look' : sawScroll ? 'scroll' : 'none';
        else raise('layout');
      // Only a page scroll or a checked look change since the read: the read, shifted by the
      // scroll, is where every surface is now (G1.3). A layout change inside the window holds
      // drawing until its end; one found after a quiet period is read now (below), as before.
      // A shifted read is trusted only while the last check is within TRUST_MS; past it, every
      // group is checked now, and a difference is a layout change (G1.3 verification).
      if (pending !== 'layout' && now - answer.oldest() > TRUST_MS && check(now) === 'changed') raise('layout');
      if (pending !== 'layout') return shifted(cached);
      if (inWindow) return cached;
    }
    // The window ended with only shiftable changes: check the read one group per frame instead of
    // reading the whole page now (D14②). An element whose class, role, href or contenteditable
    // made it a candidate or stopped it being one still needs the whole read, as does any
    // difference a group finds. (Added subtrees were checked to hold no candidate, D11.)
    if (
      shiftable &&
      pending !== 'layout' &&
      geometryDirty &&
      cached &&
      !forced &&
      !fullScan &&
      !stateDirty &&
      holdsCandidate &&
      ![...touched].some((element) => readRows.has(element) !== holdsCandidate(element, false)) &&
      doc.documentElement === root &&
      (pending !== 'subtree' || subtreesUnchanged())
    ) {
      if (pending === 'subtree') pending = sawLook ? 'look' : sawScroll ? 'scroll' : 'none';
      const step = check(now);
      if (step === 'pending') return shifted(cached);
      if (step === 'done') {
        // The shifted read is the page: nothing is pending until the next change.
        geometryDirty = dirty = false;
        deferredUntil = 0;
        capturedAt = now;
        pending = 'none';
        sawScroll = sawLook = false;
        changedLooks.clear();
        return shifted(cached);
      }
    }
    WW_GUARD_TRACE: if (shiftable && cached)
      traceSkipSweep(doc, {
        geometryDirty,
        forced,
        fullScan,
        stateDirty,
        touched: [...touched].filter((element) => readRows.has(element) !== holdsCandidate?.(element, false)).length,
        pending,
      });
    const g11Start = g11CaptureStart();
    stateDirty = false;
    forced = false;
    geometryDirty = false;
    deferredUntil = 0;
    capturedAt = now;
    answer.readAll(now);
    dirty = false;
    pending = 'none';
    sawScroll = sawLook = false;
    changedLooks.clear();
    changedSubtrees.clear();
    const scan: DiscoveryScan = {
      full: fullScan || now - lastFullScan >= FULL_SCAN_INTERVAL_MS,
      added: [...added],
      touched: [...touched],
    };
    if (scan.full) lastFullScan = now;
    fullScan = false;
    added.clear();
    touched.clear();
    rows = discover(scan);
    const wanted = new Set(rows.map((r) => r.element));
    if (wanted.size !== observed.size || [...wanted].some((e) => !observed.has(e))) {
      resize.disconnect();
      resize.observe(doc.documentElement);
      wanted.forEach((e) => resize.observe(e));
      observed = wanted;
    }
    const identity = rows.map(({ element }) => {
      if (!identities.has(element)) identities.set(element, ++serial);
      return identities.get(element);
    });
    readActive = doc.activeElement;
    readFocus = doc.hasFocus();
    // Focus on the extension's own hosts (some live inside the player) is not native focus.
    const active = doc.activeElement?.closest('[id^="web-world-themes"]') ? null : doc.activeElement;
    const activeRect = active?.getBoundingClientRect();
    // A band reserved on a larger element (the player's control bars) is focused only through a
    // focused descendant inside that band, not by focus on the container itself.
    const focusedIn = (row: OperationCandidate, rect: PlacementFrame) => {
      if (!active || !row.element.contains(active)) return false;
      const band = row.envelope;
      if (!band || band.width * band.height >= rect.width * rect.height - 1) return true;
      return (
        active !== row.element &&
        Boolean(activeRect) &&
        activeRect!.right > band.left &&
        activeRect!.left < band.left + band.width &&
        activeRect!.bottom > band.top &&
        activeRect!.top < band.top + band.height
      );
    };
    const surfaces = rows.map((row): OperationSurface => {
      const rect = row.rect ?? row.element.getBoundingClientRect();
      const shape = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      // Fullscreen hides the rest of the document even while its layout rects remain.
      const presented = !doc.fullscreenElement || doc.fullscreenElement.contains(row.element);
      return {
        id: row.id,
        owner: 'native',
        generation: { documentId, geometry: generation },
        kind: row.kind,
        shape,
        protectedEnvelope: row.envelope ?? {
          left: shape.left - 4,
          top: shape.top - 4,
          width: shape.width + 8,
          height: shape.height + 8,
        },
        availability: {
          present: row.element.isConnected,
          visible:
            presented &&
            row.element.isConnected &&
            rect.width > 0 &&
            rect.height > 0 &&
            (row.visible ?? doc.defaultView!.getComputedStyle(row.element).visibility !== 'hidden'),
          disabled: row.element.matches(':disabled,[aria-disabled="true"]'),
          focused: presented && doc.hasFocus() && focusedIn(row, shape),
          editing: presented && doc.hasFocus() && row.kind === 'text-input' && focusedIn(row, shape),
          dragging: presented && Boolean(dragging && row.element.contains(dragging)),
          captured: presented && Boolean(captured && row.element.contains(captured)),
        },
        policy: { transform: 'fixed-plane', occlusion: row.occlusion ?? 'forbid', input: 'native-only' },
        compositionCapability: row.unsupported
          ? 'unsupported'
          : row.nativeAbove
            ? 'native-above'
            : row.occlusion === 'allow'
              ? 'native-underlay'
              : 'exclusion',
        scrolls: row.scrolls !== false,
        ...(row.scrollBox ? { scrollBox: Object.freeze({ ...row.scrollBox }) } : {}),
        ...(row.aboveBeneath ? { aboveBeneath: true } : {}),
        ...(row.reserved ? { reserved: true } : {}),
      };
    });
    readIdentity = identity;
    const scroll = { x: doc.defaultView!.scrollX, y: doc.defaultView!.scrollY };
    readRows = new Map();
    rootSize = root.getBoundingClientRect();
    rows.forEach((row, i) => {
      const surface = surfaces[i]!;
      const list = readRows.get(row.element) ?? [];
      list.push({
        id: surface.id,
        // The element's own box, as read above (the adapter's rect is the same reading).
        rect: surface.shape,
        visible: surface.availability.visible,
        disabled: surface.availability.disabled,
        scrolls: surface.scrolls,
        sticky: Boolean(surface.scrollBox && surface.scrollBox.height >= UNBOUNDED_BOX),
        plain: surface.compositionCapability === 'exclusion' || surface.compositionCapability === 'native-underlay',
      });
      readRows.set(row.element, list);
    });
    cached = seal(surfaces, scroll, { width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight });
    WW_GUARD_TRACE: traceGeometryRead(doc, cached, rows);
    g11CaptureEnd(g11Start, surfaces.length);
    return cached;
  }
  /** Signs, numbers and freezes a read (a whole one, or one with replaced boxes): the geometry
   * generation changes when any surface moves on screen, the layout generation only when one moves
   * in document coordinates. */
  function seal(
    read: readonly OperationSurface[],
    scroll: { x: number; y: number },
    viewport: { width: number; height: number },
  ): OperationSnapshot {
    const signature = JSON.stringify([
      readIdentity,
      read.map(({ shape, protectedEnvelope, scrollBox, policy, compositionCapability, availability }) => [
        shape,
        protectedEnvelope,
        scrollBox ?? null,
        policy,
        compositionCapability,
        availability.visible,
        availability.disabled,
      ]),
    ]);
    if (signature !== previous) {
      generation++;
      previous = signature;
    }
    // The same in document coordinates: a uniform page scroll leaves it unchanged (G1.3).
    // Screen-fixed surfaces do not move with the page. A surface in a sticky column (an unbounded
    // scroll box) may be stuck or travelling at any scroll, so only its column counts, as every
    // plane already excludes it along that whole column.
    const inDocument = (frame: PlacementFrame, moves: boolean, sticky: boolean) =>
      sticky
        ? [round(frame.left + scroll.x), round(frame.width)]
        : moves && frame.height < UNBOUNDED_BOX
          ? [round(frame.left + scroll.x), round(frame.top + scroll.y), round(frame.width), round(frame.height)]
          : [round(frame.left), round(frame.top), round(frame.width), round(frame.height)];
    const layoutSignature = JSON.stringify([
      readIdentity,
      // A surface that is not visible has no box anyone uses (it reads as 0×0 at the origin).
      read.map(({ shape, protectedEnvelope, scrollBox, policy, compositionCapability, availability, scrolls }) =>
        availability.visible
          ? [
              inDocument(shape, scrolls, Boolean(scrollBox && scrollBox.height >= UNBOUNDED_BOX)),
              inDocument(protectedEnvelope, scrolls, Boolean(scrollBox && scrollBox.height >= UNBOUNDED_BOX)),
              scrollBox ? inDocument(scrollBox, scrolls, scrollBox.height >= UNBOUNDED_BOX) : null,
              policy,
              compositionCapability,
              availability.disabled,
            ]
          : [policy, compositionCapability, availability.disabled],
      ),
    ]);
    if (layoutSignature !== previousLayout) {
      layoutGeneration++;
      previousLayout = layoutSignature;
    }
    const surfaces = read.map((surface) =>
      Object.freeze({
        ...surface,
        generation: Object.freeze({ documentId, geometry: generation }),
        shape: Object.freeze(surface.shape),
        protectedEnvelope: Object.freeze(surface.protectedEnvelope),
        availability: Object.freeze(surface.availability),
        policy: Object.freeze(surface.policy),
      }),
    );
    const snapshot = Object.freeze({
      generation: Object.freeze({ documentId, geometry: generation, layout: layoutGeneration }),
      scroll: Object.freeze({ ...scroll }),
      viewport: Object.freeze({ ...viewport }),
      supported: surfaces.every((s) => s.compositionCapability !== 'unsupported'),
      surfaces: Object.freeze(surfaces),
    });
    issued.add(snapshot);
    return snapshot;
  }
  // The slot reads computed styles of the overlay's ancestors, which a stylesheet can change
  // without any MutationRecord. Calls within one task (one draw) share a read; the next task
  // reads again, so no paint is decided on an earlier task's value.
  let slot: { value: ReturnType<typeof overlaySlot> } | undefined;
  const verifiedOverlaySlot = () => {
    if (!slot) {
      slot = { value: overlaySlot() };
      queueMicrotask(() => (slot = undefined));
    }
    return slot.value;
  };
  return {
    active(value) {
      observer.disconnect();
      resize.disconnect();
      types.forEach((type, i) => doc.removeEventListener(type, handlers[i]!, true));
      doc.removeEventListener('scroll', scrolled, true);
      doc.removeEventListener('focusin', focusChanged, true);
      doc.removeEventListener('focusout', focusChanged, true);
      doc.defaultView!.removeEventListener('resize', changed);
      doc.defaultView!.removeEventListener('blur', up);
      doc.defaultView!.removeEventListener('focus', mark);
      doc.fonts?.removeEventListener('loadingdone', changed);
      if (value) {
        observer.observe(doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'class',
            'style',
            'hidden',
            'disabled',
            'aria-expanded',
            'aria-disabled',
            'role',
            'tabindex',
            'contenteditable',
            'href',
          ],
        });
        resize.observe(doc.documentElement);
        observed.forEach((e) => resize.observe(e));
        types.forEach((type, i) => doc.addEventListener(type, handlers[i]!, { capture: true, passive: true }));
        doc.addEventListener('scroll', scrolled, { capture: true, passive: true });
        doc.addEventListener('focusin', focusChanged, true);
        doc.addEventListener('focusout', focusChanged, true);
        doc.defaultView!.addEventListener('resize', changed);
        doc.defaultView!.addEventListener('blur', up);
        doc.defaultView!.addEventListener('focus', mark);
        doc.fonts?.addEventListener('loadingdone', changed);
      }
      dirty = true;
      fullScan = true;
      forced = true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    capture,
    deferredFor() {
      return pending === 'layout' ? settlesIn() : 0;
    },
    settlesIn,
    trustExpiresIn: () =>
      cached ? Math.max(0, answer.oldest() + TRUST_MS - doc.defaultView!.performance.now()) : undefined,
    pending: () => (dirty ? pending : 'none'),
    lookRegions() {
      if (pending !== 'look' || !cached) return [];
      const now = shifted(cached),
        ids = new Set([...changedLooks].flatMap((element) => readRows.get(element)?.map((row) => row.id) ?? []));
      return now.surfaces.filter((s) => ids.has(s.id)).map((s) => s.scrollBox ?? s.protectedEnvelope);
    },
    validate(snapshot, event) {
      if (!issued.has(snapshot) || snapshot.generation.documentId !== documentId) return false;
      // Input-time reads never trust the incremental view or wait for a window.
      const next = capture({ fresh: Boolean(event) });
      // A page scroll keeps the layout: what was drawn for the snapshot still avoids every surface
      // (G1.3, D3). The point of an input is checked against the page itself below.
      if (layoutOf(next) !== layoutOf(snapshot) || !next.supported) {
        WW_GUARD_TRACE: if (event) traceMovedInput(event, layoutOf(snapshot), layoutOf(next));
        return false;
      }
      if (!(event instanceof MouseEvent)) return true;
      const hit = doc.elementFromPoint(event.clientX, event.clientY);
      const missed = rows.filter((row) => {
        if (doc.fullscreenElement && !doc.fullscreenElement.contains(row.element)) return false;
        const r = row.element.getBoundingClientRect();
        if (!(
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom
        ))
          return false;
        // A control that is not shown (YouTube keeps hover-only buttons in the layout) cannot be
        // under the pointer, so another element taking the click is not a covered control.
        // Same test as a snapshot's availability.visible; read only for controls at the point.
        if (!row.element.isConnected || !r.width || !r.height) return false;
        const style = doc.defaultView!.getComputedStyle(row.element);
        if (!(row.visible ?? style.visibility !== 'hidden')) return false;
        // A control that takes no pointer input (pointer-events: none, inherited from an
        // ancestor too) is not covered when the click reaches what is beneath it (D8). The
        // extension never writes pointer-events on the site's elements, so this is the site's own.
        if (style.pointerEvents === 'none') return false;
        return !(
          hit &&
          (row.element.contains(hit) || hit.contains(row.element) || event.composedPath().includes(row.element))
        );
      });
      WW_GUARD_TRACE: if (missed.length) traceMissedInput(event, hit, missed);
      return !missed.length;
    },
    videoSlot,
    beneathSlot: (near) => beneathSlot(fullScan ? undefined : [...added, ...touched], dirty ? pending : 'none', near),
    wrote() {
      slot = undefined;
      dropReads?.();
    },
    editorCentre,
    overlaySlot: verifiedOverlaySlot,
    underlaySlot,
    pageSlot() {
      const overlay = verifiedOverlaySlot();
      if (!overlay || doc.fullscreenElement) return undefined;
      // Horizontal page scroll is not part of any envelope; refuse rather than guess.
      const scroller = doc.scrollingElement ?? doc.documentElement;
      if (scroller.scrollWidth > scroller.clientWidth) return undefined;
      return scrollsWithPage(overlay.parent) ? overlay : undefined;
    },
    destroy() {
      observer.disconnect();
      resize.disconnect();
      listeners.clear();
      doc.removeEventListener('scroll', scrolled, true);
      doc.removeEventListener('focusin', focusChanged, true);
      doc.removeEventListener('focusout', focusChanged, true);
      doc.defaultView!.removeEventListener('resize', changed);
      doc.defaultView!.removeEventListener('blur', up);
      doc.defaultView!.removeEventListener('focus', mark);
      doc.fonts?.removeEventListener('loadingdone', changed);
      types.forEach((type, i) => doc.removeEventListener(type, handlers[i]!, true));
      rows = [];
      up();
    },
  };
}
