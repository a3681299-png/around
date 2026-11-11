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
import { draw } from '../../world/room-life';

export interface LivingBodyMotions {
  idle: Uint8Array;
  walk: Uint8Array;
  /** A run or jog loop, blended in above the walk's own pace. Without it the body only walks. */
  run?: Uint8Array;
  /** Sitting down, seated (a loop) and standing up. Without them the body does not sit. */
  sitDown?: Uint8Array;
  sit?: Uint8Array;
  standUp?: Uint8Array;
}
export interface LivingBodyMetrics extends BodyReach {
  height: number;
  /** The speed the walk clip's feet keep, metres a second. */
  walkSpeed: number;
  /** The same for the run (the walk's when there is no run). */
  runSpeed: number;
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
  const [idleAnimation, walkAnimation, runAnimation, sitDownAnimation, sitAnimation, standUpAnimation] =
    await Promise.all([
      parseVrmAnimation(motions.idle),
      parseVrmAnimation(motions.walk),
      optional(motions.run),
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
  // A run (optional) shares the walk's cycle: the two are blended by speed, on one phase.
  const runClip = runAnimation ? vrmAnimationClip(runAnimation, vrm) : undefined;
  const runStride = runClip ? walkInPlace(runClip, hips.name) : 0;
  const run = runClip && runStride > stride ? play(runClip) : undefined;
  const runSpeed = run && runClip ? runStride / (runClip.duration || 1) : walkSpeed;
  // Both loops are two steps long, but may begin on different feet: find the shift (none or half
  // a cycle) at which the run's feet go the same way as the walk's.
  let runShift = 0;
  if (run && runClip) {
    const gait = (action: AnimationAction, clip: AnimationClip, shift: number) => {
      const out: number[] = [];
      for (const other of [idle, walk, run]) other.setEffectiveWeight(other === action ? 1 : 0);
      for (let i = 0; i < 8; i++) {
        action.time = ((i / 8 + shift) % 1) * clip.duration;
        mixer.update(0);
        root.updateWorldMatrix(true, true);
        out.push(sides[0]!.foot.getWorldPosition(v).z - sides[1]!.foot.getWorldPosition(v2).z);
      }
      return out;
    };
    const walking = gait(walk, walkClip, 0);
    const match = (shift: number) => gait(run, runClip, shift).reduce((sum, value, i) => sum + value * walking[i]!, 0);
    runShift = match(0.5) > match(0) ? 0.5 : 0;
    idle.setEffectiveWeight(1);
    walk.setEffectiveWeight(0);
    run.setEffectiveWeight(0);
  }
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
    runSpeed,
  };

  // Ears and tail are spring chains (they swing by themselves). To act with them, the pull on
  // their springs is turned: up for pricked ears and a raised tail, sideways for a wag. The
  // chains then move there in their own time, which is the overlap an animator would draw.
  const springs = [...(vrm.springBoneManager?.joints ?? [])].map((joint) => ({
    joint,
    kind: /ear/i.test(joint.bone.name) ? 'ear' : /tail/i.test(joint.bone.name) ? 'tail' : 'other',
    power: joint.settings.gravityPower,
    dir: joint.settings.gravityDir.clone(),
  }));
  const expressions = vrm.expressionManager;
  // Blinks and idle glances come at times drawn from a fixed sequence (the same every run).
  let drawn = 0;
  const next = () => draw(0x51ed, drawn++);
  let blinkAt = 1.5,
    blink = 0,
    glanceAt = 3,
    glanceUntil = 0,
    glanceYaw = 0,
    glancePitch = 0,
    twitchAt = 5;

  // The eyes follow a point of their own (the VRM's look-at), eased between "ahead" and the target.
  const gaze = new Object3D();
  root.add(gaze);
  if (vrm.lookAt) vrm.lookAt.target = gaze;

  let time = 0,
    cycle = 0,
    walkWeight = 0,
    runWeight = 0,
    lastSpeed = 0,
    accel = 0,
    lean = 0,
    leanSpeed = 0,
    trail = 0,
    roll = 0,
    squash = 0,
    squashSpeed = 0,
    wasHopping = false,
    eyes = 0,
    lookYaw = 0,
    lookPitch = 0,
    chestYaw = 0,
    tilt = 0,
    joy = 0,
    relax = 0,
    reachLean = 0;
  /** A spring toward a goal that overshoots a little before it rests (the body's follow-through). */
  const spring = (value: number, speed: number, goal: number, stiff: number, damp: number, dt: number) => {
    // Small fixed slices: the same wobble at any frame rate, and never unstable.
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(1 / 240, left);
      speed += (-stiff * stiff * (value - goal) - 2 * damp * stiff * speed) * h;
      value += speed * h;
    }
    return [value, speed] as const;
  };
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
      // A dart comes on at once (the blend must not lag the burst of speed); a walk eases in.
      walkWeight = approach(walkWeight, wantWalk, intent.mood === 'interest' ? 22 : 9, dt);
      if (walkWeight < 0.002 && wantWalk === 0) walkWeight = 0;
      // Faster than the walk's own pace, the run is mixed in: longer strides, not hurried feet.
      const wantRun = run ? clamp((intent.speed - walkSpeed) / Math.max(0.1, runSpeed - walkSpeed), 0, 1) : 0;
      runWeight = approach(runWeight, wantRun, 14, dt);
      const stepLength = stride * (0.55 + 0.45 * walkWeight) * (1 - runWeight) + runStride * runWeight;
      if (stepLength > 0.01) cycle = (cycle + (intent.speed * dt) / stepLength) % 1;
      idle.time = time % (idleClip.duration || 1);
      walk.time = cycle * (walkClip.duration || 1);
      if (run && runClip) run.time = ((cycle + runShift) % 1) * (runClip.duration || 1);
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
      walk.setEffectiveWeight(walkWeight * (1 - runWeight) * standing);
      run?.setEffectiveWeight(walkWeight * runWeight * standing);
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
      const eager = intent.mood === 'interest';
      const atEase = (1 - walkWeight) * standing;
      accel = approach(accel, dt > 0 ? (intent.speed - lastSpeed) / dt : 0, 14, dt);
      lastSpeed = intent.speed;
      // The trunk's pitch is a spring: it leans into speed and into a wind-up, is thrown back by
      // braking, and when the body stops it swings forward past upright before it settles (the
      // momentum left over). The chest and head follow a moment later (`trail`).
      const leanGoal =
        0.04 * clamp(intent.speed / walkSpeed, 0, 1) +
        0.15 * runWeight +
        clamp(accel * 0.035, -0.28, 0.2) +
        intent.crouch * 0.24;
      [lean, leanSpeed] = spring(lean, leanSpeed, leanGoal, 12, 0.4, dt);
      trail = approach(trail, lean, 7, dt);
      roll = approach(roll, clamp(-intent.turn * (0.012 + intent.speed * 0.06), -0.2, 0.2), 8, dt);
      // Squash and stretch, one spring: sunk by a wind-up and by braking, kicked down by a
      // landing; let go, it rebounds past its rest (the stretch of the launch) and settles.
      const hopping = intent.hop !== undefined;
      if (wasHopping && !hopping) squashSpeed += 9;
      wasHopping = hopping;
      [squash, squashSpeed] = spring(squash, squashSpeed, intent.crouch + clamp(-accel * 0.07, 0, 0.5), 15, 0.38, dt);
      squash = clamp(squash, -0.8, 1.4);
      const tall = 1 - 0.035 * squash;
      root.scale.set(1 / Math.sqrt(tall), tall, 1 / Math.sqrt(tall));
      hips.position.y -= Math.max(0, squash) * 0.055;
      const air = hopping ? Math.sin(Math.PI * intent.hop!) : 0;
      if (hopping) root.position.y += intent.hopHeight * 4 * intent.hop! * (1 - intent.hop!);
      const breath = Math.sin((time * Math.PI * 2) / 3.7) * 0.012 * (1 - walkWeight * 0.6);
      // Standing, the weight drifts from one leg to the other: the hips go over and tip, the
      // shoulders tip the other way (slowly; not while walking).
      const sway = Math.sin((time * Math.PI * 2) / 7.3) * atEase;
      hips.position.x += sway * 0.012;
      hips.position.z -= lean * 0.05;
      hips.rotateZ(sway * 0.025);
      spine.rotateX(lean * 0.55 - breath * 0.5).rotateZ(roll - sway * 0.04);
      if (chest !== spine) chest.rotateX(trail * 0.45 + breath);
      // The head keeps its eyes level through the trunk's lean, and lags its changes.
      head.rotateX(-trail * 0.6 + (trail - lean) * 0.8).rotateZ(-roll * 0.5);
      // Off the floor the legs tuck.
      if (air > 0)
        for (const leg of sides) {
          leg.upperLeg.rotateX(-0.45 * air);
          leg.lowerLeg.rotateX(0.85 * air);
        }
      // The arms: the idle motion holds them wide and straight (it clears thick sleeves), so at
      // ease they come in and bend a little; in gladness they go up, and flap with each hop.
      joy = approach(joy, intent.joy, 12, dt);
      relax = approach(relax, atEase * (1 - joy), 5, dt);
      for (const side of sides) {
        side.upperArm.rotateZ(side.sign * (-0.2 * relax + joy * (2.25 + 0.35 * air)));
        side.lowerArm.rotateY(-side.sign * (0.3 * relax + 0.7 * joy));
      }

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
      } else if (intent.phase === 'idle' || intent.phase === 'sit') {
        // Nothing to look at: now and then a glance about the room (the times and the directions
        // come from the fixed sequence).
        if (time >= glanceAt) {
          glanceYaw = (next() - 0.5) * 1.4;
          glancePitch = (next() - 0.45) * 0.3;
          glanceUntil = time + 1.1 + next() * 1.7;
          glanceAt = glanceUntil + 2.2 + next() * 4.5;
        }
        if (time < glanceUntil) {
          wantYaw = glanceYaw;
          wantPitch = glancePitch;
        }
      }
      // Each part in its own time: the eyes at once, the head quickly (a snap when eager), the
      // chest well after. A thing that holds the attention also tips the head to one side.
      const attending = intent.lookWeight > 0.5 && intent.speed < 0.05 && !hopping;
      lookYaw = approach(lookYaw, wantYaw, eager ? 16 : 6, dt);
      lookPitch = approach(lookPitch, wantPitch, eager ? 16 : 6, dt);
      chestYaw = approach(chestYaw, wantYaw, 3.5, dt);
      tilt = approach(tilt, attending ? (wantYaw >= 0 ? 1 : -1) * (eager ? 0.16 : 0.09) : 0, 7, dt);
      if (chest !== spine) chest.rotateY(chestYaw * 0.2);
      if (neck !== head) neck.rotateY(lookYaw * 0.3).rotateX(-lookPitch * 0.4);
      head
        .rotateY(lookYaw * (neck !== head ? 0.5 : 0.8))
        .rotateX(-lookPitch * (neck !== head ? 0.6 : 1))
        .rotateZ(tilt);
      // The eyes: ahead of the face, or where the glance goes, or on the target; they get there first.
      eyes = approach(eyes, intent.look ? intent.lookWeight : 0, 30, dt);
      const glancing = time < glanceUntil && !(intent.lookWeight > 0);
      v3.set(glancing ? Math.sin(glanceYaw) * 2 : 0, v.y - floorY + (glancing ? glancePitch * 2 : 0), 2);
      if (intent.look) v3.lerp(root.worldToLocal(v2.set(intent.look[0], intent.look[1], intent.look[2])), eyes);
      gaze.position.lerp(v3, 1 - Math.exp(-25 * dt));

      // The face, ears and tail. A blink now and then; a start when something is noticed; a smile
      // in gladness (the model's own expressions, where it has them).
      if (time >= blinkAt) {
        blink = 0.14;
        // Sometimes twice in a row.
        blinkAt = time + (next() < 0.2 ? 0.3 : 1.8 + next() * 3.6);
      }
      blink = Math.max(0, blink - dt);
      if (expressions) {
        expressions.setValue('blink', (1 - joy) * Math.sin(Math.PI * clamp(blink / 0.14, 0, 1)));
        expressions.setValue('happy', joy);
        expressions.setValue('surprised', eager ? intent.alert * 0.5 : 0);
      }
      if (time >= twitchAt) twitchAt = time + 3.5 + next() * 6;
      const twitch = twitchAt - time > 0.16 ? 0 : 1;
      // Ears up at a start and while eager or glad; a flick of them now and then at rest.
      const earsUp = intent.alert * 2.4 + joy * 1 + (eager && intent.lookWeight > 0 ? 0.7 : 0) + twitch * atEase * 1.2;
      const tailUp = joy * 1.1 + (eager && intent.lookWeight > 0 ? 0.55 : 0);
      // The tail: a slow sway at rest, a quicker one when eager, a wag in gladness.
      const wag =
        Math.sin(time * Math.PI * 2 * (joy > 0.1 ? 3.1 : eager && intent.lookWeight > 0 ? 1.4 : 0.33)) *
        (0.12 + 0.3 * (eager && intent.lookWeight > 0 ? 1 : 0) + 1.2 * joy);
      for (const s of springs) {
        if (s.kind === 'other') continue;
        const { settings } = s.joint;
        if (s.kind === 'ear') settings.gravityDir.set(0, earsUp, 0).addScaledVector(s.dir, s.power);
        else
          settings.gravityDir
            .set(Math.cos(intent.heading) * wag, tailUp, -Math.sin(intent.heading) * wag)
            .addScaledVector(s.dir, s.power);
        settings.gravityPower = settings.gravityDir.length();
        if (settings.gravityPower > 1e-6) settings.gravityDir.divideScalar(settings.gravityPower);
      }

      // 4a. A far reach leans the trunk toward the target before the arm is solved (applied here,
      // with the rest of the posture, so the legs below see the final hips).
      const arm = intent.hand === 'left' ? left : right;
      let wantLean = 0;
      if (intent.reach && intent.reachWeight > 0) {
        root.updateWorldMatrix(true, true);
        arm.upperArm.getWorldPosition(v);
        const far = v.distanceTo(v2.set(intent.reach[0], intent.reach[1], intent.reach[2])) - handLength;
        wantLean =
          clamp((far - (upperArmLength + lowerArmLength) * 0.9) / torso, 0, LEAN_MAX) * Math.min(1, intent.reachWeight);
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
      if (intent.reach && intent.reachWeight !== 0) {
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
        // The weight runs a little below 0 (the hand draws back first) and a little past 1 (it
        // presses in): the line from where the motion has the hand to the thing, carried on at
        // both ends. On the way the hand rises over that line and comes down onto the thing.
        const weight = clamp(intent.reachWeight, -0.3, 1.2);
        const target = wrist.clone().addScaledVector(wristGoal.clone().sub(wrist), weight);
        target.y += Math.sin(Math.PI * clamp(weight, 0, 1)) * 0.06;
        solved = solveTwoBone(tuple(shoulder), tuple(elbow), tuple(wrist), tuple(target), tuple(pole));
        aim(arm.upperArm, tuple(elbow), solved.mid);
        aim(arm.lowerArm, tuple(arm.hand.getWorldPosition(v)), solved.end);
        // The hand opens flat along the forearm as it arrives (its rest pose on normalized bones).
        arm.hand.quaternion.slerp(q.identity(), clamp(weight, 0, 1));
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
