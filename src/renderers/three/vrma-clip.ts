import { LoadingManager, type AnimationClip } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { inspectVrma } from '../../assets/vrma';

/**
 * Untrusted .vrma bytes → VRMAnimation. The bytes pass `inspectVrma` first (no URIs, meshes,
 * expressions or other extensions), and the loader still refuses any URL as a second guard.
 */
export async function parseVrmAnimation(bytes: Uint8Array): Promise<VRMAnimation> {
  inspectVrma(bytes);
  const manager = new LoadingManager();
  manager.setURLModifier(() => {
    throw new Error('VRMアニメーションからの外部アクセスを拒否しました。');
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  // The loader keeps views into the buffer; give it its own copy.
  const gltf = await loader.parseAsync(bytes.slice().buffer, '');
  const animation = (gltf.userData['vrmAnimations'] as VRMAnimation[] | undefined)?.[0];
  if (!animation) throw new Error('VRMアニメーションを読み込めませんでした。');
  return animation;
}

/**
 * A clip addressing the model's normalized humanoid bones. The library scales hips motion by
 * (model hips height ÷ motion rest hips height), which is the first, automatic hips-height
 * correction (docs/r3-plan.md 2). Playing it needs the normalized → raw bone copy
 * (`humanoid.autoUpdateHumanBones`), so a model mixes either embedded clips or VRMA, not both.
 */
export const vrmAnimationClip = (animation: VRMAnimation, vrm: VRM): AnimationClip =>
  createVRMAnimationClip(animation, vrm);
