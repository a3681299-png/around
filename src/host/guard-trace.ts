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

export function traceMovedInput(event: Event | undefined, held: number, now: number) {
  console.info(
    '[Web World Themes G1] 入力の直前に操作部品が動きました',
    JSON.stringify({ event: event?.type ?? 'commit', heldGeneration: held, currentGeneration: now }),
  );
}
