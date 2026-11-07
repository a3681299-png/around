import { AnimationMixer, Group, LoadingManager, LoopRepeat, MathUtils, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AssetPort } from '../assets/port';
import { parseVerifiedModelSource } from '../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from '../renderers/three/vrma-clip';

export type ResidentAssets = { model: string; sit: string; mannequin?: boolean };

export async function loadResident(assets: AssetPort, ids: ResidentAssets) {
  const [model, sitAsset] = await Promise.all([assets.load(ids.model), assets.load(ids.sit)]);
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url;
    throw new Error('Playground VRM references an external resource.');
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const [gltf, sitAnimation] = await Promise.all([
    parseVerifiedModelSource(model.modelBuffer!, loader),
    parseVrmAnimation(new Uint8Array(await sitAsset.blob!.arrayBuffer())),
  ]);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.rotateVRM0(vrm);
  const avatar = new Group();
  avatar.add(vrm.scene);
  avatar.scale.setScalar(ids.mannequin ? 88 : 147);
  const mixer = new AnimationMixer(vrm.scene);
  mixer.clipAction(vrmAnimationClip(sitAnimation, vrm)).setLoop(LoopRepeat, Infinity).play();
  const hips = vrm.humanoid.getRawBoneNode('hips');
  const hipPosition = new Vector3();
  const root = new Group();
  root.add(avatar);
  return {
    root,
    dispose: () => VRMUtils.deepDispose(vrm.scene),
    update(time: number, delta: number, width: number, height: number, reduced: boolean) {
      const phase = reduced ? 0 : time % 16;
      // Float around the outside corner with the legs tucked in the seated pose.
      const trip = MathUtils.clamp(Math.min((phase - 5) / 3, (13 - phase) / 3), 0, 1);
      const along = MathUtils.smootherstep(trip, 0.25, 0.75);
      const out = MathUtils.smootherstep(trip, 0, 0.37) * MathUtils.smootherstep(1 - trip, 0, 0.37);
      const x = -width * (0.25 + out * 0.29);
      const y = (0.5 - along) * height + Math.sin(Math.PI * trip) * 9;
      mixer.update(delta);
      vrm.update(delta);
      vrm.scene.updateMatrixWorld(true);
      const hip = hips ? vrm.scene.worldToLocal(hips.getWorldPosition(hipPosition)).y : 0.6;
      avatar.position.y = -hip * avatar.scale.x;
      root.position.set(x, y + 4, 9);
      root.rotation.set(0.1 - out * 0.16, 0.12 + out * 0.38, out * 0.12);
    },
  };
}
