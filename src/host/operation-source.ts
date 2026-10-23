import type { OperationSnapshot, OperationSurface } from '../world/operations';
import type { PlacementFrame } from '../world/geometry';

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
}
export interface OperationSource {
  active(value: boolean): void;
  subscribe(listener: () => void): () => void;
  capture(): OperationSnapshot;
  validate(snapshot: OperationSnapshot, event?: Event): boolean;
  videoSlot(): { parent: HTMLElement; rect: PlacementFrame; top: number; bottom: number } | undefined;
  overlaySlot(): { parent: HTMLElement; zIndex: number } | undefined;
  destroy(): void;
}
/** DOM identities stay here; the site adapter alone supplies discovery/selectors. */
export function createOperationSource(
  doc: Document,
  discover: () => readonly OperationCandidate[],
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
  const mark = () => {
    if (!dirty) {
      dirty = true;
      listeners.forEach((listener) => listener());
    }
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          r.target instanceof Element &&
          !r.target.closest('[id^="web-world-themes"]') &&
          ((r.type === 'attributes' &&
            (['role', 'tabindex', 'contenteditable'].includes(r.attributeName ?? '') ||
              rows.some((row) => r.target === row.element || (r.target as Element).contains(row.element)))) ||
            [...r.addedNodes, ...r.removedNodes].some(
              (n) => n instanceof Element && !n.id.startsWith('web-world-themes'),
            )),
      )
    )
      mark();
  });
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
    ],
  });
  const resize = new ResizeObserver(mark);
  resize.observe(doc.documentElement);
  doc.addEventListener('scroll', mark, { capture: true, passive: true });
  doc.addEventListener('focusin', mark, true);
  doc.addEventListener('focusout', mark, true);
  doc.defaultView!.addEventListener('resize', mark);
  doc.fonts?.addEventListener('loadingdone', mark);
  let serial = 0;
  const down = (event: Event) => {
    dragging = event.composedPath().find((node): node is Element => node instanceof Element);
    mark();
  };
  const up = () => {
    dragging = undefined;
    captured = undefined;
    mark();
  };
  const capturePointer = (event: Event) => {
    captured = event.target instanceof Element ? event.target : undefined;
    mark();
  };
  const types = ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'] as const;
  const handlers = [down, up, up, capturePointer, up];
  doc.defaultView!.addEventListener('blur', up);
  doc.defaultView!.addEventListener('focus', mark);
  types.forEach((type, i) => doc.addEventListener(type, handlers[i]!, { capture: true, passive: true }));
  function capture(): OperationSnapshot {
    if (!dirty && cached && rows.every((r) => r.element.isConnected)) return cached;
    dirty = false;
    rows = discover();
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
          focused: presented && doc.hasFocus() && row.element.contains(doc.activeElement),
          editing: presented && doc.hasFocus() && row.kind === 'text-input' && row.element.contains(doc.activeElement),
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
      };
    });
    const signature = JSON.stringify([
      identity,
      surfaces.map(({ shape, protectedEnvelope, policy, compositionCapability, availability }) => [
        shape,
        protectedEnvelope,
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
  return {
    active(value) {
      observer.disconnect();
      resize.disconnect();
      types.forEach((type, i) => doc.removeEventListener(type, handlers[i]!, true));
      doc.removeEventListener('scroll', mark, true);
      doc.removeEventListener('focusin', mark, true);
      doc.removeEventListener('focusout', mark, true);
      doc.defaultView!.removeEventListener('resize', mark);
      doc.defaultView!.removeEventListener('blur', up);
      doc.defaultView!.removeEventListener('focus', mark);
      doc.fonts?.removeEventListener('loadingdone', mark);
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
          ],
        });
        resize.observe(doc.documentElement);
        observed.forEach((e) => resize.observe(e));
        types.forEach((type, i) => doc.addEventListener(type, handlers[i]!, { capture: true, passive: true }));
        doc.addEventListener('scroll', mark, { capture: true, passive: true });
        doc.addEventListener('focusin', mark, true);
        doc.addEventListener('focusout', mark, true);
        doc.defaultView!.addEventListener('resize', mark);
        doc.defaultView!.addEventListener('blur', up);
        doc.defaultView!.addEventListener('focus', mark);
        doc.fonts?.addEventListener('loadingdone', mark);
      }
      dirty = true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    capture,
    validate(snapshot, event) {
      if (!issued.has(snapshot) || snapshot.generation.documentId !== documentId) return false;
      if (event) dirty = true;
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
    overlaySlot,
    destroy() {
      observer.disconnect();
      resize.disconnect();
      listeners.clear();
      doc.removeEventListener('scroll', mark, true);
      doc.removeEventListener('focusin', mark, true);
      doc.removeEventListener('focusout', mark, true);
      doc.defaultView!.removeEventListener('resize', mark);
      doc.defaultView!.removeEventListener('blur', up);
      doc.defaultView!.removeEventListener('focus', mark);
      doc.fonts?.removeEventListener('loadingdone', mark);
      types.forEach((type, i) => doc.removeEventListener(type, handlers[i]!, true));
      rows = [];
      up();
    },
  };
}
