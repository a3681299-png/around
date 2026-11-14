/**
 * The character living in the room (docs/living-room.md), drawn inside the room's own scene: the
 * room's furniture hides it by depth (behind the desk, in the chair), at the room's real scale.
 * The world decides where it is and what it does (src/world/room-life.ts); this poses the body
 * with the character's own motions and places it.
 *
 * Only verified assets: the VRM passes the same checks as any 3D layer (parseVerifiedModelSource
 * with a loader that refuses any URL but its own blob textures), the motions are .vrma checked by
 * inspectVrma (parseVrmAnimation).
 */
import {
  AnimationMixer,
  CanvasTexture,
  CircleGeometry,
  Group,
  LoadingManager,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { parseVerifiedModelSource, type VerifiedModelSource } from '../../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from './vrma-clip';
import { WALK_SPEED, type ResidentPose } from '../../world/room-life';

/** The body's clips by what the world asks for. Missing ones fall back (see `pick`). */
export type ResidentClipName = ResidentPose['clip'];
export interface ResidentMotionBytes {
  name: ResidentClipName;
  bytes: Uint8Array;
}

export interface RoomResident {
  readonly root: Group;
  /** Poses and places the body; `dt` advances the springs and the blink. */
  update(pose: ResidentPose, dt: number): void;
  dispose(): void;
}

/** A soft round shadow under the body (the asset contract's shadow_ shapes come later). */
function blobShadow() {
  const canvas = new OffscreenCanvas(64, 64) as unknown as HTMLCanvasElement;
  const g = (canvas as unknown as OffscreenCanvas).getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new CircleGeometry(0.32, 24),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

export async function loadRoomResident(
  source: VerifiedModelSource,
  motions: readonly ResidentMotionBytes[],
): Promise<RoomResident> {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url;
    throw new Error('GLBからの外部アクセスを拒否しました。');
  });
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await parseVerifiedModelSource(source, loader);
  const vrm = gltf.userData['vrm'] as VRM | undefined;
  if (!vrm) throw new Error('VRMのHumanoidを読み込めませんでした。');
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.rotateVRM0(vrm);
  const animations = await Promise.all(
    motions.map(async (m) => ({ name: m.name, animation: await parseVrmAnimation(m.bytes) })),
  );
  const avatar = new Group();
  avatar.add(vrm.scene);
  const root = new Group();
  root.add(avatar);
  const shadow = blobShadow();
  root.add(shadow);
  root.visible = false;
  // Light only the character (the room is baked): its materials are the only lit ones.
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  const mixer = new AnimationMixer(vrm.scene);
  const clips = new Map<ResidentClipName, AnimationClip>();
  for (const { name, animation } of animations) clips.set(name, vrmAnimationClip(animation, vrm));
  // Fallbacks: a body without a crouch hides standing, one without a hop fades instead, a missing
  // stand-up plays the sit-down backwards (pick returns which way).
  const pick = (name: ResidentClipName): { clip: AnimationClip; reverse: boolean } | undefined => {
    const own = clips.get(name);
    if (own) return { clip: own, reverse: false };
    if (name === 'standUp' && clips.get('sitDown')) return { clip: clips.get('sitDown')!, reverse: true };
    const fallback = clips.get(name === 'sitDown' || name === 'standUp' ? 'sit' : 'idle') ?? clips.get('idle');
    return fallback ? { clip: fallback, reverse: false } : undefined;
  };
  const actions = new Map<AnimationClip, AnimationAction>();
  const action = (clip: AnimationClip) => {
    let a = actions.get(clip);
    if (!a) actions.set(clip, (a = mixer.clipAction(clip)));
    return a;
  };
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  const rawHips = vrm.humanoid.getRawBoneNode('hips');
  const feet = [
    vrm.humanoid.getRawBoneNode('leftToes') ?? vrm.humanoid.getRawBoneNode('leftFoot'),
    vrm.humanoid.getRawBoneNode('rightToes') ?? vrm.humanoid.getRawBoneNode('rightFoot'),
  ];
  // The walk clip moves the hips forward over its length (its stride): played at the pace that
  // covers the world's walking speed, the feet do not slide; the forward travel itself is taken
  // out (the world moves the body along its path).
  const walk = clips.get('walk');
  const hipsTrack = hips ? walk?.tracks.find((t) => t.name === `${hips.name}.position`) : undefined;
  const values = hipsTrack?.values;
  const stride = values && values.length >= 6 ? Math.abs(values[values.length - 1]! - values[2]!) : 0;
  const walkPace = walk && stride > 0.05 ? (WALK_SPEED * walk.duration) / stride : 1;
  const restHips = hips?.position.clone() ?? new Vector3();
  let active: AnimationAction | undefined;
  const joint = new Vector3();
  let fade = 1;
  const materials: Material[] = [];
  vrm.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.push(m);
  });
  const setOpacity = (opacity: number) => {
    if (Math.abs(opacity - fade) < 1e-3) return;
    fade = opacity;
    for (const m of materials) {
      m.transparent = opacity < 0.999 || (m.userData['aroundTransparent'] ??= m.transparent);
      m.opacity = opacity;
      m.needsUpdate = true;
    }
    (shadow.material as MeshBasicMaterial).opacity = opacity;
  };
  for (const m of materials) m.userData['aroundTransparent'] = m.transparent;

  return {
    root,
    update(pose, dt) {
      root.visible = pose.visible && pose.opacity > 0.01;
      if (!root.visible) return;
      setOpacity(pose.opacity);
      const chosen = pick(pose.clip);
      if (chosen) {
        const a = action(chosen.clip);
        if (a !== active) {
          active?.stop();
          a.reset().play();
          active = a;
        }
        a.paused = true;
        const duration = chosen.clip.duration || 1;
        const pace = pose.clip === 'walk' ? walkPace : 1;
        // One-shot clips (sit down, stand up, the hop) are stretched over the world's own timing.
        const oneShot = pose.clip === 'sitDown' || pose.clip === 'standUp' || pose.clip === 'hop';
        let t = oneShot ? Math.min(duration, pose.time * (duration / 0.7)) : (pose.time * pace) % duration;
        if (chosen.reverse) t = duration - t;
        a.time = t;
        mixer.update(0);
        // In place: the world carries the body; only the hips' rise and fall stay.
        if (hips && pose.clip === 'walk') {
          hips.position.x = restHips.x;
          hips.position.z = restHips.z;
        }
      }
      vrm.update(Math.min(0.1, Math.max(0, dt)));
      root.position.set(pose.x, pose.y, pose.z);
      root.rotation.set(0, pose.heading, 0);
      avatar.position.set(0, 0, 0);
      root.updateWorldMatrix(true, true);
      // Standing: the soles on the floor. Seated: the hips at the seat's marker (the asset contract
      // puts it at the hips), blended over the sit-down so the body lowers rather than drops.
      const sole = Math.min(...feet.map((f) => (f ? root.worldToLocal(f.getWorldPosition(joint)).y : 0)));
      const hip = rawHips ? root.worldToLocal(rawHips.getWorldPosition(joint)).y : 0.8;
      const standY = -sole;
      const seatY = pose.seatY - pose.y - hip;
      avatar.position.y = MathUtils.lerp(standY, seatY, pose.seat);
      // The shadow stays on the floor under the body.
      shadow.position.set(0, pose.floorY + 0.004 - pose.y, 0);
      shadow.scale.setScalar(pose.seat > 0.5 ? 0.8 : 1);
      root.updateWorldMatrix(true, true);
    },
    dispose() {
      mixer.stopAllAction();
      VRMUtils.deepDispose(vrm.scene);
      (shadow.material as MeshBasicMaterial).map?.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      shadow.geometry.dispose();
    },
  };
}
