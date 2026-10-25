import type { OperationSnapshot, OperationSurface } from '../world/operations';
import type { PlacementFrame } from '../world/geometry';
import { scrollsWithPage } from './operation-composition';

/** Attributes a site selector may test; a change can add or drop a candidate by itself. */
const MATCHING_ATTRIBUTES = new Set(['class', 'role', 'href', 'contenteditable']);
/** A mutation burst this large is cheaper to answer with a whole-document scan. */
const MAX_INCREMENTAL_ROOTS = 64;
/** Bounds how long a change the observer could not describe can go unnoticed. */
const FULL_SCAN_INTERVAL_MS = 1000;
/** Changes inside this window after a read wait for its end; callers hold drawing meanwhile. */
export const COALESCE_MS = 200;

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
  /** coalesce: the caller holds drawing while a burst of changes is pending (see COALESCE_MS). */
  capture(options?: { coalesce?: boolean }): OperationSnapshot;
  validate(snapshot: OperationSnapshot, event?: Event): boolean;
  /** Milliseconds until a pending change may be read; 0 when the last capture is current. */
  deferredFor(): number;
  /** zIndex: the local plane's order inside the player, just above its media and below its UI. */
  videoSlot(): { parent: HTMLElement; rect: PlacementFrame; top: number; bottom: number; zIndex: number } | undefined;
  overlaySlot(): { parent: HTMLElement; zIndex: number } | undefined;
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
): OperationSource {
  if (!documentIds.has(doc)) documentIds.set(doc, ++nextDocumentId);
  const documentId = documentIds.get(doc)!;
  const issued = new WeakSet<OperationSnapshot>();
  let generation = 0,
    previous = '',
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
  const changed = () => {
    geometryDirty = true;
    mark();
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
  const handle = (records: readonly MutationRecord[], deliver: boolean) => {
    collect(records);
    if (!relevant(records)) return;
    geometryDirty = true;
    if (deliver) mark();
    else if (!dirty) {
      dirty = true;
      if (!notifyPending) {
        notifyPending = true;
        queueMicrotask(() => {
          notifyPending = false;
          listeners.forEach((listener) => listener());
        });
      }
    }
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
    mark();
  };
  doc.addEventListener('scroll', changed, { capture: true, passive: true });
  doc.addEventListener('focusin', focusChanged, true);
  doc.addEventListener('focusout', focusChanged, true);
  doc.defaultView!.addEventListener('resize', changed);
  doc.fonts?.addEventListener('loadingdone', changed);
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
  function capture(options?: { coalesce?: boolean }): OperationSnapshot {
    // Undelivered records are the only way a read element can have left the document.
    const pending = observer.takeRecords();
    if (pending.length) handle(pending, false);
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
      return cached;
    }
    forced = false;
    geometryDirty = false;
    deferredUntil = 0;
    capturedAt = now;
    dirty = false;
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
      generation: Object.freeze({ documentId, geometry: generation }),
      viewport: Object.freeze({ width: doc.defaultView!.innerWidth, height: doc.defaultView!.innerHeight }),
      supported: surfaces.every((s) => s.compositionCapability !== 'unsupported'),
      surfaces: Object.freeze(surfaces),
    });
    issued.add(cached);
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
      doc.removeEventListener('scroll', changed, true);
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
        doc.addEventListener('scroll', changed, { capture: true, passive: true });
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
      return dirty && deferredUntil ? Math.max(0, deferredUntil - doc.defaultView!.performance.now()) : 0;
    },
    validate(snapshot, event) {
      if (!issued.has(snapshot) || snapshot.generation.documentId !== documentId) return false;
      if (event) {
        // Input-time reads never trust the incremental view or wait for a window.
        dirty = true;
        fullScan = true;
        forced = true;
      }
      const next = capture();
      if (next.generation.geometry !== snapshot.generation.geometry || !next.supported) return false;
      if (!(event instanceof MouseEvent)) return true;
      const hit = doc.elementFromPoint(event.clientX, event.clientY);
      return rows
        .filter((row) => {
          if (doc.fullscreenElement && !doc.fullscreenElement.contains(row.element)) return false;
          const r = row.element.getBoundingClientRect();
          return (
            event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
          );
        })
        .every((row) =>
          Boolean(
            hit &&
            (row.element.contains(hit) || hit.contains(row.element) || event.composedPath().includes(row.element)),
          ),
        );
    },
    videoSlot,
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
      doc.removeEventListener('scroll', changed, true);
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
