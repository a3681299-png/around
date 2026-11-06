import { object, numeric, type ModelInfo, type ModelSettings } from '../models/types';
import { oneOf } from '../validation';
import { classifyBody, HUMAN_BONES, isHumanBone, type BodyMeasure, type HumanBone } from './humanoid';
import type { VrmAnimationInfo } from './motion-info';

/**
 * A model3d layer's character data (DesignDocument v14). Only validated, declarative values:
 * motion asset IDs, fixed role names and numbers measured at import. With a character, the
 * layer's clip indices (model.clip, locomotion) address these motions, not the model's own clips.
 */
export const MOTION_ROLES = ['idle', 'gesture', 'react', 'dance', 'move', 'sit', 'edge'] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];
export interface CharacterMotion {
  id: string;
  assetId: string;
  role: MotionRole;
  /** standard: a motion for any normal body (stage 2). character: made for this model (stage 3). */
  origin: 'standard' | 'character';
  loop: boolean;
  /** Facts measured from the .vrma at import (inspectVrma), never from a manifest. */
  source: VrmAnimationInfo;
}
export interface CharacterSettings {
  /** auto follows the body measure; on/off is the user's override shown next to it. */
  standardMotions: 'auto' | 'on' | 'off';
  motions: CharacterMotion[];
  /** v15: who the character is. Each 0…1; absent means 0.5 each. Only numbers, never formulas. */
  personality?: CharacterPersonality;
  /** v15: the author can stop the computed motion (breathing, sway…); absent means on (v14). */
  computedMotion?: boolean;
  /** v15: the author can turn the autonomy on; absent means off, so older artwork keeps the
   * behaviour it had (docs/spatial-design.md: no silent switch to a new state machine). */
  autonomy?: boolean;
  /** v15: the motion each autonomy behaviour plays, which part of it and how fast. Absent: none
   * (the computed motion alone). Only a fixed behaviour name, a motion id and numbers. */
  behaviourMotions?: BehaviourMotions;
}
/** The autonomy's behaviours (src/world/autonomy.ts BEHAVIOURS; kept equal by a unit test). */
export const BEHAVIOUR_NAMES = ['rest', 'flee', 'approach', 'doze', 'return'] as const;
export type BehaviourName = (typeof BEHAVIOUR_NAMES)[number];
export interface BehaviourMotion {
  /** One of this character's motion ids. */
  motion: string;
  /** The part played, in the motion's seconds (0 ≤ from < to ≤ its duration), looped. */
  from: number;
  to: number;
  /** 0.25…4 times the clock. */
  speed: number;
}
export type BehaviourMotions = Partial<Record<BehaviourName, BehaviourMotion>>;
export interface CharacterPersonality {
  shyness: number;
  curiosity: number;
  sleepiness: number;
}
export const CHARACTER_LIMITS = Object.freeze({ motions: 64, durationSeconds: 600, metres: 100 });

const label = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 120 || /[\u0000-\u001f]/.test(v)) throw new Error('動作の名前が不正です。');
  return v;
};
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw new Error('キャラ設定が不正です。');
  return v;
};
const assetPattern = /^asset-[0-9a-f]{64}$/;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;

export function parseVrmAnimationInfo(value: unknown): VrmAnimationInfo {
  const v = object(value, ['format', 'name', 'duration', 'bones', 'hipsTranslation', 'restHipsHeight', 'hipsTravel']);
  if (v['format'] !== 'vrma' || !Array.isArray(v['bones']) || v['bones'].length > HUMAN_BONES.length)
    throw new Error('動作の情報が不正です。');
  const bones = v['bones'].map((b) => {
    if (!isHumanBone(b)) throw new Error('動作の骨の名前が不正です。');
    return b;
  });
  if (new Set(bones).size !== bones.length || !bones.includes('hips')) throw new Error('動作の骨が不正です。');
  const travel = v['hipsTravel'];
  if (!Array.isArray(travel) || travel.length !== 3) throw new Error('動作の腰の移動が不正です。');
  const m = CHARACTER_LIMITS.metres;
  return {
    format: 'vrma',
    name: label(v['name']),
    duration: numeric(v['duration'], 0, CHARACTER_LIMITS.durationSeconds),
    // Keep the engine's bone order so equal inputs serialize equally.
    bones: HUMAN_BONES.filter((b) => bones.includes(b)) as HumanBone[],
    hipsTranslation: bool(v['hipsTranslation']),
    restHipsHeight: numeric(v['restHipsHeight'], 0.001, m),
    hipsTravel: [numeric(travel[0], -m, m), numeric(travel[1], -m, m), numeric(travel[2], -m, m)],
  };
}

export function parseCharacter(value: unknown, source: ModelInfo): CharacterSettings {
  if (source.format !== 'vrm' || !source.vrm) throw new Error('キャラ設定にはVRMモデルが必要です。');
  const v = object(value, [
    'standardMotions',
    'motions',
    'personality',
    'computedMotion',
    'autonomy',
    'behaviourMotions',
  ]);
  if (!oneOf(v['standardMotions'], ['auto', 'on', 'off']) || !Array.isArray(v['motions']))
    throw new Error('キャラ設定が不正です。');
  if (v['motions'].length > CHARACTER_LIMITS.motions)
    throw new Error(`キャラの動作は${CHARACTER_LIMITS.motions}個までです。`);
  const motions = v['motions'].map((item): CharacterMotion => {
    const x = object(item, ['id', 'assetId', 'role', 'origin', 'loop', 'source']);
    if (
      typeof x['id'] !== 'string' ||
      !idPattern.test(x['id']) ||
      typeof x['assetId'] !== 'string' ||
      !assetPattern.test(x['assetId']) ||
      !oneOf(x['role'], MOTION_ROLES) ||
      !oneOf(x['origin'], ['standard', 'character'])
    )
      throw new Error('キャラの動作の設定が不正です。');
    return {
      id: x['id'],
      assetId: x['assetId'],
      role: x['role'] as MotionRole,
      origin: x['origin'] as CharacterMotion['origin'],
      loop: bool(x['loop']),
      source: parseVrmAnimationInfo(x['source']),
    };
  });
  if (new Set(motions.map((m) => m.id)).size !== motions.length)
    throw new Error('キャラの動作の名前が重複しています。');
  return {
    standardMotions: v['standardMotions'] as CharacterSettings['standardMotions'],
    motions,
    ...(v['personality'] === undefined ? {} : { personality: parsePersonality(v['personality']) }),
    ...(v['computedMotion'] === undefined ? {} : { computedMotion: bool(v['computedMotion']) }),
    ...(v['autonomy'] === undefined ? {} : { autonomy: bool(v['autonomy']) }),
    ...(v['behaviourMotions'] === undefined
      ? {}
      : { behaviourMotions: parseBehaviourMotions(v['behaviourMotions'], motions) }),
  };
}

const hundredths = (n: number) => Math.round(n * 100) / 100;
/** Each entry names a known behaviour and one of these motions; the part lies inside it. */
export function parseBehaviourMotions(value: unknown, motions: readonly CharacterMotion[]): BehaviourMotions {
  const v = object(value, [...BEHAVIOUR_NAMES]);
  const out: BehaviourMotions = {};
  for (const name of BEHAVIOUR_NAMES) {
    if (v[name] === undefined) continue;
    const x = object(v[name], ['motion', 'from', 'to', 'speed']);
    const target = typeof x['motion'] === 'string' ? motions.find((m) => m.id === x['motion']) : undefined;
    if (!target) throw new Error('自律の動作の割り当てが不正です。');
    const duration = target.source.duration;
    const from = hundredths(numeric(x['from'], 0, duration)),
      to = hundredths(numeric(x['to'], 0, duration)),
      speed = hundredths(numeric(x['speed'], 0.25, 4));
    // A held pose (a one-frame motion, length 0) is the part 0…0; any other part has a length.
    if (duration === 0 ? from !== 0 || to !== 0 : !(to > from) || to > duration + 1e-9)
      throw new Error('自律の動作の区間が不正です。');
    out[name] = { motion: target.id, from, to, speed };
  }
  return out;
}

/** Three numbers in 0…1 (rounded to 0.01 so equal values serialise equally); nothing else. */
export function parsePersonality(value: unknown): CharacterPersonality {
  const v = object(value, ['shyness', 'curiosity', 'sleepiness']);
  const unit = (n: unknown) => Math.round(numeric(n, 0, 1) * 100) / 100;
  return { shyness: unit(v['shyness']), curiosity: unit(v['curiosity']), sleepiness: unit(v['sleepiness']) };
}
export const DEFAULT_CHARACTER_PERSONALITY: CharacterPersonality = Object.freeze({
  shyness: 0.5,
  curiosity: 0.5,
  sleepiness: 0.5,
});

/** The clip list a layer's indices address: its character motions, or the model's own clips. */
export const modelClips = (layer: {
  source: ModelInfo;
  character?: CharacterSettings | undefined;
}): ModelInfo['clips'] =>
  layer.character
    ? layer.character.motions.map((m) => ({ name: m.id, duration: m.source.duration }))
    : layer.source.clips;

export interface CharacterPatch {
  standardMotions?: CharacterSettings['standardMotions'];
  personality?: CharacterPersonality;
  computedMotion?: boolean;
  autonomy?: boolean;
  /** Replaces the whole assignment (validated again with the document). */
  behaviourMotions?: BehaviourMotions;
  /** Motion IDs to keep, in order: a subset of the current motions (removal and reordering). */
  keep?: string[];
}
/**
 * Keeps model clip indices on the same motions after removal or reordering; an index whose
 * motion was removed becomes null. The result is validated again by the document parser.
 */
export function applyCharacterPatch(
  layer: { source: ModelInfo; character: CharacterSettings; model: ModelSettings },
  patch: CharacterPatch,
): { character: CharacterSettings; model: ModelSettings } {
  const motions = patch.keep
    ? patch.keep.map((id) => {
        const motion = layer.character.motions.find((m) => m.id === id);
        if (!motion) throw new Error('キャラの動作が見つかりません。');
        return motion;
      })
    : layer.character.motions;
  if (new Set(motions).size !== motions.length) throw new Error('キャラの動作が重複しています。');
  const remap = (index: number | null) => {
    if (index === null) return null;
    const at = motions.indexOf(layer.character.motions[index]!);
    return at < 0 ? null : at;
  };
  const model = layer.model;
  // An assignment whose motion was removed goes with it (like a clip index becoming null).
  const assigned = patch.behaviourMotions ?? layer.character.behaviourMotions;
  const behaviourMotions =
    assigned &&
    (Object.fromEntries(
      Object.entries(assigned).filter(([, entry]) => entry && motions.some((m) => m.id === entry.motion)),
    ) as BehaviourMotions);
  const { behaviourMotions: _previous, ...rest } = layer.character;
  return {
    // The v15 behaviour settings ride along unless the patch sets them.
    character: {
      ...rest,
      standardMotions: patch.standardMotions ?? layer.character.standardMotions,
      motions,
      ...(patch.personality ? { personality: patch.personality } : {}),
      ...(patch.computedMotion === undefined ? {} : { computedMotion: patch.computedMotion }),
      ...(patch.autonomy === undefined ? {} : { autonomy: patch.autonomy }),
      ...(behaviourMotions ? { behaviourMotions } : {}),
    },
    model: {
      ...model,
      clip: remap(model.clip),
      locomotion: {
        ...model.locomotion,
        idle: remap(model.locomotion.idle),
        walk: remap(model.locomotion.walk),
        run: remap(model.locomotion.run),
      },
    },
  };
}

/** Whether the standard (any-model) motions may play. An unmeasured body keeps the simple ones. */
export function standardMotionsUsable(character: CharacterSettings, body: BodyMeasure | undefined): boolean {
  if (character.standardMotions !== 'auto') return character.standardMotions === 'on';
  return Boolean(body && classifyBody(body).stage === 2);
}
/** The body measure only gates standard motions; a character's own motions (stage 3) always play. */
export function motionUsable(character: CharacterSettings, index: number, body: BodyMeasure | undefined): boolean {
  const motion = character.motions[index];
  return Boolean(motion && (motion.origin === 'character' || standardMotionsUsable(character, body)));
}
