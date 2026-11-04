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
  const v = object(value, ['standardMotions', 'motions']);
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
  return { standardMotions: v['standardMotions'] as CharacterSettings['standardMotions'], motions };
}

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
  return {
    character: { standardMotions: patch.standardMotions ?? layer.character.standardMotions, motions },
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
