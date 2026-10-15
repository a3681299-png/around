import { IMAGE_LIMITS, type ImagePlacement } from './types';

export interface PlacementFrame { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const precise = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export const rotation = (degrees: number) => precise(((degrees + 180) % 360 + 360) % 360 - 180);

export function centre(placement: ImagePlacement, frame: PlacementFrame): Point {
  return { x: frame.left + frame.width * placement.x, y: frame.top + frame.height * placement.y };
}

export function movePlacement(start: ImagePlacement, frame: PlacementFrame, delta: Point): ImagePlacement {
  return { ...start, x: precise(clamp(start.x + delta.x / frame.width, 0, 1)), y: precise(clamp(start.y + delta.y / frame.height, 0, 1)) };
}

/** Uniform corner scaling in local image coordinates; opposite corner stays fixed. */
export function resizePlacement(start: ImagePlacement, frame: PlacementFrame, delta: Point, sx: number, sy: number): ImagePlacement {
  const angle = start.rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = delta.x * cos + delta.y * sin, dy = -delta.x * sin + delta.y * cos;
  const scale = clamp(1 + (sx * dx * start.widthPx + sy * dy * start.heightPx) / (start.widthPx ** 2 + start.heightPx ** 2),
    IMAGE_LIMITS.minSize / Math.min(start.widthPx, start.heightPx), IMAGE_LIMITS.maxSize / Math.max(start.widthPx, start.heightPx));
  const widthPx = Math.round(start.widthPx * scale * 10) / 10;
  const heightPx = Math.round(start.heightPx * scale * 10) / 10;
  const ox = sx * (widthPx - start.widthPx) / 2, oy = sy * (heightPx - start.heightPx) / 2;
  return { ...movePlacement(start, frame, { x: ox * cos - oy * sin, y: ox * sin + oy * cos }), widthPx, heightPx };
}

export function rotatePlacement(start: ImagePlacement, frame: PlacementFrame, from: Point, to: Point): ImagePlacement {
  const origin = centre(start, frame);
  const delta = Math.atan2(to.y - origin.y, to.x - origin.x) - Math.atan2(from.y - origin.y, from.x - origin.x);
  return { ...start, rotationDeg: rotation(start.rotationDeg + delta * 180 / Math.PI) };
}
