import { Euler, Quaternion, Vector3, type AnimationClip, type Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VRM } from '@pixiv/three-vrm';
import { createRigPlayer } from './rig-player';
import type { ModelEvaluation } from '../../world/models';
import type { ModelSettings } from '../../models/types';
import type { BodyPose } from '../../world/body-motion';
import { HUMAN_BONES, type HumanBone } from '../../characters/humanoid';
import { solveTwoBone, type Vec3 } from '../../characters/two-bone-ik';

/**
 * VRM components stay attached to their own scene. Runtime supplies pose and clock.
 * Embedded GLB clips address raw bones; a character's .vrma clips (`motions`) address the
 * normalized bones, so only then does humanoid.update() copy normalized → raw. One player
 * never mixes the two kinds.
 */
export function createVrmPlayer(
  gltf: GLTF,
  vrm: VRM,
  inPlace: boolean,
  motions?: readonly AnimationClip[],
  /** The body height in model units (metres): the scale of the computed hips offsets. */
  bodyHeight = 1,
) {
  const hips = motions ? vrm.humanoid.getNormalizedBoneNode('hips') : undefined;
  const rig = createRigPlayer(gltf, vrm.scene, inPlace, motions, hips ? new Set([hips.name]) : undefined),
    head = vrm.humanoid.getRawBoneNode('head');
  vrm.humanoid.autoUpdateHumanBones = Boolean(motions);
  vrm.scene.updateWorldMatrix(true, true);
  const parent = vrm.scene.parent,
    baseSpace = parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  const rest = head?.getWorldQuaternion(new Quaternion()).premultiply(baseSpace.invert()) ?? new Quaternion(),
    inverseRest = rest.clone().invert();
  let headBase: Quaternion | undefined,
    previousTime: number | undefined,
    springOn = true;
  // The computed motion (R3-2) is added in each bone's rest frame. The rest frames are read from
  // the raw rest pose once, when the first computed pose arrives (a VRM without a character never
  // pays for it); the bones go back to the pose they had right after.
  const bodyRest = new Map<HumanBone, { node: Object3D; rest: Quaternion; inverse: Quaternion }>();
  let restRead = false;
  const readRest = () => {
    if (restRead) return;
    restRead = true;
    const saved = HUMAN_BONES.map((name) => {
      const node = vrm.humanoid.getRawBoneNode(name);
      return node ? ([name, node, node.quaternion.clone(), node.position.clone()] as const) : undefined;
    });
    vrm.humanoid.resetRawPose();
    vrm.scene.updateWorldMatrix(true, true);
    // (baseSpace above was inverted in place by the head's rest; read the parent afresh.)
    const toCharacter = (parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert();
    for (const item of saved) {
      if (!item) continue;
      const restWorld = item[1].getWorldQuaternion(new Quaternion()).premultiply(toCharacter);
      bodyRest.set(item[0], { node: item[1], rest: restWorld, inverse: restWorld.clone().invert() });
    }
    for (const item of saved) {
      item?.[1].quaternion.copy(item[2]);
      item?.[1].position.copy(item[3]);
    }
    vrm.scene.updateWorldMatrix(true, true);
  };
  /** Bones the computed motion changed this paint, to put back before the next one. */
  const touched = new Map<Object3D, { quaternion: Quaternion; position: Vector3 }>();
  const remember = (node: Object3D) => {
    if (!touched.has(node)) touched.set(node, { quaternion: node.quaternion.clone(), position: node.position.clone() });
  };
  const restore = () => {
    if (head && headBase) head.quaternion.copy(headBase);
    headBase = undefined;
    for (const [node, base] of touched) {
      node.quaternion.copy(base.quaternion);
      node.position.copy(base.position);
    }
    touched.clear();
  };
  /** World-space rotation `delta` applied to a node, expressed in its parent's frame. */
  const rotateWorld = (node: Object3D, delta: Quaternion) => {
    const parent = node.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion(),
      world = node.getWorldQuaternion(new Quaternion());
    node.quaternion.copy(parent.invert().multiply(delta).multiply(world));
    node.updateWorldMatrix(false, true);
  };
  const legs = (['left', 'right'] as const).map((side) => ({
    upper: vrm.humanoid.getRawBoneNode(`${side}UpperLeg`),
    lower: vrm.humanoid.getRawBoneNode(`${side}LowerLeg`),
    foot: vrm.humanoid.getRawBoneNode(`${side}Foot`),
  }));
  const applyBody = (pose: BodyPose) => {
    readRest();
    const feet = pose.plantFeet ? legs.map((leg) => leg.foot?.getWorldPosition(new Vector3())) : [];
    for (const [name, euler] of Object.entries(pose.bones) as [HumanBone, readonly number[]][]) {
      const bone = bodyRest.get(name);
      if (!bone || !euler) continue;
      remember(bone.node);
      const offset = new Quaternion().setFromEuler(
        new Euler((euler[0]! * Math.PI) / 180, (euler[1]! * Math.PI) / 180, (euler[2]! * Math.PI) / 180, 'YXZ'),
      );
      bone.node.quaternion.multiply(bone.inverse.clone().multiply(offset).multiply(bone.rest));
    }
    const hips = bodyRest.get('hips')?.node;
    if (hips && (pose.hips[0] || pose.hips[1] || pose.hips[2])) {
      remember(hips);
      vrm.scene.updateWorldMatrix(true, true);
      // The offset is a fraction of the body height, in the model's own space (metres).
      const at = vrm.scene.worldToLocal(hips.getWorldPosition(new Vector3()));
      at.add(new Vector3(pose.hips[0], pose.hips[1], pose.hips[2]).multiplyScalar(bodyHeight));
      hips.position.copy(hips.parent!.worldToLocal(vrm.scene.localToWorld(at)));
    }
    vrm.scene.updateWorldMatrix(true, true);
    if (!pose.plantFeet) return;
    // The feet stay where the clip put them while the hips dip: two-bone IK on each leg, bending
    // the knee toward the character's front.
    const forward = new Vector3(0, 0, 1).transformDirection(vrm.scene.matrixWorld);
    legs.forEach((leg, i) => {
      const target = feet[i];
      if (!leg.upper || !leg.lower || !leg.foot || !target) return;
      const p = (node: Object3D) => node.getWorldPosition(new Vector3()).toArray() as [number, number, number];
      const root = p(leg.upper),
        mid = p(leg.lower),
        end = p(leg.foot);
      const solved = solveTwoBone(root, mid, end, target.toArray() as Vec3, forward.toArray() as Vec3);
      remember(leg.upper);
      remember(leg.lower);
      const from = (a: Vec3, b: Vec3) => new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      rotateWorld(leg.upper, new Quaternion().setFromUnitVectors(from(root, mid), from(root, solved.mid)));
      const midNow = p(leg.lower),
        endNow = p(leg.foot);
      rotateWorld(leg.lower, new Quaternion().setFromUnitVectors(from(midNow, endNow), from(midNow, solved.end)));
    });
  };
  if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
  return {
    paint(frame: ModelEvaluation, model: ModelSettings, timeMs: number) {
      restore();
      rig.paint(frame, { ...model, look: { ...model.look, enabled: false } });
      // Normalized → raw copy (VRM.update's first step) before the head offset, so .vrma poses
      // keep the look-at turn. Without .vrma motions autoUpdateHumanBones is off: a no-op.
      vrm.humanoid.update();
      // Computed motion goes on the clip pose, before the look-at turn and the expressions.
      if (frame.pose) applyBody(frame.pose);
      const options = model.vrm!,
        active = !frame.suspended && model.playing;
      const elapsed = previousTime === undefined ? 0 : timeMs - previousTime;
      const reset =
        previousTime === undefined ||
        elapsed < 0 ||
        elapsed > 250 ||
        springOn !== options.springBone ||
        frame.resetDynamics === true;
      previousTime = timeMs;
      springOn = options.springBone;
      const dt = active && !reset ? Math.min(100, Math.max(0, elapsed)) / 1000 : 0;
      if (reset) vrm.springBoneManager?.reset();
      const follow = model.look.enabled,
        headFraction = follow && options.headFollow ? 0.55 : 0;
      if (head && headFraction) {
        headBase = head.quaternion.clone();
        const offset = new Quaternion().setFromEuler(
          new Euler(
            (frame.lookPitch * headFraction * Math.PI) / 180,
            (frame.lookYaw * headFraction * Math.PI) / 180,
            0,
            'YXZ',
          ),
        );
        // Convert canonical face axes into this author's raw head bone axes.
        head.quaternion.multiply(inverseRest.clone().multiply(offset).multiply(rest));
      }
      const expressions = vrm.expressionManager;
      if (expressions)
        for (const name of Object.keys(expressions.expressionMap))
          expressions.setValue(
            name,
            // The computed blink never opens eyes the author closed.
            name === 'blink' && frame.pose
              ? Math.max(options.expressions[name] ?? 0, frame.pose.blink)
              : (options.expressions[name] ?? 0),
          );
      if (vrm.lookAt) {
        vrm.lookAt.yaw = follow && options.lookAt ? frame.lookYaw * (1 - headFraction) : 0;
        vrm.lookAt.pitch = follow && options.lookAt ? frame.lookPitch * (1 - headFraction) : 0;
      }
      vrm.scene.updateWorldMatrix(true, true);
      // Same order as VRM.update (humanoid already updated above), with an explicit pause for SpringBone.
      vrm.lookAt?.update(dt);
      expressions?.update();
      vrm.nodeConstraintManager?.update();
      if (options.springBone) vrm.springBoneManager?.update(dt);
      for (const material of vrm.materials ?? [])
        (material as typeof material & { update?: (delta: number) => void }).update?.(dt);
      return {
        head: head?.quaternion.toArray() ?? [],
        eyes: ['leftEye', 'rightEye'].map(
          (name) => vrm.humanoid.getRawBoneNode(name as 'leftEye' | 'rightEye')?.quaternion.toArray() ?? [],
        ),
        expressions: Object.fromEntries(
          Object.keys(options.expressions).map((name) => [name, expressions?.getValue(name) ?? 0]),
        ),
      };
    },
    destroy() {
      restore();
      rig.destroy();
      vrm.lookAt?.reset();
    },
  };
}

export const isVrm = (gltf: GLTF): VRM | undefined => gltf.userData['vrm'] as VRM | undefined;
export function disposeInstanceSkeletons(root: Object3D) {
  root.traverse((node) => {
    (node as Object3D & { skeleton?: { dispose(): void } }).skeleton?.dispose();
  });
}
