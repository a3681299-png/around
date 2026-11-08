import { AnimationMixer, Group, LoadingManager, MathUtils, Vector3, type AnimationAction } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AssetPort } from '../assets/port';
import { parseVerifiedModelSource } from '../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from '../renderers/three/vrma-clip';

export type ResidentAssets = {
  model: string;
  sit: string;
  stand: string;
  sitDown?: string;
  mannequin?: boolean;
};

const phases = ['sit', 'stand', 'sitDown'] as const;
type Pose = (typeof phases)[number];
export type SeatEdge = 'lower' | 'upper';

export function boardSeat(edge: SeatEdge, width: number, height: number, at = new Vector3()) {
  return at.set(-width * 0.27, (edge === 'upper' ? 0.5 : -0.5) * height, 3);
}

export async function loadResident(assets: AssetPort, ids: ResidentAssets) {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url;
    throw new Error('Playground VRM references an external resource.');
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const [gltf, animations] = await Promise.all([
    assets.load(ids.model).then((model) => parseVerifiedModelSource(model.modelBuffer!, loader)),
    Promise.all(
      phases.map(async (pose) => {
        const id = ids[pose];
        if (!id) return;
        const asset = await assets.load(id);
        return parseVrmAnimation(new Uint8Array(await asset.blob!.arrayBuffer()));
      }),
    ),
  ]);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.rotateVRM0(vrm);
  const avatar = new Group();
  avatar.add(vrm.scene);
  const mixer = new AnimationMixer(vrm.scene);
  const actions = new Map<Pose, AnimationAction>();
  animations.forEach((animation, i) => {
    if (animation) actions.set(phases[i]!, mixer.clipAction(vrmAnimationClip(animation, vrm)));
  });
  const hips = vrm.humanoid.getRawBoneNode('hips');
  const feet = [
    vrm.humanoid.getRawBoneNode('leftToes') ?? vrm.humanoid.getRawBoneNode('leftFoot'),
    vrm.humanoid.getRawBoneNode('rightToes') ?? vrm.humanoid.getRawBoneNode('rightFoot'),
  ];
  const joint = new Vector3();
  const root = new Group();
  root.visible = false;
  root.add(avatar);
  let edge: SeatEdge = 'lower';
  let arrivedAt = -Infinity;
  let teleportAt: number | undefined;
  let active: AnimationAction | undefined;
  const seat = new Vector3();

  function sample(pose: Pose, seconds: number, delta: number) {
    const action = actions.get(pose)!;
    if (action !== active) {
      active?.stop();
      action.reset().play();
      active = action;
    }
    action.paused = true;
    action.time = seconds;
    mixer.update(0);
    vrm.update(delta);
  }

  function place(at: Vector3, yaw: number, seatWeight: number, forwardOffset = 0) {
    root.position.copy(at);
    root.rotation.set(0, yaw, 0);
    avatar.position.set(0, 0, 0);
    root.updateWorldMatrix(true, true);
    const hip = hips ? root.worldToLocal(hips.getWorldPosition(joint)) : joint.set(0, 0, 0);
    const seatedY = 5 - hip.y;
    const seatedZ = -hip.z;
    const soleY = Math.min(...feet.map((foot) => (foot ? root.worldToLocal(foot.getWorldPosition(joint)).y : 0)));
    avatar.position.set(
      0,
      MathUtils.lerp(soleY * -1 + 2.5, seatedY, seatWeight),
      MathUtils.lerp(forwardOffset, seatedZ, seatWeight),
    );
  }

  // Normalize the first sampled pose onto the raw bones before attaching the model.
  sample('sit', 0, 0);
  return {
    root,
    dispose: () => VRMUtils.deepDispose(vrm.scene),
    updateBoard(
      time: number,
      delta: number,
      width: number,
      height: number,
      lowerHeadroom: number,
      { flee, show, reduced }: { flee: boolean; show: boolean; reduced: boolean },
    ) {
      // A crouched landing at the lower edge must still clear the player controls on short viewports.
      const boardScale = Math.min((ids.mannequin ? 88 : 147) * Math.min(1, height / 800), Math.max(68, lowerHeadroom));
      avatar.scale.setScalar(boardScale);
      if (reduced) {
        teleportAt = undefined;
        arrivedAt = -Infinity;
      }
      if (
        !reduced &&
        delta > 0 &&
        teleportAt === undefined &&
        (edge === 'lower' ? flee : !flee && time - arrivedAt >= 3.4)
      )
        teleportAt = time + 0.17;
      const landing = teleportAt !== undefined && time >= teleportAt;
      if (landing) {
        edge = edge === 'lower' ? 'upper' : 'lower';
        arrivedAt = time;
        teleportAt = undefined;
      }
      root.visible = show && teleportAt === undefined;
      if (!root.visible) return;
      const sinceLanding = time - arrivedAt;
      const seatDown = actions.get('sitDown');
      const sitting = sinceLanding >= 0.68;
      if (!sitting && seatDown) {
        // The clip's latter half starts on bent, planted legs and finishes at the seated idle.
        const weight = MathUtils.smoothstep(sinceLanding, 0.11, 0.64);
        sample('sitDown', seatDown.getClip().duration * MathUtils.lerp(0.37, 1, sinceLanding / 0.68), delta);
        place(boardSeat(edge, width, height, seat), 0.1, weight, -33);
      } else if (!sitting && sinceLanding < 0.13) {
        sample('stand', 0, delta);
        place(boardSeat(edge, width, height, seat), 0.1, 0, -33);
      } else {
        const duration = actions.get('sit')!.getClip().duration;
        sample('sit', duration ? time % duration : 0, delta);
        place(boardSeat(edge, width, height, seat), 0.1, 1);
      }
      if (landing) vrm.springBoneManager?.reset();
    },
  };
}
