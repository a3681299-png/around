import { ANIMATION_LIMITS } from './motion-types';
import { ASSET_MESSAGES } from './limits';
import type { AssetInfo } from './validation';

type RecordData = Record<string, unknown>;
function fail(message = 'Lottie JSONの形式が不正です。'): never { throw new Error(message); }
const object = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : fail();
const finite = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail();
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const TYPES = new Set(['gr', 'sh', 'el', 'rc', 'fl', 'st', 'gf', 'gs', 'tr', 'tm', 'sr', 'rd']);

/** Only vector data reaches the expression-free player; no paths, fonts or images. */
export function inspectLottie(bytes: Uint8Array): { info: AssetInfo; data: RecordData } {
  if (bytes.byteLength > ANIMATION_LIMITS.lottieBytes) fail(ASSET_MESSAGES.lottieSize);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
  const data = object(parsed);
  if (typeof data['v'] !== 'string' || !/^[45]\.\d+\.\d+$/.test(data['v'])) fail('Lottie v4／v5のJSONを選択してください。');
  const width = finite(data['w'], 1, ANIMATION_LIMITS.edge), height = finite(data['h'], 1, ANIMATION_LIMITS.edge), fr = finite(data['fr'], 1, 60);
  const ip = finite(data['ip'], 0, 1e6), op = finite(data['op'], ip + 1, ip + 1800), durationMs = (op - ip) / fr * 1000;
  if (!Number.isInteger(width) || !Number.isInteger(height) || durationMs > ANIMATION_LIMITS.durationMs) fail('Lottieは1024px・60fps・30秒以内にしてください。');
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > ANIMATION_LIMITS.nodes || depth > ANIMATION_LIMITS.depth) fail('Lottieのデータが複雑すぎます。');
    if (typeof value === 'number') { finite(value, -1e6, 1e6); return; }
    if (typeof value === 'string') { if (value.length > 256 || /(?:https?:|data:|javascript:|file:|\\|\/\/|url\s*\(|var\s*\()/i.test(value)) fail('外部URLや埋め込み素材は使用できません。'); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype', 'fonts', 'chars', 'segments', 'slots'].includes(key)
        || (key === 'x' && typeof child === 'string') || (key === 'ef' && (!Array.isArray(child) || child.length))
        || (key === 'ddd' && child !== 0)) fail('式・エフェクト・フォント・分割ファイル・3Dは使用できません。');
      visit(child, depth + 1);
    }
  };
  visit(data, 0);
  const assets = new Map<string, RecordData>();
  for (const raw of data['assets'] === undefined ? [] : list(data['assets'])) {
    const asset = object(raw);
    if (typeof asset['id'] !== 'string' || assets.has(asset['id']) || Object.keys(asset).some((k) => !['id', 'layers', 'nm', 'w', 'h'].includes(k))) fail('外部・埋め込み画像や音声素材は使用できません。');
    list(asset['layers']); assets.set(asset['id'], asset);
  }
  if (assets.size > 16) fail('プリコンポジションは16個までです。');
  let expandedLayers = 0, shapes = 0;
  const shapeList = (values: unknown) => {
    for (const raw of list(values)) {
      const shape = object(raw), type = shape['ty'];
      if (++shapes > ANIMATION_LIMITS.shapes || typeof type !== 'string' || !TYPES.has(type)) fail('未対応または多すぎるシェイプです。リピーターは展開して書き出してください。');
      if (type === 'gr') shapeList(shape['it']);
      if (type === 'gf' || type === 'gs') finite(object(shape['g'])['p'], 1, 16);
      if (type === 'sr') {
        const pt = object(shape['pt']);
        if (pt['a'] === 1) for (const raw of list(pt['k'])) { const frame = object(raw); for (const key of ['s', 'e']) if (frame[key] !== undefined) list(frame[key]).forEach((n) => finite(n, 0, 64)); }
        else finite(pt['k'], 0, 64);
      }
    }
  };
  const layers = (values: unknown, stack: readonly string[]) => {
    const entries = list(values).map(object), byId = new Map<number, RecordData>();
    for (const layer of entries) {
      const id = finite(layer['ind'], 0, 1e6); if (byId.has(id)) fail('レイヤーIDが重複しています。'); byId.set(id, layer);
    }
    for (const layer of entries) {
      if (++expandedLayers > ANIMATION_LIMITS.lottieLayers || ![0, 1, 3, 4].includes(layer['ty'] as number)) fail('Lottieは2Dシェイプ・平面・null・プリコンポジションの128レイヤーまでです。テキストはシェイプに変換してください。');
      if (layer['ty'] === 1 && (typeof layer['sc'] !== 'string' || !/^#[0-9a-f]{6}$/i.test(layer['sc']))) fail('平面レイヤーの色は6桁HEXで指定してください。');
      const parents = new Set<unknown>([layer['ind']]); let parent = layer['parent'];
      while (parent !== undefined) { if (parents.has(parent) || !byId.has(parent as number)) fail('Lottieの親レイヤー参照が不正です。'); parents.add(parent); parent = byId.get(parent as number)!['parent']; }
      if (layer['shapes'] !== undefined) shapeList(layer['shapes']);
      if (layer['ty'] === 0) {
        const ref = layer['refId']; if (typeof ref !== 'string' || stack.includes(ref) || !assets.has(ref) || stack.length >= 8) fail('プリコンポジションの参照が不正です。');
        layers(assets.get(ref)!['layers'], [...stack, ref]);
      }
    }
  };
  layers(data['layers'], []);
  // Validate unused assets too; don't retain dormant unsafe or cyclic content.
  for (const [id, asset] of assets) layers(asset['layers'], [id]);
  return { data, info: { mime: 'application/json', width, height, animation: { format: 'lottie', frameCount: Math.ceil(op - ip), frameRate: fr, durationMs } } };
}
