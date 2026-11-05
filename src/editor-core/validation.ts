import { isDesignId, parseDecoration, parsePlacement, parseSurfaceStyle } from '../design/schema';
import { IMAGE_LIMITS, type ImagePatch } from '../design/types';
import { ANIMATION_LIMITS } from '../assets/motion-types';
import { MODEL_LIMITS } from '../models/types';
import { CHARACTER_LIMITS, parsePersonality } from '../characters/settings';
import { parseSignalRules } from '../signals/keyframe-schema';
import type { PlacementChange } from '../world/geometry';
import type { SignalRule } from '../signals/keyframes';

/** Type validation must precede JSON/string conversion: neither getters nor
 * toJSON/toString callbacks are command data. This is not a key-name blacklist. */
export function assertCommandData(value: unknown): void {
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(value: unknown, depth: number) {
    if (++nodes > 10_000 || depth > 32) throw new Error('編集コマンドが大きすぎます。');
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || ancestors.has(value))
      throw new Error('編集コマンドはデータだけで指定してください。');
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(Array.isArray(value) && prototype === Array.prototype)
    )
      throw new Error('編集コマンドの形式が不正です。');
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length > 10_000) throw new Error('編集コマンドが大きすぎます。');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !('value' in descriptor))
        throw new Error('実行可能なプロパティは指定できません。');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(value, 0);
}

export function commandObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error('編集コマンドの形式が不正です。');
  return value as Record<string, unknown>;
}
function numeric(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('編集コマンドの値が範囲外です。');
}
function partial(value: unknown, rules: Record<string, (value: unknown) => void>) {
  const input = commandObject(value, Object.keys(rules));
  for (const [key, value] of Object.entries(input)) rules[key]!(value);
  return input;
}
const boolean = (value: unknown) => {
  if (typeof value !== 'boolean') throw new Error('真偽値を指定してください。');
};
const range = (min: number, max: number) => (value: unknown) => numeric(value, min, max);
const index = (max: number) => (value: unknown) => {
  if (value === null) return;
  numeric(value, 0, max);
  if (!Number.isInteger(value)) throw new Error('参照は整数で指定してください。');
};
function modelPatch(value: unknown) {
  // Asset-specific clip/bone/expression membership and merged speed constraints
  // are also checked by patchModel against the selected model's immutable source.
  partial(value, {
    rotationX: range(-180, 180),
    rotationY: range(-180, 180),
    rotationZ: range(-180, 180),
    clip: index(MODEL_LIMITS.clips - 1),
    playing: boolean,
    loop: boolean,
    speed: range(0.1, 4),
    crossFadeMs: range(0, 5000),
    inPlace: boolean,
    locomotion: (v) => {
      partial(v, {
        enabled: boolean,
        idle: index(MODEL_LIMITS.clips - 1),
        walk: index(MODEL_LIMITS.clips - 1),
        run: index(MODEL_LIMITS.clips - 1),
        walkSpeed: range(0.1, 10000),
        runSpeed: range(0.1, 10000),
        faceMovement: boolean,
        forwardDeg: range(-180, 180),
      });
    },
    look: (v) => {
      partial(v, {
        enabled: boolean,
        bone: index(MODEL_LIMITS.nodes - 1),
        yawLimit: range(0, 90),
        pitchLimit: range(0, 80),
        lagMs: range(0, 5000),
      });
    },
    vrm: (v) => {
      partial(v, {
        lookAt: boolean,
        headFollow: boolean,
        springBone: boolean,
        expressions: (v) => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('表情の形式が不正です。');
          const keys = Object.keys(v);
          if (keys.length > 128 || keys.some((key) => !key.length || key.length > 120 || /[\u0000-\u001f]/.test(key)))
            throw new Error('表情名が不正です。');
          const entries = commandObject(v, keys);
          Object.values(entries).forEach(range(0, 1));
        },
      });
    },
  });
}

const base = {
  kind: 'image',
  id: 'validation-layer',
  assetId: `asset-${'0'.repeat(64)}`,
  name: 'Layer',
  placement: { anchor: { kind: 'viewport' }, x: 0, y: 0, widthPx: 1, heightPx: 1, rotationDeg: 0 },
  opacity: 1,
  zIndex: 0,
  visible: true,
  locked: false,
};

/** A patch has an allowlist at every level; scalar rules are shared with saved data. */
export function parseImagePatch(value: unknown): ImagePatch {
  const input = commandObject(value, [
    'name',
    'opacity',
    'zIndex',
    'visible',
    'locked',
    'effects',
    'motion',
    'placement',
    'playback',
    'model',
    'renderMode',
    'character',
  ]);
  const { placement, playback, model, renderMode, character, ...properties } = input;
  // Normal is a real request in a patch even though saved data stores it by omission.
  if (Object.hasOwn(input, 'renderMode') && renderMode !== 'normal' && renderMode !== 'atmosphere')
    throw new Error('描画モードが不正です。');
  if (
    Object.hasOwn(input, 'motion') &&
    (!input['motion'] ||
      typeof input['motion'] !== 'object' ||
      typeof (input['motion'] as Record<string, unknown>)['mode'] !== 'string')
  )
    throw new Error('モーションの種類が不正です。');
  if (Object.hasOwn(input, 'placement')) commandObject(placement, Object.keys(base.placement));
  const parsed = parseDecoration({
    ...base,
    ...properties,
    placement: { ...base.placement, ...(placement as object) },
  });
  const result = Object.fromEntries(
    Object.keys(properties).map((key) => [key, (parsed as unknown as Record<string, unknown>)[key]]),
  );
  if (Object.hasOwn(input, 'placement'))
    result['placement'] = Object.fromEntries(
      Object.keys(placement as object).map((key) => [
        key,
        (parsed.placement as unknown as Record<string, unknown>)[key],
      ]),
    );
  if (Object.hasOwn(input, 'playback')) {
    const fields = partial(playback, {
      playing: boolean,
      loop: boolean,
      speed: range(ANIMATION_LIMITS.speedMin, ANIMATION_LIMITS.speedMax),
      mode: (v) => {
        if (v !== 'auto' && v !== 'controlled') throw new Error('未対応の再生モードです。');
      },
    });
    result['playback'] = { ...fields };
  }
  if (Object.hasOwn(input, 'model')) {
    modelPatch(model);
    result['model'] = model;
  }
  if (Object.hasOwn(input, 'renderMode')) result['renderMode'] = renderMode;
  if (Object.hasOwn(input, 'character')) {
    // Membership of the kept IDs is checked against the layer by applyCharacterPatch.
    const c = commandObject(character, ['standardMotions', 'keep', 'personality', 'computedMotion', 'autonomy']);
    if (Object.hasOwn(c, 'standardMotions') && !['auto', 'on', 'off'].includes(c['standardMotions'] as string))
      throw new Error('標準の動作の設定が不正です。');
    // v15: three numbers in 0…1 and two booleans; the document parser checks them again.
    if (Object.hasOwn(c, 'personality')) c['personality'] = parsePersonality(c['personality']);
    for (const key of ['computedMotion', 'autonomy'])
      if (Object.hasOwn(c, key) && typeof c[key] !== 'boolean') throw new Error('キャラの動きの設定が不正です。');
    if (
      Object.hasOwn(c, 'keep') &&
      (!Array.isArray(c['keep']) ||
        c['keep'].length > CHARACTER_LIMITS.motions ||
        c['keep'].some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)))
    )
      throw new Error('キャラの動作の指定が不正です。');
    result['character'] = c;
  }
  return JSON.parse(JSON.stringify(result)) as ImagePatch;
}
export function parsePlacements(value: unknown): PlacementChange[] {
  if (!Array.isArray(value) || value.length > IMAGE_LIMITS.count) throw new Error('配置が不正です。');
  const ids = new Set<string>();
  return value.map((raw) => {
    const entry = commandObject(raw, ['id', 'placement']);
    if (!isDesignId(entry['id']) || ids.has(entry['id'])) throw new Error('配置のレイヤー指定が不正です。');
    ids.add(entry['id']);
    return { id: entry['id'], placement: parsePlacement(entry['placement']) };
  });
}
export const parseStyle = parseSurfaceStyle;
export function parseSignalRule(value: unknown): SignalRule {
  const rule = commandObject(value, ['id', 'enabled', 'source', 'target', 'keyframes', 'evaluation', 'blend']);
  const target = commandObject(rule['target'], ['layerId', 'property']);
  const source = commandObject(rule['source'], ['signal', 'axis', 'space', 'inputRange']);
  if (
    ['signal', 'axis', 'space'].some((key) => typeof source[key] !== 'string') ||
    typeof target['property'] !== 'string'
  )
    throw new Error('シグナルの種類は文字列で指定してください。');
  if (Array.isArray(rule['keyframes']))
    for (const key of rule['keyframes']) {
      const frame = commandObject(key, ['id', 'input', 'value', 'easing']);
      if (typeof frame['easing'] !== 'string') throw new Error('補間の種類は文字列で指定してください。');
    }
  return parseSignalRules([rule], new Set(typeof target['layerId'] === 'string' ? [target['layerId']] : []))[0]!;
}
