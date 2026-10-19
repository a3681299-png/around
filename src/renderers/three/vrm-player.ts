import { Euler, Quaternion, type Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { createRigPlayer } from './rig-player';
import type { ModelEvaluation } from '../../world/models';
import type { ModelSettings } from '../../models/types';

/** VRM components stay attached to their own scene. Runtime supplies pose and clock. */
export function createVrmPlayer(gltf: GLTF, vrm: VRM, inPlace: boolean) {
  const rig = createRigPlayer(gltf, vrm.scene, inPlace), head = vrm.humanoid.getRawBoneNode('head');
  vrm.humanoid.autoUpdateHumanBones = false; // Embedded GLB clips address raw bones. Future VRMA addresses normalized bones.
  vrm.scene.updateWorldMatrix(true, true);
  const parent = vrm.scene.parent, baseSpace = parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  const rest = head?.getWorldQuaternion(new Quaternion()).premultiply(baseSpace.invert()) ?? new Quaternion(), inverseRest = rest.clone().invert();
  let headBase: Quaternion | undefined, previousTime: number | undefined, springOn = true;
  const restore = () => { if (head && headBase) head.quaternion.copy(headBase); headBase = undefined; };
  if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
  return {
    paint(frame: ModelEvaluation, model: ModelSettings, timeMs: number) {
      restore(); rig.paint(frame, { ...model, look: { ...model.look, enabled: false } });
      const options = model.vrm!, active = !frame.suspended && model.playing;
      const elapsed = previousTime === undefined ? 0 : timeMs - previousTime;
      const reset = previousTime === undefined || elapsed < 0 || elapsed > 250 || springOn !== options.springBone;
      previousTime = timeMs; springOn = options.springBone;
      const dt = active && !reset ? Math.min(100, Math.max(0, elapsed)) / 1000 : 0;
      if (reset) vrm.springBoneManager?.reset();
      const follow = model.look.enabled, headFraction = follow && options.headFollow ? .55 : 0;
      if (head && headFraction) {
        headBase = head.quaternion.clone();
        const offset = new Quaternion().setFromEuler(new Euler(frame.lookPitch * headFraction * Math.PI / 180, frame.lookYaw * headFraction * Math.PI / 180, 0, 'YXZ'));
        // Convert canonical face axes into this author's raw head bone axes.
        head.quaternion.multiply(inverseRest.clone().multiply(offset).multiply(rest));
      }
      const expressions = vrm.expressionManager;
      if (expressions) for (const name of Object.keys(expressions.expressionMap)) expressions.setValue(name, options.expressions[name] ?? 0);
      if (vrm.lookAt) { vrm.lookAt.yaw = follow && options.lookAt ? frame.lookYaw * (1 - headFraction) : 0; vrm.lookAt.pitch = follow && options.lookAt ? frame.lookPitch * (1 - headFraction) : 0; }
      vrm.scene.updateWorldMatrix(true, true);
      // Same order as VRM.update, with an explicit pause for SpringBone.
      vrm.humanoid.update(); vrm.lookAt?.update(dt); expressions?.update(); vrm.nodeConstraintManager?.update();
      if (options.springBone) vrm.springBoneManager?.update(dt);
      for (const material of vrm.materials ?? []) (material as typeof material & { update?: (delta: number) => void }).update?.(dt);
      return { head: head?.quaternion.toArray() ?? [], eyes: ['leftEye', 'rightEye'].map((name) => vrm.humanoid.getRawBoneNode(name as 'leftEye' | 'rightEye')?.quaternion.toArray() ?? []), expressions: Object.fromEntries(Object.keys(options.expressions).map((name) => [name, expressions?.getValue(name) ?? 0])) };
    },
    destroy() { restore(); rig.destroy(); vrm.lookAt?.reset(); },
  };
}

export const isVrm = (gltf: GLTF): VRM | undefined => gltf.userData['vrm'] as VRM | undefined;
export function disposeInstanceSkeletons(root: Object3D) { root.traverse((node) => { (node as Object3D & { skeleton?: { dispose(): void } }).skeleton?.dispose(); }); }
