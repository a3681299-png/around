import {
  AnimationClip,
  AnimationMixer,
  Euler,
  Quaternion,
  LoopOnce,
  LoopRepeat,
  PropertyBinding,
  type AnimationAction,
  type Object3D,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelSettings } from '../../models/types';
import type { ModelEvaluation } from '../../world/models';

/** Clip sampling only. Time/transition decisions are supplied by World Runtime. */
export function createRigPlayer(gltf: GLTF, root: Object3D, inPlace: boolean) {
  const mixer = new AnimationMixer(root);
  const clips = gltf.animations.map(
    (source) =>
      new AnimationClip(
        source.name,
        source.duration,
        source.tracks.map((track) => {
          if (!inPlace) return track;
          const parsed = PropertyBinding.parseTrackName(track.name),
            node = PropertyBinding.findNode(root, parsed.nodeName) as Object3D | null;
          const bone = node as (Object3D & { isBone?: boolean }) | null;
          if (
            parsed.propertyName !== 'position' ||
            !node ||
            !(node === root || node.parent === root || (bone?.isBone && !(node.parent as typeof bone)?.isBone))
          )
            return track;
          // Immutable tracks are shared with the asset. Copy only root translations
          // that In-place actually edits, rather than every clip for every instance.
          const copy = track.clone(),
            stride = copy.values.length / copy.times.length,
            cubic = stride === 9;
          for (let n = 0; n < copy.times.length; n++) {
            if (cubic) {
              copy.values[n * 9] = copy.values[n * 9 + 2] = copy.values[n * 9 + 6] = copy.values[n * 9 + 8] = 0;
            }
            const at = n * stride + (cubic ? 3 : 0);
            copy.values[at] = node.position.x;
            copy.values[at + 2] = node.position.z;
          }
          return copy;
        }),
        source.blendMode,
      ),
  );
  const originals: Object3D[] = [],
    copies: Object3D[] = [],
    bones = new Map<number, Object3D>();
  gltf.scene.traverse((o) => originals.push(o));
  root.traverse((o) => copies.push(o));
  originals.forEach((o, i) => {
    const node = gltf.parser.associations.get(o)?.nodes;
    if (node !== undefined && copies[i]) bones.set(node, copies[i]!);
  });
  let lookNode: Object3D | undefined, beforeLook: Quaternion | undefined;
  const restoreLook = () => {
    if (lookNode && beforeLook) lookNode.quaternion.copy(beforeLook);
    lookNode = undefined;
    beforeLook = undefined;
  };
  const actions: AnimationAction[] = clips.map((clip) => mixer.clipAction(clip));
  return {
    paint(frame: ModelEvaluation, model: ModelSettings) {
      restoreLook();
      actions.forEach((action, index) => {
        const active = index === frame.clip || index === frame.previousClip;
        if (!active) {
          action.enabled = false;
          return;
        }
        action.setLoop(model.loop ? LoopRepeat : LoopOnce, model.loop ? Infinity : 1);
        action.clampWhenFinished = true;
        action.enabled = true;
        action.paused = true;
        action.play();
        action.setEffectiveWeight(index === frame.clip ? frame.blend : 1 - frame.blend);
        action.time = (index === frame.clip ? frame.timeMs : frame.previousTimeMs) / 1000;
      });
      if (frame.clip === null && frame.previousClip === null) mixer.stopAllAction();
      mixer.update(0);
      if (model.look.enabled && model.look.bone !== null) {
        lookNode = bones.get(model.look.bone);
        if (lookNode) {
          beforeLook = lookNode.quaternion.clone();
          lookNode.quaternion.multiply(
            new Quaternion().setFromEuler(
              new Euler((frame.lookPitch * Math.PI) / 180, (frame.lookYaw * Math.PI) / 180, 0, 'YXZ'),
            ),
          );
        }
      }
    },
    destroy() {
      restoreLook();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      clips.forEach((clip) => mixer.uncacheClip(clip));
    },
  };
}
