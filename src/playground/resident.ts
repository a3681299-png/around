import { AnimationMixer, Group, LoadingManager, LoopRepeat, MathUtils, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AssetPort } from '../assets/port';
import { parseVerifiedModelSource } from '../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from '../renderers/three/vrma-clip';

export type ResidentAssets = { model: string; sit: string; walk: string; mannequin?: boolean };

export async function loadResident(assets: AssetPort, ids: ResidentAssets) {
  const [model, sitAsset, walkAsset] = await Promise.all([
    assets.load(ids.model),
    assets.load(ids.sit),
    assets.load(ids.walk),
  ]);
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url;
    throw new Error('Playground VRM references an external resource.');
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const [gltf, sitAnimation, walkAnimation] = await Promise.all([
    parseVerifiedModelSource(model.modelBuffer!, loader),
    parseVrmAnimation(new Uint8Array(await sitAsset.blob!.arrayBuffer())),
    parseVrmAnimation(new Uint8Array(await walkAsset.blob!.arrayBuffer())),
  ]);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.rotateVRM0(vrm);
  const avatar = new Group();
  avatar.add(vrm.scene);
  avatar.scale.setScalar(ids.mannequin ? 69 : 96);
  const mixer = new AnimationMixer(vrm.scene);
  const sit = mixer.clipAction(vrmAnimationClip(sitAnimation, vrm)).setLoop(LoopRepeat, Infinity).play();
  const walk = mixer.clipAction(vrmAnimationClip(walkAnimation, vrm)).setLoop(LoopRepeat, Infinity).play();
  const hips = vrm.humanoid.getRawBoneNode('hips');
  const hipPosition = new Vector3();
  const root = new Group();
  root.add(avatar);
  return {
    root,
    dispose: () => VRMUtils.deepDispose(vrm.scene),
    update(time: number, delta: number, width: number, height: number, reduced: boolean) {
      const phase = reduced ? 0 : time % 16;
      const top = phase < 5 || phase >= 13;
      const moving = (phase >= 5 && phase < 8) || (phase >= 10 && phase < 13);
      // Travel around the outer edge, clear of the UI, and put the hips on the lip when seated.
      const trip = phase < 8 ? (phase - 5) / 3 : (13 - phase) / 3;
      const weight = moving
        ? Math.min(MathUtils.smoothstep(trip, 0, 0.11), 1 - MathUtils.smoothstep(trip, 0.89, 1))
        : 0;
      const out = moving
        ? Math.min(MathUtils.smoothstep(trip, 0.11, 0.27), 1 - MathUtils.smoothstep(trip, 0.73, 0.89))
        : 0;
      const along = moving ? MathUtils.smoothstep(trip, 0.27, 0.73) : Number(!top);
      const x = width * (0.28 + out * 0.28);
      const y = (0.5 - along) * height + Math.cos(along * Math.PI) * weight * 42;
      sit.setEffectiveWeight(1 - weight);
      walk.setEffectiveWeight(weight);
      mixer.update(delta);
      vrm.update(delta);
      vrm.scene.updateMatrixWorld(true);
      const hip = hips ? vrm.scene.worldToLocal(hips.getWorldPosition(hipPosition)).y : 0.6;
      avatar.position.y = -hip * avatar.scale.x + weight * 34;
      root.position.set(x, y + 4, 9);
      root.rotation.y = -0.18 - weight * 0.54;
      root.rotation.x = 0.1;
    },
  };
}
