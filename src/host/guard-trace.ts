/**
 * Development only (WW_GUARD_TRACE=1, written to .work): why an input check stopped drawing. Calls
 * sit behind the WW_GUARD_TRACE label, which the normal build drops, so nothing here ships.
 * Read it in the page's DevTools console, under the extension's content-script context.
 */
const describe = (element: Element | null | undefined) => {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return {
    element: `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${[...element.classList]
      .slice(0, 3)
      .map((name) => '.' + name)
      .join('')}`,
    label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    },
  };
};

export function traceMissedInput(
  event: MouseEvent,
  hit: Element | null,
  expected: readonly { id: string; element: Element }[],
) {
  console.info(
    '[Web World Themes G1] クリック先の照合が合いませんでした',
    JSON.stringify({
      event: event.type,
      point: { x: event.clientX, y: event.clientY },
      expected: expected.map((row) => ({ surface: row.id, ...describe(row.element) })),
      actual: describe(hit),
    }),
  );
}

/** Changes of the approach rule and of the input state it reads, newest last. Kept on the root
 * element as data-ww-guard-approach as well, so a live test can read it from the page. */
const approachLog: unknown[] = [];
export function traceApproach(
  doc: Document,
  change: 'approach' | 'interacting' | 'forget',
  record: {
    value: boolean;
    event?: Event;
    point?: { x: number; y: number };
    interacting?: boolean;
    surfaces?: readonly import('../world/operations').OperationSurface[];
    /** G1.2: the near controls and the roots they hold, after this change. */
    approach?: import('../world/operations').ApproachState;
  },
) {
  const near = (record.surfaces ?? []).filter(
    (s) =>
      s.availability.visible &&
      s.policy.occlusion !== 'allow' &&
      record.point &&
      Math.max(
        s.shape.left - record.point.x,
        record.point.x - (s.shape.left + s.shape.width),
        s.shape.top - record.point.y,
        record.point.y - (s.shape.top + s.shape.height),
      ) <= 72,
  );
  const ids = (test: (s: import('../world/operations').OperationSurface) => boolean) =>
    (record.surfaces ?? []).filter(test).map((s) => s.id);
  const entry = {
    at: Math.round(doc.defaultView!.performance.now()),
    change,
    value: record.value,
    ...(record.event
      ? {
          event: record.event.type,
          ...(record.event instanceof KeyboardEvent ? { key: record.event.key } : {}),
          target: describe(record.event.target instanceof Element ? record.event.target : null)?.element ?? null,
        }
      : {}),
    ...(change === 'approach'
      ? {
          point: record.point ?? null,
          interacting: record.interacting,
          focused: ids((s) => s.availability.focused && s.policy.occlusion !== 'allow'),
          dragging: ids((s) => s.availability.dragging),
          captured: ids((s) => s.availability.captured),
          nearPoint: near.slice(0, 6).map((s) => ({ id: s.id, shape: s.shape })),
          near: [...(record.approach?.near.keys() ?? [])],
          held: Object.fromEntries(record.approach?.held ?? []),
          active: describe(doc.activeElement)?.element ?? null,
          hasFocus: doc.hasFocus(),
        }
      : {}),
  };
  approachLog.push(entry);
  if (approachLog.length > 40) approachLog.shift();
  doc.documentElement.setAttribute('data-ww-guard-approach', JSON.stringify(approachLog));
  console.info('[Web World Themes G1] 接近の判定', JSON.stringify(entry));
}

/** G1.3 round 0: why reads during scroll hide the artwork. What reached the source since its last
 * read (page scroll, inner scroll, mutations, resize, focus), then what each read changed, both in
 * viewport and in document coordinates, and the guard's HOLD / SHIFTED with their entry. Kept on
 * the root element as data-ww-guard-geometry, newest last. */
const geometryLog: unknown[] = [];
let causes: Record<string, number> = {};
let mutated: string[] = [],
  looked: string[] = [],
  firstLayout: number | undefined;
let lastRead: Map<string, { viewport: string; document: string; element: Element }> | undefined;
let lastGeneration = -1;
const writeGeometry = (doc: Document, entry: Record<string, unknown>) => {
  geometryLog.push({ at: Math.round(doc.defaultView!.performance.now()), ...entry });
  if (geometryLog.length > 400) geometryLog.shift();
  doc.documentElement.setAttribute('data-ww-guard-geometry', JSON.stringify(geometryLog));
};
export function traceGeometryCause(kind: string, detail?: Event | readonly MutationRecord[]) {
  if (kind === 'scroll' && detail instanceof Event)
    kind = detail.target instanceof Document ? 'scroll' : 'inner-scroll';
  causes[kind] = (causes[kind] ?? 0) + 1;
  if (!Array.isArray(detail)) return;
  // childList: element nodes only (text-only changes never reach the guard).
  const elements = (nodes: NodeList) => [...nodes].filter((n) => n instanceof Element).length;
  // A batch that was not a look change lists what made it so first: element additions or
  // removals, then attributes other than class/style. Look changes keep only a few entries, so a
  // playing seek bar does not crowd the reason out.
  const weight = (r: MutationRecord) =>
    r.type === 'childList'
      ? elements(r.addedNodes) + elements(r.removedNodes)
        ? 2
        : 0
      : /^(class|style)$/.test(r.attributeName ?? '')
        ? 0
        : 1;
  const list = kind === 'mutation-look' ? looked : mutated,
    cap = kind === 'mutation-look' ? 4 : 16;
  // The batch that first made this window a layout change: the reason drawing waited.
  if (kind === 'mutation-layout' && !firstLayout) firstLayout = mutated.length;
  for (const r of [...(detail as readonly MutationRecord[])].sort((a, b) => weight(b) - weight(a))) {
    if (list.length >= cap) break;
    const target = r.target instanceof Element ? (describe(r.target)?.element ?? '?') : r.target.nodeName;
    list.push(
      `${kind.startsWith('mutation-') ? kind.slice('mutation-'.length) + ' ' : ''}${
        r.type === 'attributes'
          ? `${target}[${r.attributeName}]`
          : `${target}(+${elements(r.addedNodes)}/-${elements(r.removedNodes)} elements)`
      }`,
    );
  }
}
/** Ancestors (self included) whose position can change with scroll without any mutation (D7). */
const scrollDependent = (element: Element) => {
  const found: string[] = [];
  for (let e: Element | null = element; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    const marks = [
      s.position === 'sticky' ? 'sticky' : '',
      s.contentVisibility && s.contentVisibility !== 'visible' ? `content-visibility:${s.contentVisibility}` : '',
      (s as CSSStyleDeclaration & { animationTimeline?: string }).animationTimeline &&
      !['auto', 'none', ''].includes((s as CSSStyleDeclaration & { animationTimeline?: string }).animationTimeline!)
        ? `animation-timeline:${(s as CSSStyleDeclaration & { animationTimeline?: string }).animationTimeline}`
        : '',
    ].filter(Boolean);
    if (marks.length) found.push(`${describe(e)?.element}{${marks.join(',')}}`);
  }
  return found;
};
export function traceGeometryRead(
  doc: Document,
  snapshot: import('../world/operations').OperationSnapshot,
  rows: readonly { id: string; element: Element }[],
) {
  // `changed` counts every scroll, resize, fonts and ResizeObserver callback; the trace's own
  // listeners count the first three, so the remainder came from the ResizeObserver.
  const observed =
    (causes['changed'] ?? 0) -
    (causes['scroll'] ?? 0) -
    (causes['inner-scroll'] ?? 0) -
    (causes['resize'] ?? 0) -
    (causes['fonts'] ?? 0);
  delete causes['changed'];
  if (observed > 0) causes['resize-observer'] = observed;
  const bumped = snapshot.generation.geometry !== lastGeneration;
  lastGeneration = snapshot.generation.geometry;
  const view = doc.defaultView!,
    sx = view.scrollX,
    sy = view.scrollY;
  const elements = new Map(rows.map((row) => [row.id, row.element]));
  const next = new Map<string, { viewport: string; document: string; element: Element }>();
  for (const s of snapshot.surfaces) {
    if (!s.availability.visible) continue;
    const r = s.shape,
      box = s.scrollBox;
    const shift = s.scrolls ? { x: sx, y: sy } : { x: 0, y: 0 };
    // Sticky columns are unbounded (±1e7) and inner scroll boxes of page content move with the page.
    const boxShift = box && box.height < 1e6 ? shift : { x: 0, y: 0 };
    next.set(s.id, {
      viewport: JSON.stringify([
        r.left,
        r.top,
        r.width,
        r.height,
        box ? [box.left, box.top, box.width, box.height] : 0,
      ]),
      document: JSON.stringify([
        Math.round((r.left + shift.x) * 100) / 100,
        Math.round((r.top + shift.y) * 100) / 100,
        r.width,
        r.height,
        box
          ? [
              Math.round((box.left + boxShift.x) * 100) / 100,
              Math.round((box.top + boxShift.y) * 100) / 100,
              box.width,
              box.height,
            ]
          : 0,
      ]),
      element: elements.get(s.id) ?? doc.documentElement,
    });
  }
  const added = [...next.keys()].filter((id) => !lastRead?.has(id)),
    removed = [...(lastRead?.keys() ?? [])].filter((id) => !next.has(id)),
    viewportMoved = [...next].filter(([id, v]) => lastRead?.has(id) && lastRead.get(id)!.viewport !== v.viewport),
    documentMoved = viewportMoved.filter(([id, v]) => lastRead!.get(id)!.document !== v.document);
  const onlyScroll = Object.keys(causes).length > 0 && Object.keys(causes).every((k) => k === 'scroll');
  writeGeometry(doc, {
    change: 'read',
    scroll: [sx, sy],
    bumped,
    causes,
    mutated: [...mutated, ...looked],
    ...(firstLayout !== undefined ? { firstLayout: mutated[firstLayout] ?? null } : {}),
    visible: next.size,
    added: added.length,
    removed: removed.length,
    addedIds: added.slice(0, 6),
    removedIds: removed.slice(0, 6),
    viewportMoved: viewportMoved.length,
    documentMoved: documentMoved.length,
    // Moved in document coordinates though only the page scrolled since the last read (D7).
    ...(onlyScroll && documentMoved.length
      ? {
          scrollOnlyMoved: documentMoved.slice(0, 6).map(([id, v]) => ({
            id,
            before: lastRead!.get(id)!.document,
            after: v.document,
            element: describe(v.element)?.element ?? null,
            dependsOnScroll: scrollDependent(v.element),
          })),
        }
      : documentMoved.length
        ? { documentMovedIds: documentMoved.slice(0, 6).map(([id]) => id) }
        : {}),
  });
  causes = {};
  mutated = [];
  looked = [];
  firstLayout = undefined;
  lastRead = next;
}
export function traceGuardStop(
  doc: Document,
  change: 'hold' | 'shifted' | 'release',
  detail: { entry?: 'boundary' | 'validate'; wait?: number; before?: string; after?: string; reason?: string },
) {
  let diff: unknown;
  if (detail.before && detail.after) {
    // boundaryKey: [supported, viewport, rows of [id, capability, policy, left, width, (top, height)?, scrollBox]]
    const [s0, v0, a] = JSON.parse(detail.before) as [boolean, unknown, unknown[][]];
    const [s1, v1, b] = JSON.parse(detail.after) as [boolean, unknown, unknown[][]];
    const byId = (rows: unknown[][]) => new Map(rows.map((row) => [row[0] as string, JSON.stringify(row)]));
    const ma = byId(a),
      mb = byId(b);
    diff = {
      supported: s0 === s1 ? undefined : [s0, s1],
      viewport: JSON.stringify(v0) === JSON.stringify(v1) ? undefined : [v0, v1],
      added: [...mb.keys()].filter((id) => !ma.has(id)).slice(0, 8),
      removed: [...ma.keys()].filter((id) => !mb.has(id)).slice(0, 8),
      changed: [...mb]
        .filter(([id, row]) => ma.has(id) && ma.get(id) !== row)
        .slice(0, 8)
        .map(([id, row]) => ({ id, before: ma.get(id), after: row })),
      changedCount: [...mb].filter(([id, row]) => ma.has(id) && ma.get(id) !== row).length,
    };
  }
  writeGeometry(doc, {
    change,
    ...(detail.entry ? { entry: detail.entry } : {}),
    ...(detail.wait !== undefined ? { wait: Math.round(detail.wait) } : {}),
    ...(detail.reason ? { reason: detail.reason } : {}),
    ...(diff ? { diff } : {}),
  });
}

/** D11: one check of the subtrees whose children changed, with how many it read. */
export function traceSubtreeCheck(doc: Document, unchanged: boolean, roots: number, controls: number) {
  writeGeometry(doc, { change: 'subtree-check', result: unchanged ? 'unchanged' : 'changed', roots, controls });
}

export function traceMovedInput(event: Event | undefined, held: number, now: number) {
  console.info(
    '[Web World Themes G1] 入力の直前に操作部品が動きました',
    JSON.stringify({ event: event?.type ?? 'commit', heldGeneration: held, currentGeneration: now }),
  );
}
