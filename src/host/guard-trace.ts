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

export function traceMovedInput(event: Event | undefined, held: number, now: number) {
  console.info(
    '[Web World Themes G1] 入力の直前に操作部品が動きました',
    JSON.stringify({ event: event?.type ?? 'commit', heldGeneration: held, currentGeneration: now }),
  );
}
