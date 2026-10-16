import type { AnimationInfo } from '../assets/motion-types';

export function frameAt(info: AnimationInfo, elapsed: number): number {
  if (info.format === 'lottie') return Math.min(info.frameCount - 1, Math.floor(elapsed / 1000 * info.frameRate!));
  let end = 0;
  for (const [index, duration] of info.frameDurationsMs!.entries()) { end += duration; if (elapsed < end) return index; }
  return info.frameCount - 1;
}
