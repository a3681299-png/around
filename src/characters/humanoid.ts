/**
 * The engine's own humanoid vocabulary ("中の形"). Bone names follow VRM 1.0 because that list
 * matches Unity's Humanoid and maps cleanly from other rigs (Mixamo/FBX in R7); nothing here
 * depends on a VRM library object. Pure data and arithmetic: World Runtime may import it.
 */
export const HUMAN_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftEye',
  'rightEye',
  'jaw',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const;
export type HumanBone = (typeof HUMAN_BONES)[number];
const HUMAN_BONE_SET: ReadonlySet<string> = new Set(HUMAN_BONES);
export const isHumanBone = (name: unknown): name is HumanBone => typeof name === 'string' && HUMAN_BONE_SET.has(name);

export type Vec3 = readonly [number, number, number];

/** Rest-pose facts a format adapter (VRM now, FBX in R7) extracts once at import. */
export interface BodyInput {
  /** World position of each mapped bone in the rest pose, in metres, +Y up. */
  bones: Partial<Record<HumanBone, Vec3>>;
  /** Top of the head: the highest vertex mainly weighted to the head bone (not ears or hats). */
  crown: number;
  /** Lowest vertex of the body (the soles). */
  floor: number;
}

export interface BodyMeasure {
  height: number;
  headLength: number;
  headsTall: number;
  legLength: number;
  legRatio: number;
  armLength: number;
  armRatio: number;
  hipsHeight: number;
  hipsRatio: number;
  shoulderWidth: number;
}

const REQUIRED: readonly HumanBone[] = [
  'hips',
  'head',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightHand',
];
const finite = (p: Vec3 | undefined): p is Vec3 => Boolean(p && p.every(Number.isFinite));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Undefined when a required bone is missing or the proportions are degenerate. */
export function measureBody(input: BodyInput): BodyMeasure | undefined {
  const b = input.bones;
  if (!REQUIRED.every((name) => finite(b[name])) || !Number.isFinite(input.crown) || !Number.isFinite(input.floor))
    return undefined;
  // VRM 1.0 makes the neck optional; the head bone is then the lower edge of the head.
  const neck = finite(b.neck) ? b.neck : b.head!;
  const height = input.crown - input.floor,
    headLength = input.crown - neck[1],
    hipsHeight = b.hips![1] - input.floor;
  if (!(height > 0) || !(headLength > 0) || !(hipsHeight > 0) || input.crown <= b.hips![1]) return undefined;
  const legLength = distance(b.leftUpperLeg!, b.leftLowerLeg!) + distance(b.leftLowerLeg!, b.leftFoot!),
    armLength = distance(b.leftUpperArm!, b.leftLowerArm!) + distance(b.leftLowerArm!, b.leftHand!);
  return {
    height,
    headLength,
    headsTall: height / headLength,
    legLength,
    legRatio: legLength / height,
    armLength,
    armRatio: armLength / height,
    hipsHeight,
    hipsRatio: hipsHeight / height,
    shoulderWidth: distance(b.leftUpperArm!, b.rightUpperArm!),
  };
}

/**
 * Provisional (docs/r3-plan.md, decision 6): drawn from two models only, so the user always
 * sees the result and can override it. A value exactly at a threshold keeps standard motions.
 */
export const BODY_THRESHOLDS = Object.freeze({ headsTall: 4, legRatio: 0.42, hipsRatio: 0.48 });
export type BodyReason = 'head' | 'legs' | 'hips';
export function classifyBody(m: BodyMeasure): { stage: 1 | 2; reasons: BodyReason[] } {
  const reasons: BodyReason[] = [];
  if (m.headsTall < BODY_THRESHOLDS.headsTall) reasons.push('head');
  if (m.legRatio < BODY_THRESHOLDS.legRatio) reasons.push('legs');
  if (m.hipsRatio < BODY_THRESHOLDS.hipsRatio) reasons.push('hips');
  return { stage: reasons.length ? 1 : 2, reasons };
}
