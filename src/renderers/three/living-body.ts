/**
 * The body of a character that moves by itself (docs/living-body.md): a few motions, blended and
 * corrected each frame, instead of one animation per action. The behaviour decides what to do
 * (src/characters/approach.ts: where it stands, how fast, where to look, where to reach); this
 * makes the body do it, in one fixed order every frame:
 *
 *   1. motions   idle and walk blended by speed; the walk's phase advances by distance walked
 *   2. posture   breathing, leaning into speed changes and turns, looking (chest, neck, head, eyes)
 *   3. legs      feet on the floor stay where they are (foot-plant), solved with two-bone IK
 *   4. arm       a hand goes to a point in the room (two-bone IK), the trunk leans in if it is far
 *   5. the model the VRM copies the pose to its own bones and moves hair, tail and clothes
 *
 * Everything is posed on the VRM's normalized humanoid bones (identity rest rotations, the same
 * for any model), so nothing here knows a particular skeleton. One clock: the caller's dt.
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
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { parseVerifiedModelSource, type VerifiedModelSource } from '../../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from './vrma-clip';
import type { HumanBone } from '../../characters/humanoid';
import { solveTwoBone, type Vec3 } from '../../characters/two-bone-ik';
import { footAtRest, footStrain, stepFoot, type FootState } from '../../characters/foot-plant';
import type { BodyIntent, BodyReach } from '../../characters/approach';

export interface LivingBodyMotions {
  idle: Uint8Array;
  walk: Uint8Array;
  /** Sitting down, seated (a loop) and standing up. Without them the body does not sit. */
  sitDown?: Uint8Array;
  sit?: Uint8Array;
  standUp?: Uint8Array;
}
export interface LivingBodyMetrics extends BodyReach {
  height: number;
  /** The speed the walk clip's feet keep, metres a second. */
  walkSpeed: number;
}
export interface LivingBodyFacts {
  /** How far a planted foot's contact moved over the floor, summed and the worst frame (metres). */
  slide: number;
  worstSlide: number;
  /** The same without the correction (what the blended motion alone would do). */
  rawSlide: number;
  steps: number;
  /** How far the reaching hand's tip is from the target (metres; undefined when not reaching). */
  reachGap: number | undefined;
  walkWeight: number;
}
export interface LivingBody {
  readonly root: Group;
  readonly metrics: LivingBodyMetrics;
  update(intent: BodyIntent, dt: number, floorY: number): void;
  facts(): LivingBodyFacts;
  dispose(): void;
}

const LOOK_YAW = 1.15;
const LOOK_PITCH = 0.55;
/** A reach never straightens the arm fully (a locked elbow looks stiff). */
const ARM_STRETCH = 0.97;
const LEAN_MAX = 0.42;

function blobShadow() {
  const canvas = new OffscreenCanvas(64, 64);
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const mesh = new Mesh(
    new CircleGeometry(0.3, 24),
    new MeshBasicMaterial({
      map: new CanvasTexture(canvas as unknown as HTMLCanvasElement),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

const tuple = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
/** Moves a value toward its goal so that the same seconds give the same result at any frame rate. */
const approach = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

/**
 * The walk clip as recorded travels forward (its hips move): take the straight travel out so it
 * plays on the spot (the behaviour moves the body), and report the travel, which is the stride.
 */
function walkInPlace(clip: AnimationClip, hipsName: string) {
  const track = clip.tracks.find((t) => t.name === `${hipsName}.position`);
  if (!track || track.times.length < 2) return 0;
  const { times, values } = track;
  const last = times.length - 1;
  const span = times[last]! - times[0]! || 1;
  const tx = values[last * 3]! - values[0]!,
    tz = values[last * 3 + 2]! - values[2]!;
  for (let i = 0; i <= last; i++) {
    const k = (times[i]! - times[0]!) / span;
    values[i * 3] = values[i * 3]! - tx * k;
    values[i * 3 + 2] = values[i * 3 + 2]! - tz * k;
  }
  return Math.hypot(tx, tz);
}

export async function loadLivingBody(source: VerifiedModelSource, motions: LivingBodyMotions): Promise<LivingBody> {
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
  const optional = (bytes: Uint8Array | undefined) => (bytes ? parseVrmAnimation(bytes) : undefined);
  const [idleAnimation, walkAnimation, sitDownAnimation, sitAnimation, standUpAnimation] = await Promise.all([
    parseVrmAnimation(motions.idle),
    parseVrmAnimation(motions.walk),
    optional(motions.sitDown),
    optional(motions.sit),
    optional(motions.standUp),
  ]);

  const root = new Group();
  root.add(vrm.scene);
  const shadow = blobShadow();
  root.add(shadow);
  // The body bends far from its rest box (a reach, a step): never cull it by that box.
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });

  const bone = (name: HumanBone) => vrm.humanoid.getNormalizedBoneNode(name);
  const need = (name: HumanBone) => {
    const node = bone(name);
    if (!node) throw new Error(`人型の骨がありません：${name}`);
    return node;
  };
  const hips = need('hips'),
    spine = need('spine'),
    head = need('head');
  const chest = bone('chest') ?? spine,
    neck = bone('neck') ?? head;
  const sides = (['left', 'right'] as const).map((side) => ({
    side,
    sign: side === 'left' ? 1 : -1,
    upperLeg: need(`${side}UpperLeg`),
    lowerLeg: need(`${side}LowerLeg`),
    foot: need(`${side}Foot`),
    toes: bone(`${side}Toes`),
    upperArm: need(`${side}UpperArm`),
    lowerArm: need(`${side}LowerArm`),
    hand: need(`${side}Hand`),
    finger: bone(`${side}MiddleDistal`) ?? bone(`${side}MiddleProximal`),
    restAnkle: 0,
    restToe: 0,
    plant: footAtRest(),
    lastContact: undefined as Vector3 | undefined,
    lastRaw: undefined as Vector3 | undefined,
    lastKind: 'toe' as 'toe' | 'ankle',
  }));

  // The rest pose (before any motion): the heights the feet stand at, the arm's reach.
  root.updateWorldMatrix(true, true);
  const v = new Vector3(),
    v2 = new Vector3(),
    v3 = new Vector3();
  const toeOf = (leg: (typeof sides)[number], out: Vector3) => {
    if (leg.toes) return leg.toes.getWorldPosition(out);
    // No toe bone: a point ahead of the ankle on the floor stands in for it.
    return out.set(0, -leg.restAnkle, 0.1).applyMatrix4(leg.foot.matrixWorld);
  };
  for (const leg of sides) {
    leg.restAnkle = leg.foot.getWorldPosition(v).y;
    leg.restToe = toeOf(leg, v).y;
  }
  const left = sides[0]!,
    right = sides[1]!;
  const shoulderL = left.upperArm.getWorldPosition(new Vector3()),
    shoulderR = right.upperArm.getWorldPosition(new Vector3());
  const upperArmLength = left.lowerArm.getWorldPosition(v).distanceTo(shoulderL),
    lowerArmLength = left.hand.getWorldPosition(v2).distanceTo(v);
  const handLength = left.finger ? left.finger.getWorldPosition(v).distanceTo(v2) + 0.015 : 0.07;
  const torso = Math.max(0.1, shoulderL.y - hips.getWorldPosition(v).y);
  const restHipsY = hips.position.y;

  const mixer = new AnimationMixer(vrm.scene);
  const idleClip = vrmAnimationClip(idleAnimation, vrm),
    walkClip = vrmAnimationClip(walkAnimation, vrm);
  const stride = walkInPlace(walkClip, hips.name);
  const walkSpeed = stride > 0.05 && walkClip.duration > 0 ? stride / walkClip.duration : 0.6;
  const play = (clip: AnimationClip): AnimationAction => {
    const action = mixer.clipAction(clip);
    action.play();
    // The clock is ours: each frame sets the clip's time, the mixer only blends.
    action.paused = true;
    return action;
  };
  const idle = play(idleClip),
    walk = play(walkClip);
  // Sitting: the three motions each with a weight of its own, eased toward what the behaviour asks.
  const seatClips = (
    [
      ['sitDown', sitDownAnimation],
      ['sit', sitAnimation],
      ['standUp', standUpAnimation],
    ] as const
  ).flatMap(([pose, animation]) => {
    if (!animation) return [];
    const clip = vrmAnimationClip(animation, vrm);
    return [{ pose, clip, action: play(clip), weight: 0 }];
  });

  const metrics: LivingBodyMetrics = {
    arm: upperArmLength + lowerArmLength + handLength,
    shoulderHeight: shoulderL.y,
    shoulderHalf: shoulderL.distanceTo(shoulderR) / 2,
    height: head.getWorldPosition(v).y + 0.12,
    walkSpeed,
  };

  // The eyes follow a point of their own (the VRM's look-at), eased between "ahead" and the target.
  const gaze = new Object3D();
  root.add(gaze);
  if (vrm.lookAt) vrm.lookAt.target = gaze;

  let time = 0,
    cycle = 0,
    walkWeight = 0,
    lastSpeed = 0,
    accel = 0,
    lean = 0,
    roll = 0,
    lookYaw = 0,
    lookPitch = 0,
    reachLean = 0;
  const facts: LivingBodyFacts = {
    slide: 0,
    worstSlide: 0,
    rawSlide: 0,
    steps: 0,
    reachGap: undefined,
    walkWeight: 0,
  };
  const q = new Quaternion(),
    q2 = new Quaternion(),
    q3 = new Quaternion();
  const UP = new Vector3(0, 1, 0);
  // The mixer writes a bone only when the blended motion's value changed since its last write, so
  // what steps 2–4 add to a bone would pile up frame after frame wherever the motion holds still.
  // Each frame starts by putting the bones this file changes back to what the motions last gave.
  const posed = [
    hips,
    spine,
    chest,
    neck,
    head,
    ...sides.flatMap((s) => [s.upperLeg, s.lowerLeg, s.foot, s.upperArm, s.lowerArm, s.hand]),
  ].filter((node, i, all) => all.indexOf(node) === i);
  const given = posed.map((node) => ({ node, q: node.quaternion.clone(), p: node.position.clone() }));

  /** Turns `joint` so that the point of its chain now at `from` comes to `to` (world). */
  const aim = (joint: Object3D, from: Vec3, to: Vec3) => {
    joint.getWorldPosition(v);
    v2.set(from[0] - v.x, from[1] - v.y, from[2] - v.z).normalize();
    v3.set(to[0] - v.x, to[1] - v.y, to[2] - v.z).normalize();
    q.setFromUnitVectors(v2, v3);
    setWorldQuaternion(joint, joint.getWorldQuaternion(q2).premultiply(q));
  };
  const setWorldQuaternion = (joint: Object3D, world: Quaternion) => {
    joint.parent!.getWorldQuaternion(q3).invert();
    joint.quaternion.copy(q3.multiply(world));
    joint.updateWorldMatrix(false, true);
  };

  return {
    root,
    metrics,
    update(intent, rawDt, floorY) {
      const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.1);
      time += dt;
      root.position.set(intent.x, floorY, intent.z);
      root.rotation.set(0, intent.heading, 0);

      // 1. Motions. The walk fades in with speed; its phase advances with the ground covered, so
      // the feet keep the floor's pace whether the body is starting, cruising or stopping. A slow
      // walk takes shorter steps (the blend with idle shortens them), so its cycle turns faster
      // than speed alone would say.
      const wantWalk = smooth(clamp(intent.speed / (walkSpeed * 0.55), 0, 1));
      walkWeight = approach(walkWeight, wantWalk, 9, dt);
      if (walkWeight < 0.002 && wantWalk === 0) walkWeight = 0;
      const stepLength = stride * (0.55 + 0.45 * walkWeight);
      if (stepLength > 0.01) cycle = (cycle + (intent.speed * dt) / stepLength) % 1;
      idle.time = time % (idleClip.duration || 1);
      walk.time = cycle * (walkClip.duration || 1);
      // Sitting motions take over from standing ones by their own eased weights (never a cut).
      let sitting = 0;
      for (const seat of seatClips) {
        // Seated is the fallback for a missing sit-down or stand-up motion.
        const wanted =
          intent.pose === seat.pose ||
          (seat.pose === 'sit' && intent.pose !== 'stand' && !seatClips.some((c) => c.pose === intent.pose));
        seat.weight = approach(seat.weight, wanted ? 1 : 0, 8, dt);
        if (seat.weight < 0.002 && !wanted) seat.weight = 0;
        sitting += seat.weight;
        const length = seat.clip.duration || 1;
        // One-shot motions follow the behaviour's own clock and hold their last frame.
        seat.action.time = seat.pose === 'sit' ? time % length : Math.min(length - 1e-3, Math.max(0, intent.poseTime));
      }
      const share = sitting > 1 ? 1 / sitting : 1;
      const standing = Math.max(0, 1 - sitting * share);
      for (const seat of seatClips) seat.action.setEffectiveWeight(seat.weight * share);
      idle.setEffectiveWeight((1 - walkWeight) * standing);
      walk.setEffectiveWeight(walkWeight * standing);
      for (const g of given) {
        g.node.quaternion.copy(g.q);
        g.node.position.copy(g.p);
      }
      mixer.update(0);
      for (const g of given) {
        g.q.copy(g.node.quaternion);
        g.p.copy(g.node.position);
      }

      // 2. Posture. Small, additive, on top of whatever the motions gave.
      accel = approach(accel, dt > 0 ? (intent.speed - lastSpeed) / dt : 0, 6, dt);
      lastSpeed = intent.speed;
      // Into the walk the trunk tips forward, stopping it rocks back; into a turn it tilts.
      lean = approach(lean, clamp(accel * 0.07 + intent.speed * 0.05, -0.08, 0.12), 6, dt);
      roll = approach(roll, clamp(-intent.turn * (0.012 + intent.speed * 0.05), -0.07, 0.07), 6, dt);
      const breath = Math.sin((time * Math.PI * 2) / 3.7) * 0.012 * (1 - walkWeight * 0.6);
      // Standing, the weight drifts from one leg to the other (slowly; not while walking).
      const sway = Math.sin((time * Math.PI * 2) / 9.1) * 0.006 * (1 - walkWeight);
      hips.position.x += sway;
      spine.rotateX(lean * 0.6 - breath * 0.5).rotateZ(roll);
      if (chest !== spine) chest.rotateX(lean * 0.4 + breath);

      // Looking: the eyes first (the VRM's own look-at), then the head, neck and chest share the
      // turn, each within what a neck can do.
      root.updateWorldMatrix(true, true);
      head.getWorldPosition(v);
      let wantYaw = 0,
        wantPitch = 0;
      if (intent.look && intent.lookWeight > 0) {
        v2.set(intent.look[0], intent.look[1], intent.look[2]);
        const local = root.worldToLocal(v2.clone()).sub(root.worldToLocal(v3.copy(v)));
        const yaw = Math.atan2(local.x, local.z),
          pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
        // Straight behind is neither side: keep the side the head is already turned to.
        wantYaw = clamp(
          Math.abs(yaw) > 2.6 && lookYaw !== 0 ? Math.sign(lookYaw) * LOOK_YAW : yaw,
          -LOOK_YAW,
          LOOK_YAW,
        );
        wantPitch = clamp(pitch, -LOOK_PITCH, LOOK_PITCH);
        wantYaw *= intent.lookWeight;
        wantPitch *= intent.lookWeight;
      }
      lookYaw = approach(lookYaw, wantYaw, 7, dt);
      lookPitch = approach(lookPitch, wantPitch, 7, dt);
      if (chest !== spine) chest.rotateY(lookYaw * 0.15);
      if (neck !== head) neck.rotateY(lookYaw * 0.3).rotateX(-lookPitch * 0.4);
      head.rotateY(lookYaw * (neck !== head ? 0.55 : 0.85)).rotateX(-lookPitch * (neck !== head ? 0.6 : 1));
      // The eyes: ahead of the face when idle, on the target when looking.
      gaze.position.set(0, v.y - floorY, 2);
      if (intent.look && intent.lookWeight > 0)
        gaze.position.lerp(
          root.worldToLocal(v2.set(intent.look[0], intent.look[1], intent.look[2])),
          intent.lookWeight,
        );

      // 4a. A far reach leans the trunk toward the target before the arm is solved (applied here,
      // with the rest of the posture, so the legs below see the final hips).
      const arm = intent.hand === 'left' ? left : right;
      let wantLean = 0;
      if (intent.reach && intent.reachWeight > 0) {
        root.updateWorldMatrix(true, true);
        arm.upperArm.getWorldPosition(v);
        const far = v.distanceTo(v2.set(intent.reach[0], intent.reach[1], intent.reach[2])) - handLength;
        wantLean = clamp((far - (upperArmLength + lowerArmLength) * 0.9) / torso, 0, LEAN_MAX) * intent.reachWeight;
      }
      reachLean = approach(reachLean, wantLean, 8, dt);
      if (reachLean > 1e-4) {
        spine.rotateX(reachLean * 0.5);
        if (chest !== spine) chest.rotateX(reachLean * 0.5);
        // The hips go back a little as the trunk goes forward (the balance of a real lean).
        hips.position.z -= reachLean * 0.06;
      }

      // 3. Legs. The feet the motion has on the floor stay on their spot; a foot left too far
      // behind steps. The hips come down when a pinned foot would be out of the leg's reach.
      root.updateWorldMatrix(true, true);
      // Seated: the hips go to the seat (the room's marker is where the hips rest), by as much
      // as the body is seated, so it lowers onto the seat instead of dropping there.
      if (intent.seat && intent.seated > 0) {
        hips.getWorldPosition(v);
        root.position.x += (intent.seat[0] - v.x) * intent.seated;
        root.position.y += (intent.seat[1] - v.y) * intent.seated;
        root.position.z += (intent.seat[2] - v.z) * intent.seated;
        root.updateWorldMatrix(true, true);
      }
      const samples = sides.map((leg) => {
        const ankle = leg.foot.getWorldPosition(new Vector3()),
          toe = toeOf(leg, new Vector3());
        return {
          ankle: tuple(ankle),
          toe: tuple(toe),
          ankleRise: ankle.y - floorY - leg.restAnkle,
          toeRise: toe.y - floorY - leg.restToe,
          yaw: Math.atan2(toe.x - ankle.x, toe.z - ankle.z),
        };
      });
      const strain = sides.map((leg) => footStrain(leg.plant));
      sides.forEach((leg, i) => {
        const other = sides[1 - i]!.plant;
        const before = leg.plant.step;
        // One foot at a time, the one left furthest behind first.
        const mayStep = other.down && other.step === undefined && strain[i]! >= strain[1 - i]!;
        leg.plant = stepFoot(leg.plant, samples[i]!, dt, mayStep);
        if (before === undefined && leg.plant.step !== undefined) facts.steps++;
      });
      let drop = 0;
      const targets = sides.map((leg, i) => {
        const p: FootState = leg.plant,
          s = samples[i]!;
        // The pin holds the contact (the toes, mostly), and the foot is turned back about the ankle:
        // the ankle goes where that turn leaves the toes on their spot.
        const ox = p.contact === 'toe' ? s.toe[0] - s.ankle[0] : 0,
          oz = p.contact === 'toe' ? s.toe[2] - s.ankle[2] : 0;
        const cos = Math.cos(p.dyaw),
          sin = Math.sin(p.dyaw);
        const target: Vec3 = [
          s.ankle[0] + p.dx + ox - (ox * cos + oz * sin),
          // Never under the floor (a seat lower than the motion's own would push the feet in).
          Math.max(floorY + leg.restAnkle * 0.85, s.ankle[1] + p.lift),
          s.ankle[2] + p.dz + oz - (-ox * sin + oz * cos),
        ];
        leg.upperLeg.getWorldPosition(v);
        const length = leg.lowerLeg.getWorldPosition(v2).distanceTo(v) + v2.distanceTo(v3.set(...s.ankle));
        const flat = Math.hypot(target[0] - v.x, target[2] - v.z),
          up = v.y - target[1];
        const reach = length * 0.995;
        if (flat < reach && Math.hypot(flat, up) > reach)
          drop = Math.max(drop, up - Math.sqrt(reach * reach - flat * flat));
        return target;
      });
      if (drop > 1e-4) {
        hips.position.y -= Math.min(0.12, drop) / (root.scale.y || 1);
        root.updateWorldMatrix(true, true);
      }
      const forward: Vec3 = [Math.sin(intent.heading), 0, Math.cos(intent.heading)];
      sides.forEach((leg, i) => {
        const p = leg.plant,
          s = samples[i]!;
        const corrected =
          Math.abs(p.dx) + Math.abs(p.dz) + Math.abs(p.lift) + Math.abs(p.dyaw) > 1e-5 ||
          drop > 1e-4 ||
          targets[i]![1] > s.ankle[1] + 1e-5;
        if (corrected) {
          const footWorld = leg.foot.getWorldQuaternion(new Quaternion());
          const hip = tuple(leg.upperLeg.getWorldPosition(v)),
            knee = tuple(leg.lowerLeg.getWorldPosition(v)),
            ankle = tuple(leg.foot.getWorldPosition(v));
          const solved = solveTwoBone(hip, knee, ankle, targets[i]!, forward);
          aim(leg.upperLeg, knee, solved.mid);
          aim(leg.lowerLeg, tuple(leg.foot.getWorldPosition(v)), solved.end);
          // The foot keeps the motion's own tilt, turned back by what the pin holds.
          setWorldQuaternion(leg.foot, footWorld.premultiply(q.setFromAxisAngle(UP, p.dyaw)));
        }
        // What the viewer sees: how far the planted contact moved over the floor this frame.
        const contact = p.contact === 'toe' ? toeOf(leg, new Vector3()) : leg.foot.getWorldPosition(new Vector3());
        const raw = new Vector3(...(p.contact === 'toe' ? s.toe : s.ankle));
        const pinned = p.down && p.step === undefined;
        // Heel to toe is another point of the foot, not a slide: measure from the new one on.
        if (leg.lastKind !== p.contact) leg.lastContact = leg.lastRaw = undefined;
        leg.lastKind = p.contact;
        if (pinned && leg.lastContact && leg.lastRaw) {
          const moved = Math.hypot(contact.x - leg.lastContact.x, contact.z - leg.lastContact.z);
          facts.slide += moved;
          facts.worstSlide = Math.max(facts.worstSlide, moved);
          facts.rawSlide += Math.hypot(raw.x - leg.lastRaw.x, raw.z - leg.lastRaw.z);
        }
        leg.lastContact = pinned ? contact : undefined;
        leg.lastRaw = pinned ? raw : undefined;
      });

      // 4b. Arm. The hand goes to the target (its fingertips on it), blended from wherever the
      // motion has it; the elbow bends down and out.
      facts.reachGap = undefined;
      if (intent.reach && intent.reachWeight > 0) {
        root.updateWorldMatrix(true, true);
        const shoulder = arm.upperArm.getWorldPosition(new Vector3()),
          elbow = arm.lowerArm.getWorldPosition(new Vector3()),
          wrist = arm.hand.getWorldPosition(new Vector3());
        const goal = new Vector3(intent.reach[0], intent.reach[1], intent.reach[2]);
        const along = goal.clone().sub(shoulder);
        const far = along.length();
        along.normalize();
        // The wrist stops a hand's length short, and never so far that the elbow locks.
        const wristGoal = shoulder
          .clone()
          .addScaledVector(along, Math.min(far - handLength, (upperArmLength + lowerArmLength) * ARM_STRETCH));
        const pole = new Vector3(arm.sign * 0.45, -1, -0.35).applyAxisAngle(UP, intent.heading);
        const reachLimit = (upperArmLength + lowerArmLength) * ARM_STRETCH;
        let solved = solveTwoBone(tuple(shoulder), tuple(elbow), tuple(wrist), tuple(wristGoal), tuple(pole));
        // The hand lies along the forearm, not along the line from the shoulder: put the wrist a
        // hand's length back along the forearm it will have (twice is enough to settle).
        for (let pass = 0; pass < 2; pass++) {
          const forearm = v
            .set(...solved.end)
            .sub(v2.set(...solved.mid))
            .normalize();
          wristGoal.copy(goal).addScaledVector(forearm, -handLength);
          const out = wristGoal.distanceTo(shoulder);
          if (out > reachLimit)
            wristGoal
              .sub(shoulder)
              .multiplyScalar(reachLimit / out)
              .add(shoulder);
          solved = solveTwoBone(tuple(shoulder), tuple(elbow), tuple(wrist), tuple(wristGoal), tuple(pole));
        }
        const target = wrist.clone().lerp(wristGoal, intent.reachWeight);
        solved = solveTwoBone(tuple(shoulder), tuple(elbow), tuple(wrist), tuple(target), tuple(pole));
        aim(arm.upperArm, tuple(elbow), solved.mid);
        aim(arm.lowerArm, tuple(arm.hand.getWorldPosition(v)), solved.end);
        // The hand opens flat along the forearm as it arrives (its rest pose on normalized bones).
        arm.hand.quaternion.slerp(q.identity(), intent.reachWeight);
        arm.hand.updateWorldMatrix(false, true);
        // The fingertips: a hand's length past the wrist, along the forearm (the hand lies flat).
        const from = arm.lowerArm.getWorldPosition(v2),
          to = arm.hand.getWorldPosition(v);
        const tip = to.clone().addScaledVector(to.clone().sub(from).normalize(), handLength);
        facts.reachGap = tip.distanceTo(goal);
      }

      // 5. The model: pose copied to its own bones, then hair, tail and clothes follow.
      hips.position.y = Math.max(restHipsY * 0.5, hips.position.y);
      vrm.update(dt);
      shadow.position.set(0, 0.004, 0);
      root.updateWorldMatrix(true, true);
      facts.walkWeight = walkWeight;
    },
    facts: () => ({ ...facts }),
    dispose() {
      mixer.stopAllAction();
      VRMUtils.deepDispose(vrm.scene);
      const material = shadow.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      shadow.geometry.dispose();
    },
  };
}
