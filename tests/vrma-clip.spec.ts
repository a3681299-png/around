import { test, expect } from '@playwright/test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, VectorKeyframeTrack } from 'three';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { parseVrmAnimation, vrmAnimationClip } from '../src/renderers/three/vrma-clip';
import { vrmaFixture, overflowingHipsVrma } from './helpers/vrma-fixture';
import { vrmFixture } from './helpers/vrm-fixture';

/** The test rig without its texture: node has no image decoder. */
async function loadVrm(): Promise<VRM> {
  const bytes = vrmFixture((j) => {
    // Hips 0.45 m above the root: half the motion's 0.9 m rest height.
    j.nodes[2].translation = [0, 0.45, 0];
    delete j.images;
    delete j.textures;
    delete j.materials[0].pbrMetallicRoughness.baseColorTexture;
  });
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  const gltf = await loader.parseAsync(new Uint8Array(bytes).slice().buffer, '');
  return gltf.userData['vrm'] as VRM;
}

test('a .vrma becomes a clip on the normalized bones, hips motion scaled to the model', async () => {
  const animation = await parseVrmAnimation(new Uint8Array(vrmaFixture()));
  const vrm = await loadVrm();
  const clip = vrmAnimationClip(animation, vrm);
  expect(clip.duration).toBeCloseTo(1, 6);
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
  const position = clip.tracks.find((t) => t.name === `${hips.name}.position`) as VectorKeyframeTrack;
  expect(position).toBeTruthy();
  // Motion rest hips 0.9 m, model hips 0.45 m: every hips key is halved (0.9 → 0.45, 0.5 → 0.25).
  expect(vrm.humanoid.normalizedRestPose.hips!.position![1]).toBeCloseTo(0.45, 6);
  expect(position.values[1]).toBeCloseTo(0.45, 5);
  expect(position.values[7]).toBeCloseTo(0.25, 5);
  expect(position.values[8]).toBeCloseTo(0.05, 5);
  // Every track targets a node inside this VRM's scene.
  for (const track of clip.tracks)
    expect(vrm.scene.getObjectByName(track.name.split('.')[0]!), track.name).toBeTruthy();
  // World-owned clock: setting the time and updating by 0 poses the spine.
  const mixer = new AnimationMixer(vrm.scene),
    action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.time = 1;
  mixer.update(0);
  expect(vrm.humanoid.getNormalizedBoneNode('spine')!.quaternion.x).toBeCloseTo(0.2, 4);
});

test('a one-frame pose plays as a clip of length 0', async () => {
  const animation = await parseVrmAnimation(
    new Uint8Array(vrmaFixture({ times: [0], hips: [[0, 0.5, 0]], rotations: [[0.3, 0, 0, Math.sqrt(1 - 0.09)]] })),
  );
  const clip = vrmAnimationClip(animation, await loadVrm());
  expect(clip.duration).toBe(0);
});

test('bytes that fail inspection never reach the loader', async () => {
  await expect(
    parseVrmAnimation(new Uint8Array(vrmaFixture({}, (j) => (j.buffers[0].uri = 'https://example.com/x.bin')))),
  ).rejects.toThrow();
});

test('overflowing derived hips height is refused before the animation loader', async () => {
  await expect(parseVrmAnimation(new Uint8Array(overflowingHipsVrma()))).rejects.toThrow();
});
