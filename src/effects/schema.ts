import { EFFECT_LIMITS, type LayerEffect, type MaskBinding } from './types';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('エフェクトの形式が不正です。');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('マスクの値が範囲外です。');
  return value;
}
function binding(value: unknown): MaskBinding {
  const input = record(value, ['source', 'transform', 'target']);
  const transform = record(input['transform'], ['kind', 'fadeMs']);
  if (input['source'] === 'pointer.position' && input['target'] === 'mask.center' && transform['kind'] === 'layer-local' && !Object.hasOwn(transform, 'fadeMs')) {
    return { source: 'pointer.position', transform: { kind: 'layer-local' }, target: 'mask.center' };
  }
  if (input['source'] === 'video.playing' && input['target'] === 'mask.intensity' && transform['kind'] === 'boolean-gate') {
    return { source: 'video.playing', transform: { kind: 'boolean-gate', fadeMs: number(transform['fadeMs'], 0, EFFECT_LIMITS.fadeMs) }, target: 'mask.intensity' };
  }
  throw new Error('このシグナル接続には対応していません。');
}

/** Rebuild data rather than passing arbitrary CSS, paths or executable fields through. */
export function parseEffects(value: unknown): LayerEffect[] {
  if (!Array.isArray(value) || value.length > EFFECT_LIMITS.count) throw new Error('マスクは各レイヤーに1つまでです。');
  return value.map((value) => {
    const effect = record(value, ['kind', 'shape', 'enabled', 'center', 'radiusPx', 'featherPx', 'intensity', 'bindings']);
    if (effect['kind'] !== 'mask' || effect['shape'] !== 'circle' || typeof effect['enabled'] !== 'boolean') throw new Error('未対応のエフェクトです。');
    const center = record(effect['center'], ['x', 'y']);
    if (!Array.isArray(effect['bindings']) || effect['bindings'].length > 2) throw new Error('シグナル接続が不正です。');
    const bindings = effect['bindings'].map(binding);
    if (new Set(bindings.map((item) => item.target)).size !== bindings.length) throw new Error('エフェクトの接続先が重複しています。');
    // Canonical order keeps saves/undo equality independent of input ordering.
    bindings.sort((a, b) => a.target.localeCompare(b.target));
    return { kind: 'mask', shape: 'circle', enabled: effect['enabled'],
      center: { x: number(center['x'], 0, 1), y: number(center['y'], 0, 1) },
      radiusPx: number(effect['radiusPx'], 1, EFFECT_LIMITS.radius), featherPx: number(effect['featherPx'], 0, EFFECT_LIMITS.feather),
      intensity: number(effect['intensity'], 0, 1), bindings };
  });
}
