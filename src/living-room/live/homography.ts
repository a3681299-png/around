/**
 * A flat card seen as a screen in the room (docs/living-live.md): the CSS matrix that puts a
 * card's four corners on the four points of the screen where the room's camera sees the corners
 * of a rectangle hanging in the room. The card (the video player, as it is) is then drawn by the
 * browser in the room's own perspective, and moves with the camera as a thing in the room does.
 *
 * Pure. `corners` are the card's top-left, top-right, bottom-right and bottom-left, in CSS pixels.
 */
export type Point = readonly [number, number];

export function quadMatrix(
  width: number,
  height: number,
  corners: readonly [Point, Point, Point, Point] | readonly Point[],
): number[] | undefined {
  const [p0, p1, p2, p3] = corners;
  if (!p0 || !p1 || !p2 || !p3 || !(width > 0) || !(height > 0)) return undefined;
  // A proper quad only: turning the same way at every corner, by more than a hair (a screen seen
  // edge on, or from behind, is no place to put a player).
  let turn = 0;
  const points = [p0, p1, p2, p3];
  for (let i = 0; i < 4; i++) {
    const a = points[i]!,
      b = points[(i + 1) % 4]!,
      c = points[(i + 2) % 4]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!Number.isFinite(cross) || Math.abs(cross) < 1 || (turn && Math.sign(cross) !== turn)) return undefined;
    turn = Math.sign(cross);
  }
  // The unit square onto the quad (Heckbert's projective mapping).
  const dx1 = p1[0] - p2[0],
    dx2 = p3[0] - p2[0],
    sx = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1],
    dy2 = p3[1] - p2[1],
    sy = p0[1] - p1[1] + p2[1] - p3[1];
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return undefined;
  const g = (sx * dy2 - dx2 * sy) / den,
    h = (dx1 * sy - sx * dy1) / den;
  // (Every corner in front of the eye.)
  if (1 + g <= 0 || 1 + h <= 0 || 1 + g + h <= 0) return undefined;
  const a = p1[0] - p0[0] + g * p1[0],
    b = p3[0] - p0[0] + h * p3[0],
    d = p1[1] - p0[1] + g * p1[1],
    e = p3[1] - p0[1] + h * p3[1];
  // As CSS wants it: column by column, for a card of `width` × `height` with its origin top-left.
  return [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, p0[0], p0[1], 0, 1];
}
