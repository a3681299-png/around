export type AnimationFormat = 'gif' | 'animated-webp' | 'lottie';
export interface AnimationInfo {
  format: AnimationFormat;
  frameCount: number;
  durationMs: number;
  frameDurationsMs?: number[];
  frameRate?: number;
}
export const ANIMATION_LIMITS = Object.freeze({
  count: 8, edge: 1024, pixels: 1024 * 1024, frames: 240, durationMs: 30_000,
  decodedPixels: 8 * 1024 * 1024, totalDecodedPixels: 16 * 1024 * 1024,
  lottieBytes: 1024 * 1024, lottieLayers: 128, shapes: 512, nodes: 50_000, depth: 32,
  speedMin: .25, speedMax: 3, renderFps: 30,
});
