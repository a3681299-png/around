import type { HumanBone, Vec3 } from './humanoid';

/** Facts measured from a .vrma at import (src/assets/vrma.ts). Pure data: World may read it. */
export interface VrmAnimationInfo {
  format: 'vrma';
  name: string;
  /** Seconds; 0 for a one-frame pose. */
  duration: number;
  /** Humanoid bones the file maps, in the engine's bone order. */
  bones: HumanBone[];
  hipsTranslation: boolean;
  /** Hips height of the file's own rest pose (metres); players scale hips motion by model/this. */
  restHipsHeight: number;
  /** Last minus first hips position in the file's own units (x, up, forward). */
  hipsTravel: Vec3;
}
