import { IMAGE_LIMITS, type ImagePlacement } from './types';

export interface PlacementFrame { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const precise = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;
export const rotation = (degrees: number) => precise(((degrees + 180) % 360 + 360) % 360 - 180);

export function centre(placement: ImagePlacement, frame: PlacementFrame): Point {
  return { x: frame.left + frame.width * placement.x, y: frame.top + frame.height * placement.y };
}

export function movePlacement(start: ImagePlacement, frame: PlacementFrame, delta: Point): ImagePlacement {
  return { ...start, x: precise(clamp(start.x + delta.x / frame.width, 0, 1)), y: precise(clamp(start.y + delta.y / frame.height, 0, 1)) };
}

export interface PlacementSample { id: string; placement: ImagePlacement; frame: PlacementFrame }
export interface PlacementChange { id: string; placement: ImagePlacement }

export interface Bounds { left: number; top: number; right: number; bottom: number }
export function placementBounds(placement: ImagePlacement, frame: PlacementFrame): Bounds {
  const point = centre(placement, frame), angle = placement.rotationDeg * Math.PI / 180;
  const width = Math.abs(Math.cos(angle)) * placement.widthPx + Math.abs(Math.sin(angle)) * placement.heightPx;
  const height = Math.abs(Math.sin(angle)) * placement.widthPx + Math.abs(Math.cos(angle)) * placement.heightPx;
  return { left: point.x - width / 2, right: point.x + width / 2, top: point.y - height / 2, bottom: point.y + height / 2 };
}
export function groupBounds(samples: readonly PlacementSample[]): Bounds | undefined {
  if (!samples.length) return undefined;
  const bounds = samples.map(({ placement, frame }) => placementBounds(placement, frame));
  return { left: Math.min(...bounds.map((b) => b.left)), right: Math.max(...bounds.map((b) => b.right)), top: Math.min(...bounds.map((b) => b.top)), bottom: Math.max(...bounds.map((b) => b.bottom)) };
}

/** Clamp one screen-space delta for the entire group, then convert each anchor once. */
export function moveGroup(samples: readonly PlacementSample[], delta: Point): PlacementChange[] {
  if (!samples.length) return [];
  const x = clamp(delta.x, Math.max(...samples.map(({ placement: p, frame: f }) => -p.x * f.width)), Math.min(...samples.map(({ placement: p, frame: f }) => (1 - p.x) * f.width)));
  const y = clamp(delta.y, Math.max(...samples.map(({ placement: p, frame: f }) => -p.y * f.height)), Math.min(...samples.map(({ placement: p, frame: f }) => (1 - p.y) * f.height)));
  return samples.map(({ id, placement, frame }) => ({ id, placement: movePlacement(placement, frame, { x, y }) }));
}

export function reanchorPlacement(start: ImagePlacement, from: PlacementFrame, to: PlacementFrame, anchor: ImagePlacement['anchor']): ImagePlacement {
  const point = centre(start, from);
  return { ...start, anchor, x: precise(clamp((point.x - to.left) / to.width, 0, 1)), y: precise(clamp((point.y - to.top) / to.height, 0, 1)) };
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
