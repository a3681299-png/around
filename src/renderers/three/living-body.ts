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
  AnimationClip,
  AnimationMixer,
  CanvasTexture,
  CircleGeometry,
  Group,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationAction,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { parseVerifiedModelSource, type VerifiedModelSource } from '../../assets/verified-source';
import { parseVrmAnimation, vrmAnimationClip } from './vrma-clip';
import type { HumanBone } from '../../characters/humanoid';
import { solveTwoBone, type Vec3 } from '../../characters/two-bone-ik';
import { footAtRest, footStrain, stepFoot, type FootState } from '../../characters/foot-plant';
import type { BodyIntent, BodyReach } from '../../characters/approach';
import { wrapAngle } from '../../characters/locomotion';
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
  /** Each foot now (left, right): pinned or not, how far it is held from where the motion has
   * it (metres), and how high the motion has its toes and ankle above their standing height. */
  feet: { down: boolean; stepping: boolean; held: number; toeRise: number; ankleRise: number }[];
  /**
   * What a viewer sees of the feet, whatever holds them: how far toes that are on the floor (in
   * this frame and the last) have moved over it, summed (metres).
   */
  groundSlide: number;
}
export interface LivingBody {
  readonly root: Group;
  readonly metrics: LivingBodyMetrics;
  /** `viewer`: where whoever is watching is (the camera), for the looks that go to them. */
  update(intent: BodyIntent, dt: number, floorY: number, viewer?: Vec3): void;
  /** Where the main joints are now (the room's metres): for measuring the motion from outside. */
  joints(): Record<'hips' | 'head' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot', Vec3>;
  /**
   * A hand as posed this frame (the room's metres): the wrist, the way the fingers point, the
   * way the palm faces. Things held are placed from it (the phone, docs/living-life.md).
   */
  hand(side: 'left' | 'right'): { wrist: Vec3; fingers: Vec3; palm: Vec3 };
  /** The head as posed: its middle, the way the face looks, its left and its up. */
  head(): { at: Vec3; forward: Vec3; left: Vec3; up: Vec3 };
  facts(): LivingBodyFacts;
  dispose(): void;
}

const LOOK_YAW = 1.15;
const LOOK_PITCH = 0.55;
/** A reach never straightens the arm fully (a locked elbow looks stiff). */
const ARM_STRETCH = 0.97;
const LEAN_MAX = 0.42;
/** How long a foot takes to its spot in a hard stop. */
const STOP_STEP_S = 0.17;

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
  // (Placed and turned flat every frame: on the floor, or on the bed under a body lying on it.)
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
    shoulder: bone(`${side}Shoulder`),
    upperArm: need(`${side}UpperArm`),
    lowerArm: need(`${side}LowerArm`),
    hand: need(`${side}Hand`),
    finger: bone(`${side}MiddleDistal`) ?? bone(`${side}MiddleProximal`),
    /** The finger joints that close round a held thing (proximal, intermediate, distal). */
    curl: (['Index', 'Middle', 'Ring', 'Little'] as const).flatMap((f) =>
      (['Proximal', 'Intermediate', 'Distal'] as const).flatMap((j, k) => {
        const node = bone(`${side}${f}${j}` as HumanBone);
        return node ? [{ node, share: [0.8, 1, 0.7][k]! }] : [];
      }),
    ),
    thumb: (['ThumbProximal', 'ThumbDistal'] as const).flatMap((j) => {
      const node = bone(`${side}${j}` as HumanBone);
      return node ? [node] : [];
    }),
    restAnkle: 0,
    restToe: 0,
    restSide: 0,
    freed: false,
    plant: footAtRest(),
    lastContact: undefined as Vector3 | undefined,
    lastRaw: undefined as Vector3 | undefined,
    lastKind: 'toe' as 'toe' | 'ankle',
    lastGround: undefined as Vector3 | undefined,
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
    leg.restSide = Math.abs(v.x);
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
  const walkTravel = walkInPlace(walkClip, hips.name);
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
  const runTravel = runClip ? walkInPlace(runClip, hips.name) : 0;
  let run = runClip ? play(runClip) : undefined;
  /**
   * The speed a loop's feet keep: how fast a foot on the floor goes back under the body, played
   * on the spot (the median over the loop's moments with a foot down). This, not how far the
   * motion's hips travel, is the ground the body may cover without its feet sliding: a retargeted
   * run's hips can travel much further in a loop than its legs take it.
   */
  const feetPace = (action: AnimationAction, clip: AnimationClip) => {
    for (const other of [idle, walk, run]) other?.setEffectiveWeight(other === action ? 1 : 0);
    const steps = 48;
    const toes = sides.map(() => [] as Vector3[]);
    for (let i = 0; i <= steps; i++) {
      action.time = Math.min(clip.duration - 1e-4, (i / steps) * clip.duration);
      mixer.update(0);
      root.updateWorldMatrix(true, true);
      sides.forEach((leg, k) => toes[k]!.push(toeOf(leg, new Vector3())));
    }
    const speeds: number[] = [];
    sides.forEach((leg, k) => {
      for (let i = 0; i < steps; i++) {
        const a = toes[k]![i]!,
          b = toes[k]![i + 1]!;
        if (a.y - leg.restToe < 0.02 && b.y - leg.restToe < 0.02) speeds.push((a.z - b.z) / (clip.duration / steps));
      }
    });
    speeds.sort((a, b) => a - b);
    return speeds.length >= 4 ? Math.max(0, speeds[speeds.length >> 1]!) : 0;
  };
  const walkPace = feetPace(walk, walkClip);
  const walkSpeed = walkPace > 0.05 ? walkPace : walkTravel > 0.05 ? walkTravel / (walkClip.duration || 1) : 0.6;
  const stride = walkSpeed * (walkClip.duration || 1);
  const runPace = run && runClip ? feetPace(run, runClip) || runTravel / (runClip.duration || 1) : 0;
  // A "run" no faster than the walk is no use as one.
  if (run && runPace < walkSpeed * 1.15) {
    run.stop();
    run = undefined;
  }
  const runSpeed = run ? runPace : walkSpeed;
  const runStride = runSpeed * (runClip?.duration || 1);
  // Both loops are two steps long, but may begin on different feet: find the shift (none or half
  // a cycle) at which the run's feet go the same way as the walk's.
  let runShift = 0;
  /** How far the left foot is ahead of the right through a loop, at eight moments of it. */
  const gait = (action: AnimationAction, clip: AnimationClip, shift: number) => {
    const out: number[] = [];
    for (const other of [idle, walk, run]) other?.setEffectiveWeight(other === action ? 1 : 0);
    for (let i = 0; i < 8; i++) {
      action.time = ((i / 8 + shift) % 1) * clip.duration;
      mixer.update(0);
      root.updateWorldMatrix(true, true);
      out.push(sides[0]!.foot.getWorldPosition(v).z - sides[1]!.foot.getWorldPosition(v2).z);
    }
    return out;
  };
  const walking = gait(walk, walkClip, 0);
  // The moment of the walk at which the left foot is furthest behind: about to push off. A walk
  // from standing begins there, so its first move is a step and not the middle of a stride.
  const pushOff = walking.indexOf(Math.min(...walking)) / 8;
  if (run && runClip) {
    const match = (shift: number) => gait(run, runClip, shift).reduce((sum, value, i) => sum + value * walking[i]!, 0);
    runShift = match(0.5) > match(0) ? 0.5 : 0;
  }
  idle.setEffectiveWeight(1);
  walk.setEffectiveWeight(0);
  run?.setEffectiveWeight(0);
  // The run's trunk and arms on their own (the same motion, the legs' tracks left out). At a dart
  // the legs are a blend of walk and run that matches the ground, which leaves the arms hardly
  // swinging; this puts the run's arm swing and trunk twist on top, on the same phase.
  const upperNames = new Set(
    (
      [
        'spine',
        'chest',
        'upperChest',
        'neck',
        'head',
        'leftShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightShoulder',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
      ] as const
    ).flatMap((name) => {
      const node = bone(name);
      return node ? [`${node.name}.quaternion`] : [];
    }),
  );
  const runUpper =
    run && runClip
      ? play(
          new AnimationClip(
            'run-upper',
            runClip.duration,
            runClip.tracks.filter((track) => upperNames.has(track.name)),
          ),
        )
      : undefined;
  runUpper?.setEffectiveWeight(0);
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
    scurry = 0,
    moving = false,
    hopHeight = 0,
    lastTap = 0,
    armSwing = 0,
    armSwingSpeed = 0,
    arch = 0,
    armsPose = 0,
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
    dropNow = 0,
    stop: { t: number; feet: { delay: number; from: [number, number]; to: [number, number] }[] } | undefined,
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
    feet: [],
    groundSlide: 0,
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
    ...sides.flatMap((s) => (s.shoulder ? [s.shoulder] : [])),
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
    joints: () => ({
      hips: tuple(hips.getWorldPosition(v)),
      head: tuple(head.getWorldPosition(v)),
      leftHand: tuple(left.hand.getWorldPosition(v)),
      rightHand: tuple(right.hand.getWorldPosition(v)),
      leftFoot: tuple(left.foot.getWorldPosition(v)),
      rightFoot: tuple(right.foot.getWorldPosition(v)),
    }),
    hand(name) {
      // Normalized bones rest with identity rotations: a left hand's fingers point along its +X,
      // a right hand's along −X, and both palms face −Y (a T-pose's palms down).
      const side = name === 'left' ? left : right;
      side.hand.getWorldQuaternion(q);
      return {
        wrist: tuple(side.hand.getWorldPosition(new Vector3())),
        fingers: tuple(new Vector3(side.sign, 0, 0).applyQuaternion(q)),
        palm: tuple(new Vector3(0, -1, 0).applyQuaternion(q)),
      };
    },
    head() {
      head.getWorldQuaternion(q);
      return {
        at: tuple(head.getWorldPosition(new Vector3())),
        forward: tuple(new Vector3(0, 0, 1).applyQuaternion(q)),
        left: tuple(new Vector3(1, 0, 0).applyQuaternion(q)),
        up: tuple(new Vector3(0, 1, 0).applyQuaternion(q)),
      };
    },
    update(intent, rawDt, floorY, viewer) {
      const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.1);
      time += dt;
      root.position.set(intent.x, floorY, intent.z);
      root.rotation.set(0, intent.heading, 0);

      // 1. Motions. The walk fades in with speed; its phase advances with the ground covered, so
      // the feet keep the floor's pace whether the body is starting, cruising or stopping. A slow
      // walk takes shorter steps (the blend with idle shortens them), so its cycle turns faster
      // than speed alone would say.
      // From standing, the walk begins at its push-off (never in the middle of a stride).
      if (intent.speed > 0 && !moving && walkWeight < 0.05 && runWeight < 0.05) cycle = pushOff;
      moving = intent.speed > 0;
      const wantWalk = smooth(clamp(intent.speed / (walkSpeed * 0.55), 0, 1));
      walkWeight = approach(walkWeight, wantWalk, 9, dt);
      if (walkWeight < 0.002 && wantWalk === 0) walkWeight = 0;
      // An eager body does not walk faster, it scurries: the run, mixed with standing still in
      // the share speed ÷ the run's own speed. That shortens the run's stride to the ground
      // covered while keeping the run's own timing of feet on and off the floor (a walk and a run
      // mixed on one phase disagree about when a foot is down, and the foot then drags), and its
      // quick cadence: small fast steps.
      scurry = approach(scurry, run && intent.mood === 'interest' ? 1 : 0, 14, dt);
      runWeight = approach(runWeight, run ? clamp(intent.speed / runSpeed, 0, 1) : 0, 26, dt);
      if (runWeight < 0.002 && intent.speed === 0) runWeight = 0;
      const walkPart = walkWeight * (1 - scurry),
        runPart = runWeight * scurry;
      const moveWeight = Math.min(1, walkPart + runPart);
      const stepLength =
        stride * (0.55 + 0.45 * walkWeight) * (1 - scurry) + runStride * Math.max(0.05, runWeight) * scurry;
      // (Never faster than half again the run's own cadence, however the weights lag a burst.)
      const fastest = 1.5 / (runClip?.duration || walkClip.duration || 1);
      if (stepLength > 0.01) cycle = (cycle + Math.min(fastest * dt, (intent.speed * dt) / stepLength)) % 1;
      idle.time = time % (idleClip.duration || 1);
      walk.time = cycle * (walkClip.duration || 1);
      if (run && runClip) run.time = ((cycle + runShift) % 1) * (runClip.duration || 1);
      // Sitting motions take over from standing ones by their own eased weights (never a cut).
      let sitting = 0;
      const sitPose = intent.pose === 'sitDown' || intent.pose === 'sit' || intent.pose === 'standUp';
      for (const seat of seatClips) {
        // Seated is the fallback for a missing sit-down or stand-up motion. (Lying is posed on
        // the standing motions, not on a sitting one.)
        const wanted =
          intent.pose === seat.pose ||
          (seat.pose === 'sit' && sitPose && !seatClips.some((c) => c.pose === intent.pose));
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
      idle.setEffectiveWeight((1 - moveWeight) * standing);
      walk.setEffectiveWeight(walkPart * standing);
      run?.setEffectiveWeight(runPart * standing);
      // The trunk and arms are mostly the run's while it scurries (see `runUpper`).
      if (runUpper && runClip) {
        runUpper.time = ((cycle + runShift) % 1) * (runClip.duration || 1);
        runUpper.setEffectiveWeight(2.2 * scurry * clamp(runWeight / 0.3, 0, 1) * standing);
      }
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
      const atEase = (1 - moveWeight) * standing;
      const arm = intent.hand === 'left' ? left : right;
      const reaching = Boolean(intent.reach) && intent.reachWeight !== 0;
      // What is looked at: the thing, or whoever is watching (a glance to share it), or between.
      const lookAt =
        intent.look && viewer && intent.toViewer > 0
          ? ([0, 1, 2].map(
              (i) => intent.look![i]! + (viewer[i]! - intent.look![i]!) * intent.toViewer,
            ) as unknown as Vec3)
          : intent.look;
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
      // Leaving the floor throws the spring the other way (the body stretches upward); landing
      // kicks it down, harder from higher; a touch gives it a small start.
      if (!wasHopping && hopping) squashSpeed -= 7;
      if (wasHopping && !hopping) squashSpeed += 6 + hopHeight * 32;
      if (intent.tap > lastTap + 0.5) squashSpeed += 2.2;
      lastTap = intent.tap;
      wasHopping = hopping;
      if (hopping) hopHeight = intent.hopHeight;
      [squash, squashSpeed] = spring(squash, squashSpeed, intent.crouch + clamp(-accel * 0.07, 0, 0.5), 15, 0.38, dt);
      squash = clamp(squash, -1, 1.6);
      const tall = 1 - 0.055 * squash;
      root.scale.set(1 / Math.sqrt(tall), tall, 1 / Math.sqrt(tall));
      hips.position.y -= Math.max(0, squash) * 0.07;
      // Arms that hang swing with the body's changes of speed: back as it darts off, forward and
      // back again as it stops (a spring, so they arrive after the trunk does).
      [armSwing, armSwingSpeed] = spring(armSwing, armSwingSpeed, clamp(accel * 0.1, -0.75, 0.75), 10, 0.32, dt);
      arch = approach(arch, intent.arch, 18, dt);
      const air = hopping ? Math.sin(Math.PI * intent.hop!) : 0;
      if (hopping) root.position.y += intent.hopHeight * 4 * intent.hop! * (1 - intent.hop!);
      const breath = Math.sin((time * Math.PI * 2) / 3.7) * 0.012 * (1 - moveWeight * 0.6);
      // Standing, the weight drifts from one leg to the other: the hips go over and tip, the
      // shoulders tip the other way (slowly; not while walking).
      const sway = Math.sin((time * Math.PI * 2) / 7.3) * atEase;
      hips.position.x += sway * 0.012;
      hips.position.z -= lean * 0.05;
      hips.rotateZ(sway * 0.025);
      // The trunk's line: curled forward when it gathers itself, arched back at the top of a jump.
      spine.rotateX(lean * 0.55 - breath * 0.5 - arch * 0.24).rotateZ(roll - sway * 0.04);
      if (chest !== spine) chest.rotateX(trail * 0.45 + breath - arch * 0.2);
      // The head keeps its eyes level through the trunk's lean, and lags its changes; a touch
      // makes it nod.
      head.rotateX(-trail * 0.6 + (trail - lean) * 0.8 - arch * 0.22 + intent.tap * 0.1).rotateZ(-roll * 0.5);
      // Off the floor the legs tuck under; in a jump for joy the heels kick up behind instead
      // (one more than the other: a symmetrical pose is a stiff one).
      if (air > 0)
        sides.forEach((leg, i) => {
          const kick = intent.kick * (i ? 0.72 : 1);
          leg.upperLeg.rotateX((-0.45 * (1 - intent.kick) + 0.3 * kick) * air);
          leg.lowerLeg.rotateX((0.85 * (1 - intent.kick) + 1.7 * kick) * air);
        });
      // The arms: the idle motion holds them wide and straight (it clears thick sleeves), so at
      // ease they come in and bend a little; and they swing with the body's starts and stops.
      joy = approach(joy, intent.joy, 12, dt);
      armsPose = approach(armsPose, intent.arms, 22, dt);
      relax = approach(relax, atEase * (1 - Math.min(1, Math.abs(armsPose))), 5, dt);
      for (const side of sides) {
        side.upperArm.rotateZ(side.sign * -0.2 * relax).rotateX(armSwing * (side === arm && reaching ? 0.2 : 1));
        side.lowerArm.rotateY(-side.sign * (0.3 * relax + Math.max(0, -armSwing) * 0.5));
      }
      // A pose for both arms (gladness): each arm is swung, by its world direction, from where
      // the motion has it toward "up and out" or "down and back". Going by direction, not by a
      // fixed turn of the joint, gives the same silhouette whatever the motion underneath, and
      // the way from down to up passes out to the side, as an arm thrown up does.
      if (Math.abs(armsPose) > 1e-3) {
        root.updateWorldMatrix(true, true);
        const amount = Math.min(1, Math.abs(armsPose));
        for (const side of sides) {
          const up = armsPose > 0;
          const shoulder = side.upperArm.getWorldPosition(new Vector3()),
            elbow = side.lowerArm.getWorldPosition(new Vector3());
          const upper = (up ? v3.set(side.sign * 0.66, 0.74, 0.12) : v3.set(side.sign * 0.4, -0.7, -0.6))
            .normalize()
            .applyAxisAngle(UP, intent.heading);
          const upperNow = elbow.clone().sub(shoulder).normalize().lerp(upper, amount).normalize();
          aim(side.upperArm, tuple(elbow), tuple(shoulder.addScaledVector(upperNow, upperArmLength)));
          const bend = side.lowerArm.getWorldPosition(new Vector3()),
            wrist = side.hand.getWorldPosition(new Vector3());
          // The forearm a little more upright than the upper arm (up), or trailing behind it (back).
          const fore = (up ? v3.set(side.sign * 0.42, 0.9, 0.1) : v3.set(side.sign * 0.3, -0.5, -0.8))
            .normalize()
            .applyAxisAngle(UP, intent.heading);
          const foreNow = wrist.clone().sub(bend).normalize().lerp(fore, amount).normalize();
          aim(side.lowerArm, tuple(wrist), tuple(bend.addScaledVector(foreNow, lowerArmLength)));
        }
      }

      // Looking: the eyes first (the VRM's own look-at), then the head, neck and chest share the
      // turn, each within what a neck can do.
      root.updateWorldMatrix(true, true);
      head.getWorldPosition(v);
      let wantYaw = 0,
        wantPitch = 0;
      if (lookAt && intent.lookWeight > 0) {
        v2.set(lookAt[0], lookAt[1], lookAt[2]);
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
      eyes = approach(eyes, lookAt ? intent.lookWeight : 0, 30, dt);
      const glancing = time < glanceUntil && !(intent.lookWeight > 0);
      v3.set(glancing ? Math.sin(glanceYaw) * 2 : 0, v.y - floorY + (glancing ? glancePitch * 2 : 0), 2);
      if (lookAt) v3.lerp(root.worldToLocal(v2.set(lookAt[0], lookAt[1], lookAt[2])), eyes);
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
      const earsUp =
        intent.alert * 2.4 +
        intent.tap * 1.6 +
        joy * 1 +
        (eager && intent.lookWeight > 0 ? 0.7 : 0) +
        twitch * atEase * 1.2;
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

      // 2b. Lying face down (a bed, docs/living-life.md). The standing pose, turned flat about the
      // feet and carried so the chest rests on the bed: the back arches to lift the head, the
      // head looks ahead, the lower legs come up behind and, settled in, swing one after the
      // other. The body turns flat in the air of the dive (the approach eases `lie` in).
      const lie = clamp(intent.lie ?? 0, 0, 1);
      const overOnto = clamp(intent.roll ?? 0, 0, 1);
      const lying = lie > 0.02;
      if (lying) {
        const front = lie * (1 - overOnto),
          back = lie * overOnto;
        // On the front, propped on the elbows: the back arches well up from the hips, the head
        // comes up to look ahead, the feet swing up behind one after the other.
        spine.rotateX(-0.42 * front + 0.08 * back);
        if (chest !== spine) chest.rotateX(-0.34 * front + 0.06 * back);
        if (neck !== head) neck.rotateX(-0.3 * front + 0.12 * back);
        head.rotateX(-0.22 * front + 0.16 * back);
        sides.forEach((leg, i) => {
          const swing = intent.kickLegs * (0.55 + 0.5 * Math.sin(time * Math.PI * 2 * 0.85 + i * Math.PI));
          leg.upperLeg.rotateX(0.06 * front).rotateZ(leg.sign * 0.06 * front);
          leg.lowerLeg.rotateX(front * (0.45 + swing));
          leg.foot.rotateX(0.55 * front);
          // On the back: the left knee up with its foot on the bed, the right leg crossed over it
          // and its foot idly swinging.
          const dangle = 0.35 + 0.3 * intent.kickLegs * Math.sin(time * Math.PI * 2 * 0.55);
          if (i === 0) {
            leg.upperLeg.rotateX(-0.75 * back);
            leg.lowerLeg.rotateX(1.6 * back);
            leg.foot.rotateX(-0.25 * back);
          } else {
            // (+Z brings a right leg in across the body.)
            leg.upperLeg.rotateX(-0.95 * back).rotateZ(0.3 * back);
            leg.lowerLeg.rotateX(dangle * back);
            leg.foot.rotateX(0.3 * back);
          }
        });
        // Flat (about the feet), then over onto the back about the body's own length.
        root.rotateX((Math.PI / 2) * lie);
        if (back > 1e-4) root.rotateY(Math.PI * overOnto);
        root.updateWorldMatrix(true, true);
        if (intent.lieAt) {
          // The hips on the surface (a body's depth above it), behind the chest's point by the
          // trunk's length: the arch then lifts the chest off the bed onto the elbows.
          hips.getWorldPosition(v);
          const depth = metrics.height * 0.07,
            back = torso * 0.85;
          const hx = intent.lieAt[0] - Math.sin(intent.heading) * back,
            hz = intent.lieAt[2] - Math.cos(intent.heading) * back;
          root.position.x += (hx - v.x) * lie;
          root.position.y += (intent.lieAt[1] + depth - v.y) * lie;
          root.position.z += (hz - v.z) * lie;
          root.updateWorldMatrix(true, true);
        }
        // The feet are off the floor: nothing holds them, and they start afresh on getting up.
        for (const leg of sides) {
          leg.plant = footAtRest();
          leg.lastContact = leg.lastRaw = leg.lastGround = undefined;
        }
        stop = undefined;
      }

      // 3. Legs. The feet the motion has on the floor stay on their spot; a foot left too far
      // behind steps. The hips come down when a pinned foot would be out of the leg's reach.
      root.updateWorldMatrix(true, true);
      let footSamples: { toeRise: number; ankleRise: number }[] = sides.map(() => ({ toeRise: 0, ankleRise: 0 }));
      if (!lying) {
        // Seated: the hips go to the seat (the room's marker is where the hips rest), by as much
        // as the body is seated, so it lowers onto the seat instead of dropping there.
        if (intent.seat && intent.seated > 0) {
          hips.getWorldPosition(v);
          root.position.x += (intent.seat[0] - v.x) * intent.seated;
          root.position.y += (intent.seat[1] - v.y) * intent.seated;
          root.position.z += (intent.seat[2] - v.z) * intent.seated;
          root.updateWorldMatrix(true, true);
        }
        // A calm turn about: the feet are asked where they will stand when the turn is done (the
        // motion's feet, carried round the body by the turn still to come), so each foot takes one
        // step to its final place while the body comes round, instead of many small ones after it.
        const sunk = Math.max(0, squash) * 0.07 * tall + (1 - tall) * 0.1;
        const lift = intent.hop === undefined ? clamp(moveWeight, 0.35, 1) : 1;
        const ahead = intent.turnAhead;
        const lead = (p: Vector3) => (ahead ? p.sub(root.position).applyAxisAngle(UP, ahead).add(root.position) : p);
        const samples = sides.map((leg) => {
          const ankle = lead(leg.foot.getWorldPosition(new Vector3())),
            toe = lead(toeOf(leg, new Vector3()));
          return {
            ankle: tuple(ankle),
            toe: tuple(toe),
            // "On the floor" is the motion's say. The body's own sinking (a wind-up, a braking, a
            // landing) lowers the feet with it, and would otherwise read as both feet down for as
            // long as it lasts: a foot pinned through a run is dragged. So the sinking is taken out.
            // A gait mixed with standing still lifts its feet only by its share: a swinging foot
            // an inch up would read as down. The heights are judged at the gait's full size.
            ankleRise: (ankle.y - floorY - leg.restAnkle + sunk) / lift,
            toeRise: (toe.y - floorY - leg.restToe + sunk) / lift,
            yaw: Math.atan2(toe.x - ankle.x, toe.z - ankle.z),
          };
        });
        const strain = sides.map((leg) => footStrain(leg.plant));
        // Equally strained (a turn on the spot strains both alike): the foot on the side the body
        // turns to goes first, as a person opens that foot out and brings the other round.
        const first = ahead < 0 || (ahead === 0 && intent.turn < 0) ? 1 : 0;
        // A hard stop is made with the feet: as the braking begins, the foot in the air is put down
        // a little ahead of where the body will stop and the other is brought up beside it, and the
        // body comes to rest over them. (Left to the gait, the feet would glide on under a body
        // that is slowing: a run's motion has no stop in it.)
        if (intent.stopAt && !stop && intent.speed > 0) {
          const leadFoot = samples[0]!.toeRise >= samples[1]!.toeRise ? 0 : 1;
          const fx = Math.sin(intent.stopHeading),
            fz = Math.cos(intent.stopHeading);
          stop = {
            t: 0,
            feet: sides.map((leg, i) => {
              const along = i === leadFoot ? 0.13 : -0.05,
                across = leg.sign * leg.restSide;
              return {
                delay: i === leadFoot ? 0 : 0.09,
                from: [samples[i]!.ankle[0] + leg.plant.dx, samples[i]!.ankle[2] + leg.plant.dz] as [number, number],
                to: [intent.stopAt![0] + fx * along + fz * across, intent.stopAt![1] + fz * along - fx * across] as [
                  number,
                  number,
                ],
              };
            }),
          };
        }
        if (!intent.stopAt) stop = undefined;
        else if (stop) stop.t += dt;
        const planted = [false, false];
        sides.forEach((leg, i) => {
          const other = sides[1 - i]!.plant;
          const before = leg.plant.step;
          const spot = stop?.feet[i];
          const through = spot ? (stop!.t - spot.delay) / STOP_STEP_S : 0;
          if (spot && through > 0) {
            const s = samples[i]!;
            planted[i] = true;
            if (through < 1) {
              // On its way to its spot: a quick step with a small arc.
              const k = smooth(through);
              leg.plant = {
                ...leg.plant,
                down: true,
                contact: 'ankle',
                step: through,
                dx: spot.from[0] + (spot.to[0] - spot.from[0]) * k - s.ankle[0],
                dz: spot.from[1] + (spot.to[1] - spot.from[1]) * k - s.ankle[2],
                dyaw: wrapAngle(intent.stopHeading - s.yaw) * k,
                lift: Math.sin(Math.PI * through) * 0.045,
              };
            } else {
              // Down on its spot: held there (no corrective steps) until the stop is over.
              if (leg.plant.step !== undefined)
                leg.plant = {
                  ...leg.plant,
                  step: undefined,
                  lift: 0,
                  contact: 'ankle',
                  pinX: spot.to[0],
                  pinZ: spot.to[1],
                  pinYaw: intent.stopHeading,
                  rested: 0,
                };
              leg.plant = stepFoot(leg.plant, { ...s, ankleRise: 0, toeRise: 0 }, dt, false);
            }
            return;
          }
          // One foot at a time, the one left furthest behind first.
          const mayStep =
            other.down &&
            other.step === undefined &&
            (strain[i]! > strain[1 - i]! + 1e-6 || (Math.abs(strain[i]! - strain[1 - i]!) <= 1e-6 && i === first));
          // ("Under way" is the scurry: a walk's feet keep the floor and are pinned as when standing.
          // And a foot is under way only once it has left the floor: at the start of a dart the
          // feet that still stand stay planted, the body pushing off from them, until each lifts.)
          const running = scurry > 0.5 && intent.speed > walkSpeed * 0.45;
          const s = samples[i]!;
          leg.freed = running && (leg.freed || (s.toeRise > 0.03 && s.ankleRise > 0.03));
          leg.plant = stepFoot(leg.plant, s, dt, mayStep && !running, leg.freed);
          if (before === undefined && leg.plant.step !== undefined) facts.steps++;
        });
        let drop = 0;
        const targets = sides.map((leg, i): Vec3 => {
          const s = samples[i]!;
          // A pin the leg cannot keep (the body has run on, or been carried off): let it go, quickly
          // but over a few frames, rather than drag the foot or pull the hips down after it.
          leg.upperLeg.getWorldPosition(v);
          const span = leg.lowerLeg.getWorldPosition(v2).distanceTo(v) + v2.distanceTo(leg.foot.getWorldPosition(v3));
          const held = leg.plant;
          if (held.down && Math.hypot(s.ankle[0] + held.dx - v.x, s.ankle[2] + held.dz - v.z) > span * 0.93)
            leg.plant = {
              ...held,
              dx: held.dx * 0.7,
              dz: held.dz * 0.7,
              pinX: held.pinX - held.dx * 0.3,
              pinZ: held.pinZ - held.dz * 0.3,
            };
          const p: FootState = leg.plant;
          // The pin holds the contact (the toes, mostly), and the foot is turned back about the ankle:
          // the ankle goes where that turn leaves the toes on their spot.
          const ox = p.contact === 'toe' ? s.toe[0] - s.ankle[0] : 0,
            oz = p.contact === 'toe' ? s.toe[2] - s.ankle[2] : 0;
          const cos = Math.cos(p.dyaw),
            sin = Math.sin(p.dyaw);
          const target: Vec3 = [
            s.ankle[0] + p.dx + ox - (ox * cos + oz * sin),
            // The body's sinking is the knees' to take up, not the feet's: each foot goes where
            // the motion has it, as high above the floor as before the hips came down (otherwise
            // a foot swinging forward in a run would scrape along the floor). And never under the
            // floor (a seat lower than the motion's own would push the feet in).
            // A foot planted for a stop stands on the floor, whatever the gait under it is doing.
            planted[i]
              ? floorY + leg.restAnkle + p.lift
              : Math.max(floorY + leg.restAnkle * 0.85, s.ankle[1] + p.lift + sunk),
            s.ankle[2] + p.dz + oz - (-ox * sin + oz * cos),
          ];
          leg.upperLeg.getWorldPosition(v);
          const length = leg.lowerLeg.getWorldPosition(v2).distanceTo(v) + v2.distanceTo(leg.foot.getWorldPosition(v3));
          const flat = Math.hypot(target[0] - v.x, target[2] - v.z),
            up = v.y - target[1];
          const reach = length * 0.995;
          if (flat < reach && Math.hypot(flat, up) > reach)
            drop = Math.max(drop, up - Math.sqrt(reach * reach - flat * flat));
          return target;
        });
        // (Eased: the hips never drop in one frame.)
        dropNow = approach(dropNow, Math.min(0.1, drop), 30, dt);
        drop = dropNow;
        if (drop > 1e-4) {
          hips.position.y -= drop / (root.scale.y || 1);
          root.updateWorldMatrix(true, true);
        }
        const forward: Vec3 = [Math.sin(intent.heading), 0, Math.cos(intent.heading)];
        sides.forEach((leg, i) => {
          const p = leg.plant,
            s = samples[i]!;
          const corrected =
            planted[i] ||
            Math.abs(p.dx) + Math.abs(p.dz) + Math.abs(p.lift) + Math.abs(p.dyaw) > 1e-5 ||
            drop > 1e-4 ||
            targets[i]![1] > s.ankle[1] + 1e-5;
          if (corrected) {
            const footWorld = leg.foot.getWorldQuaternion(new Quaternion());
            // Solved twice: the body's squash and stretch scales it more one way than the other, so
            // a bone's length in the room changes as it turns and one solve lands a little off (a
            // planted foot would creep as the body sinks). The second starts from the first's result.
            for (let pass = 0; pass < (Math.abs(tall - 1) > 1e-3 ? 3 : 1); pass++) {
              const hip = tuple(leg.upperLeg.getWorldPosition(v)),
                knee = tuple(leg.lowerLeg.getWorldPosition(v)),
                ankle = tuple(leg.foot.getWorldPosition(v));
              const solved = solveTwoBone(hip, knee, ankle, targets[i]!, forward);
              aim(leg.upperLeg, knee, solved.mid);
              aim(leg.lowerLeg, tuple(leg.foot.getWorldPosition(v)), solved.end);
            }
            // The foot keeps the motion's own tilt, turned back by what the pin holds.
            setWorldQuaternion(leg.foot, footWorld.premultiply(q.setFromAxisAngle(UP, p.dyaw + ahead)));
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
        footSamples = samples;
      }

      // 4b. Arm. The hand goes to the target (its fingertips on it), blended from wherever the
      // motion has it; the elbow bends down and out.
      facts.reachGap = undefined;
      if (intent.reach && intent.reachWeight !== 0) {
        // The arm does not go alone: its shoulder comes forward and up with it and the chest
        // turns a little to give it reach (and both draw back with the hand before it goes).
        const out = clamp(intent.reachWeight, -0.3, 1);
        arm.shoulder?.rotateY(-arm.sign * 0.3 * out).rotateZ(arm.sign * 0.14 * out);
        if (chest !== spine) chest.rotateY(-arm.sign * 0.16 * out);
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
        // …and bends back at the wrist so the palm, not the fingertips, meets the thing; a touch
        // presses it a little further for a moment.
        arm.hand.rotateZ(arm.sign * (0.5 * clamp(weight, 0, 1) + 0.25 * intent.tap));
        arm.hand.updateWorldMatrix(false, true);
        // The fingertips: a hand's length past the wrist, along the forearm (the hand lies flat).
        const from = arm.lowerArm.getWorldPosition(v2),
          to = arm.hand.getWorldPosition(v);
        const tip = to.clone().addScaledVector(to.clone().sub(from).normalize(), handLength);
        facts.reachGap = tip.distanceTo(goal);
      }

      // 4c. Hands that hold things (the phone and its earphones). Each hand goes, by its weight,
      // from where the motion and the steps above left it to its goal; the palm and the fingers
      // turn the way the goal says, and the fingers close round what is held. Solved after the
      // reach, which never runs at the same time (the page lets the phone go first).
      for (const side of sides) {
        const goal = side.side === 'left' ? intent.hold?.left : intent.hold?.right;
        const weight = goal ? clamp(goal.weight, 0, 1) : 0;
        const grip = goal ? clamp(goal.grip, 0, 1) : 0;
        if (weight > 1e-3 && goal) {
          root.updateWorldMatrix(true, true);
          const shoulder = side.upperArm.getWorldPosition(new Vector3()),
            elbow = side.lowerArm.getWorldPosition(new Vector3()),
            wrist = side.hand.getWorldPosition(new Vector3());
          const fingers = new Vector3(...goal.fingers).normalize();
          const palm = new Vector3(...goal.palm);
          palm.addScaledVector(fingers, -palm.dot(fingers)).normalize();
          // The palm's middle is half a hand past the wrist, a little off the palm's face.
          const wristGoal = new Vector3(...goal.at)
            .addScaledVector(fingers, -handLength * 0.45)
            .addScaledVector(palm, -0.012);
          const limit = (upperArmLength + lowerArmLength) * ARM_STRETCH;
          if (wristGoal.distanceTo(shoulder) > limit) wristGoal.sub(shoulder).setLength(limit).add(shoulder);
          const target = wrist.clone().lerp(wristGoal, weight);
          // Elbows down and out (on a bed, they rest on it).
          const pole = new Vector3(side.sign * 0.7, -1, -0.15).applyAxisAngle(UP, intent.heading);
          const solved = solveTwoBone(tuple(shoulder), tuple(elbow), tuple(wrist), tuple(target), tuple(pole));
          aim(side.upperArm, tuple(elbow), solved.mid);
          aim(side.lowerArm, tuple(side.hand.getWorldPosition(v)), solved.end);
          // The hand: its fingers along `fingers` (+X for a left hand, −X for a right), its palm
          // (−Y) facing `palm`.
          const x = fingers.clone().multiplyScalar(side.sign),
            y = palm.clone().negate();
          const z = new Vector3().crossVectors(x, y);
          // (Its own quaternions: setWorldQuaternion works in q3.)
          const want = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
          setWorldQuaternion(side.hand, side.hand.getWorldQuaternion(new Quaternion()).slerp(want, weight));
        }
        // The fingers close toward the palm (about each joint's Z: down for a T-pose hand).
        if (grip > 1e-3) for (const f of side.curl) f.node.rotateZ(-side.sign * grip * f.share * 1.05);
        // The right thumb lies over the screen and taps it.
        if (side.side === 'right' && grip > 1e-3)
          side.thumb.forEach((t, k) => t.rotateY(side.sign * (0.35 * grip + (k ? 0.35 : 0.25) * (intent.thumb ?? 0))));
      }

      // 5. The model: pose copied to its own bones, then hair, tail and clothes follow.
      hips.position.y = Math.max(restHipsY * 0.5, hips.position.y);
      vrm.update(dt);
      // The shadow stays on the floor under a body in the air, and thins with the height. Lying,
      // it is on the bed under the body, long the body's way.
      root.updateWorldMatrix(true, true);
      const height = lying && intent.lieAt ? 0 : Math.max(0, root.position.y - floorY);
      hips.getWorldPosition(v);
      const under = lying && intent.lieAt ? intent.lieAt[1] + 0.006 : floorY + 0.004;
      v.y = under;
      if (lying && intent.lieAt) v.set(v.x + (intent.lieAt[0] - v.x) * 0.5, under, v.z + (intent.lieAt[2] - v.z) * 0.5);
      else v.set(root.position.x, under, root.position.z);
      shadow.position.copy(root.worldToLocal(v));
      q2.setFromAxisAngle(UP, intent.heading).multiply(q3.setFromAxisAngle(v2.set(1, 0, 0), -Math.PI / 2));
      shadow.quaternion.copy(root.getWorldQuaternion(q).invert().multiply(q2));
      const shrink = Math.max(0.55, 1 - height * 1.3);
      shadow.scale.set(shrink / (root.scale.x || 1), (shrink * (1 + 1.1 * lie)) / (root.scale.y || 1), 1);
      root.updateWorldMatrix(true, true);
      facts.walkWeight = moveWeight;
      sides.forEach((leg) => {
        const toe = toeOf(leg, new Vector3());
        // On the floor: the whole foot down, toes and ankle both about where they are when
        // standing. (A foot swinging through close over the floor has its ankle up; one coming
        // in to land or rolling off is not yet, or no longer, standing on it.)
        const ankleY = leg.foot.getWorldPosition(v).y;
        const grounded =
          toe.y - floorY - leg.restToe * tall < 0.006 &&
          ankleY - floorY - leg.restAnkle * tall < 0.012 &&
          leg.plant.step === undefined;
        if (grounded && leg.lastGround)
          facts.groundSlide += Math.hypot(toe.x - leg.lastGround.x, toe.z - leg.lastGround.z);
        leg.lastGround = grounded ? toe : undefined;
      });
      facts.feet = sides.map((leg, i) => ({
        down: leg.plant.down,
        stepping: leg.plant.step !== undefined,
        held: Math.hypot(leg.plant.dx, leg.plant.dz),
        toeRise: footSamples[i]!.toeRise,
        ankleRise: footSamples[i]!.ankleRise,
      }));
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
