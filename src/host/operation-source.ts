import type { OperationSnapshot, OperationSurface } from '../world/operations';
import type { PlacementFrame } from '../world/geometry';
import { scrollsWithPage } from './operation-composition';
import { traceGeometryCause, traceGeometryRead, traceMissedInput, traceMovedInput } from './guard-trace';

/** Attributes a site selector may test; a change can add or drop a candidate by itself. */
const MATCHING_ATTRIBUTES = new Set(['class', 'role', 'href', 'contenteditable']);
/** A mutation burst this large is cheaper to answer with a whole-document scan. */
const MAX_INCREMENTAL_ROOTS = 64;
/** Bounds how long a change the observer could not describe can go unnoticed. */
const FULL_SCAN_INTERVAL_MS = 1000;
/** Changes inside this window after a read wait for its end; callers hold drawing meanwhile. */
export const COALESCE_MS = 200;
/** A look change (class/style) above more controls than this is treated as a layout change. */
const MAX_LOOK_ROWS = 32;
/** The two attributes a control's look changes through (hover marks, inline styles). The others
 * the observer sees (hidden, disabled, aria-*, role, tabindex, contenteditable, href) can show,
 * hide, open or change what a control is, so they always count as a layout change. */
const LOOK_ATTRIBUTES = new Set(['class', 'style']);
export type PendingChange = 'none' | 'scroll' | 'look' | 'layout';
const RANK: Record<PendingChange, number> = { none: 0, scroll: 1, look: 2, layout: 3 };
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
  /** The kind of change since the last read. */
  pending(): PendingChange;
  /** While only looks changed: the envelopes of those controls, where they are now. */
  lookRegions(): readonly PlacementFrame[];
  /** zIndex: the local plane's order inside the player, just above its media and below its UI. */
  videoSlot(): { parent: HTMLElement; rect: PlacementFrame; top: number; bottom: number; zIndex: number } | undefined;
  overlaySlot(): { parent: HTMLElement; zIndex: number } | undefined;
  /** Explicit editing only: the player's video centre (minus its control bands) while no menu,
   * error or advert covers it. Unlike videoSlot it stays available when native controls appear in
   * the centre; those are cut from the clip and refused at input time instead. */
  editorCentre(): PlacementFrame | undefined;
  /** The overlay parent when a child placed at the document origin scrolls with the page. */
  pageSlot(): { parent: HTMLElement; zIndex: number } | undefined;
  destroy(): void;
}
/** DOM identities stay here; the site adapter alone supplies discovery/selectors. */
export function createOperationSource(
  doc: Document,
  discover: (scan: DiscoveryScan) => readonly OperationCandidate[],
  videoSlot: OperationSource['videoSlot'],
  overlaySlot: OperationSource['overlaySlot'] = () => ({ parent: doc.body ?? doc.documentElement, zIndex: 2147482000 }),
  editorCentre: OperationSource['editorCentre'] = () => undefined,
): OperationSource {
  if (!documentIds.has(doc)) documentIds.set(doc, ++nextDocumentId);
  const documentId = documentIds.get(doc)!;
  const issued = new WeakSet<OperationSnapshot>();
  let generation = 0,
    previous = '',
    layoutGeneration = 0,
    previousLayout = '',
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
    { id: string; rect: PlacementFrame; visible: boolean; disabled: boolean; scrolls: boolean; plain: boolean }[]
  >();
  const raise = (kind: PendingChange) => {
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
  const mark = () => {
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
    const kind = lookOnly(records) ? 'look' : 'layout';
    WW_GUARD_TRACE: traceGeometryCause(kind === 'look' ? 'mutation-look' : 'mutation-layout', records);
    change(kind, deliver);
  };
  /** True when every relevant record only changed how a few controls look: a class or style on
   * a control or on an element holding at most MAX_LOOK_ROWS of them, none of which moved,
   * resized, appeared, disappeared or was drawn above the artwork (its order cannot be checked
   * here). Reads those controls' boxes now, before the next paint; a change of any kind falls
   * back to a layout change, which hides everything as before (D9). */
  const lookOnly = (records: readonly MutationRecord[]) => {
    if (!cached?.scroll || !cached.supported || pending === 'layout') return false;
    const view = doc.defaultView!,
      dx = view.scrollX - cached.scroll.x,
      dy = view.scrollY - cached.scroll.y;
    const looks: HTMLElement[] = [];
    for (const r of records) {
      if (!(r.target instanceof Element) || r.target.closest('[id^="web-world-themes"]')) continue;
      const added = [...r.addedNodes, ...r.removedNodes].some(
        (n) => n instanceof Element && !n.id.startsWith('web-world-themes'),
      );
      if (r.type === 'childList') {
        if (added) return false;
        continue;
      }
      if (!LOOK_ATTRIBUTES.has(r.attributeName ?? '')) {
        if (relevant([r])) return false;
        continue;
      }
      const target = r.target;
      const under = rows.filter((row) => row.element === target || target.contains(row.element));
      if (!under.length) continue;
      if (under.length > MAX_LOOK_ROWS) return false;
      for (const row of under) {
        const read = readRows.get(row.element);
        if (!read || read.some((entry) => !entry.plain)) return false;
        const box = row.element.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0 && view.getComputedStyle(row.element).visibility !== 'hidden';
        for (const entry of read) {
          const sx = entry.scrolls ? dx : 0,
            sy = entry.scrolls ? dy : 0;
          if (
            entry.visible !== visible ||
            entry.disabled !== row.element.matches(':disabled,[aria-disabled="true"]') ||
            Math.abs(box.left - (entry.rect.left - sx)) > 0.5 ||
            Math.abs(box.top - (entry.rect.top - sy)) > 0.5 ||
            Math.abs(box.width - entry.rect.width) > 0.5 ||
            Math.abs(box.height - entry.rect.height) > 0.5
          )
            return false;
        }
        looks.push(row.element);
      }
    }
    looks.forEach((element) => changedLooks.add(element));
    return true;
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
  const resize = new ResizeObserver(changed);
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
    const surfaces = base.surfaces.map((surface) =>
      surface.scrolls && !(surface.scrollBox && surface.scrollBox.height >= UNBOUNDED_BOX)
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
    if (doc.activeElement !== readActive || doc.hasFocus() !== readFocus) dirty = true;
    if (!dirty && cached && doc.documentElement === root) return cached;
    const now = doc.defaultView!.performance.now();
    // A burst of native changes is read once per window, not once per frame. The stale
    // snapshot is only for callers that hold drawing; input checks force a fresh read.
    // Other reads inside the same held window share that caller's snapshot.
    if (
      (options?.coalesce || deferredUntil > now) &&
      geometryDirty &&
      cached &&
      !forced &&
      doc.documentElement === root &&
      now - capturedAt < COALESCE_MS
    ) {
      deferredUntil = capturedAt + COALESCE_MS;
      // Only a page scroll or a checked look change since the read: the read, shifted by the
      // scroll, is where every surface is now (G1.3). Anything else: the caller holds drawing.
      return pending === 'layout' ? cached : shifted(cached);
    }
    forced = false;
    geometryDirty = false;
    deferredUntil = 0;
    capturedAt = now;
    dirty = false;
    pending = 'none';
    changedLooks.clear();
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
      };
    });
    const signature = JSON.stringify([
      identity,
      surfaces.map(({ shape, protectedEnvelope, scrollBox, policy, compositionCapability, availability }) => [
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
    const scroll = { x: doc.defaultView!.scrollX, y: doc.defaultView!.scrollY };
    const inDocument = (frame: PlacementFrame, moves: boolean, sticky: boolean) =>
      sticky
        ? [round(frame.left + scroll.x), round(frame.width)]
        : moves && frame.height < UNBOUNDED_BOX
          ? [round(frame.left + scroll.x), round(frame.top + scroll.y), round(frame.width), round(frame.height)]
          : [round(frame.left), round(frame.top), round(frame.width), round(frame.height)];
    const layoutSignature = JSON.stringify([
      identity,
      // A surface that is not visible has no box anyone uses (it reads as 0×0 at the origin).
      surfaces.map(({ shape, protectedEnvelope, scrollBox, policy, compositionCapability, availability, scrolls }) =>
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
    readRows = new Map();
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
        plain: surface.compositionCapability === 'exclusion' || surface.compositionCapability === 'native-underlay',
      });
      readRows.set(row.element, list);
    });
    surfaces.forEach((surface) => {
      surface.generation.geometry = generation;
      Object.freeze(surface.generation);
      Object.freeze(surface.shape);
      Object.freeze(surface.protectedEnvelope);
      Object.freeze(surface.availability);
      Object.freeze(surface.policy);
      Object.freeze(surface);
    });
    cached = Object.freeze({
      generation: Object.freeze({ documentId, geometry: generation, layout: layoutGeneration }),
      scroll: Object.freeze(scroll),
      viewport: Object.freeze({ width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight }),
      supported: surfaces.every((s) => s.compositionCapability !== 'unsupported'),
      surfaces: Object.freeze(surfaces),
    });
    issued.add(cached);
    WW_GUARD_TRACE: traceGeometryRead(doc, cached, rows);
    return cached;
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
    editorCentre,
    overlaySlot: verifiedOverlaySlot,
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
