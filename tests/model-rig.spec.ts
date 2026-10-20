import { test, expect } from '@playwright/test';
import { AnimationClip, Bone, Group, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createRigPlayer } from '../src/renderers/three/rig-player';
import { defaultModelSettings, type ModelInfo } from '../src/models/types';
import type { ModelEvaluation } from '../src/world/models';

test('In-place copies only modified translations, preserves source motion and Y, and look never accumulates', () => {
  const scene = new Group(),
    bone = new Bone();
  scene.name = 'Character';
  bone.name = 'Hips';
  scene.add(bone);
  const track = new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 10, 2, 5]);
  const clip = new AnimationClip('Authored', 1, [
    track,
    new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.5, 0.8660254]),
  ]);
  const gltf = {
    scene,
    scenes: [scene],
    animations: [clip],
    asset: { version: '2.0' },
    cameras: [],
    userData: {},
    parser: { associations: new Map([[bone, { nodes: 0 }]]) },
  } as unknown as GLTF;
  const source: ModelInfo = {
      format: 'glb',
      clips: [{ name: 'Authored', duration: 1 }],
      bones: [{ node: 0, name: 'Hips' }],
      vertices: 0,
      triangles: 0,
      textureBytes: 0,
    },
    settings = defaultModelSettings(source);
  const root = scene.clone(true),
    original = [...track.values],
    player = createRigPlayer(gltf, root, true),
    posed = root.getObjectByName('Hips')!;
  const frame: ModelEvaluation = {
    id: 'rig',
    clip: 0,
    timeMs: 500,
    previousClip: null,
    previousTimeMs: 0,
    fadeElapsedMs: 250,
    fadeDurationMs: 250,
    yawDeg: 0,
    lookYaw: 20,
    lookPitch: 10,
    suspended: false,
    phase: 'manual',
    blend: 1,
    speedPx: 0,
  };
  player.paint(frame, settings);
  expect(posed.position.toArray()).toEqual([0, 1, 0]);
  expect([...track.values]).toEqual(original);
  settings.look.enabled = true;
  settings.look.bone = 0;
  player.paint(frame, settings);
  const first = posed.quaternion.toArray();
  player.paint(frame, settings);
  expect(posed.quaternion.toArray()).toEqual(first);
  expect(bone.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  player.destroy();
  const full = scene.clone(true),
    raw = createRigPlayer(gltf, full, false);
  raw.paint(frame, { ...settings, look: { ...settings.look, enabled: false } });
  expect(full.getObjectByName('Hips')!.position.toArray()).toEqual([5, 1, 2.5]);
  raw.destroy();
});
