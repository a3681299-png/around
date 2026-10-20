export type AnimationFormat = 'gif' | 'apng' | 'animated-webp' | 'webm' | 'lottie';
export interface AnimationInfo {
  format: AnimationFormat;
  frameCount: number;
  durationMs: number;
  frameDurationsMs?: number[];
  frameRate?: number;
  loopCount?: number;
  codec?: 'vp8' | 'vp9';
  alpha?: boolean;
}
export const ANIMATION_LIMITS = Object.freeze({
  count: 32,
  edge: 1024,
  durationMs: 30_000, // Vector/Lottie safety limits remain unchanged.
  lottieBytes: 1024 * 1024,
  lottieLayers: 128,
  shapes: 512,
  nodes: 50_000,
  depth: 32,
  speedMin: 0.25,
  speedMax: 3,
  renderFps: 30,
});
/** Container/one-frame safety limits, not a total decoded-animation pixel product. */
export const RASTER_LIMITS = Object.freeze({
  edge: 4096,
  pixels: 16 * 1024 * 1024,
  frames: 100_000,
  chunks: 300_000,
  decodeEdge: 2048,
});
