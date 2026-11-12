/**
 * Where on a window's frame the resident can put a hand (docs/living-desktop.md): points just
 * outside its bottom edge and the lower part of its sides, in CSS pixels. Outside, because the
 * window is drawn over the room: a hand under it would be hidden behind the glass.
 */
export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function edgeSamples(rect: EdgeRect, gap: number): [number, number][] {
  const w = rect.right - rect.left,
    h = rect.bottom - rect.top;
  const out: [number, number][] = [];
  for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) out.push([rect.left + w * k, rect.bottom + gap]);
  for (const k of [0.6, 0.85]) {
    out.push([rect.left - gap, rect.top + h * k]);
    out.push([rect.right + gap, rect.top + h * k]);
  }
  return out;
}
