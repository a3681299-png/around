import { SIGNAL_RULE_LIMITS, propertyRange, type SignalRule, type KeyframeEasing, type SignalSource, type SignalProperty } from './keyframes';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new Error('シグナルルールの形式が不正です。');
  return value as Record<string, unknown>;
}
function unit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('キーの位置と値は0〜100%で指定してください。'); return value;
}
export function parseSignalSource(value: unknown): SignalSource {
  const source = object(value, ['signal', 'axis', 'space', 'inputRange']);
  if (!['page.scroll.progress', 'pointer.x', 'pointer.y', 'pointer.distance', 'pointer.angle', 'pointer.speed'].includes(String(source['signal'])) || !['x', 'y'].includes(String(source['axis'])) || !['page', 'viewport', 'anchor', 'layer'].includes(String(source['space'])) || !Array.isArray(source['inputRange']) || source['inputRange'].length !== 2) throw new Error('駆動元が不正です。');
  if (source['signal'] === 'page.scroll.progress' ? source['space'] !== 'page' || source['axis'] !== 'y' : source['space'] === 'page' || ['pointer.x', 'pointer.y', 'pointer.speed'].includes(String(source['signal'])) && source['space'] === 'layer') throw new Error('駆動元の座標系が不正です。');
  const range = source['inputRange'];
  if (range.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < -1e6 || n > 1e6) || range[0] >= range[1]) throw new Error('入力範囲の開始は終了より小さくしてください。');
  return { signal: source['signal'] as SignalSource['signal'], axis: source['axis'] as SignalSource['axis'], space: source['space'] as SignalSource['space'], inputRange: [range[0], range[1]] };
}
export function parseSignalRules(value: unknown, layerIds: ReadonlySet<string>, legacy = false): SignalRule[] {
  if (!Array.isArray(value) || value.length > SIGNAL_RULE_LIMITS.rules) throw new Error('シグナルルールは48本までです。');
  const ids = new Set<string>(), targets = new Set<string>();
  return value.map((raw) => {
    const rule = object(raw, ['id', 'enabled', 'source', 'target', 'keyframes', 'evaluation', 'blend']);
    if (!id(rule['id']) || ids.has(rule['id']) || typeof rule['enabled'] !== 'boolean') throw new Error('ルールの識別子が不正または重複しています。'); ids.add(rule['id']);
    const source = parseSignalSource(rule['source']), target = object(rule['target'], ['layerId', 'property']);
    if (legacy && (source.signal !== 'page.scroll.progress' || source.space !== 'page' || source.axis !== 'y' || source.inputRange.some((n) => n < 0 || n > 1))) throw new Error('v8以前の駆動元はスクロール進捗です。');
    if (!id(target['layerId']) || !layerIds.has(target['layerId']) || !['opacity', ...(!legacy ? ['position.x', 'position.y', 'rotation'] : [])].includes(String(target['property']))) throw new Error('ルールの対象が見つかりません。');
    const property = target['property'] as SignalProperty, signature = `${target['layerId']}:${property}`;
    if (rule['enabled'] && targets.has(signature)) throw new Error('同じプロパティへ接続できる有効なルールは1本です。');
    if (rule['enabled']) targets.add(signature);
    const evaluation = object(rule['evaluation'], ['mode', 'smoothing']), smoothing = object(evaluation['smoothing'], ['kind']), blend = object(rule['blend'], ['mode', 'priority']);
    if (evaluation['mode'] !== 'follow' || smoothing['kind'] !== 'none' || blend['mode'] !== (property === 'opacity' ? 'replace' : 'add') || blend['priority'] !== 0) throw new Error('不透明度は置換、変形は加算で接続してください。');
    if (!Array.isArray(rule['keyframes']) || rule['keyframes'].length < 1 || rule['keyframes'].length > SIGNAL_RULE_LIMITS.keyframes) throw new Error('キーは1〜64個で指定してください。');
    const keys = new Set<string>(), positions = new Set<number>();
    const keyframes = rule['keyframes'].map((raw) => {
      const key = object(raw, ['id', 'input', 'value', 'easing']), input = unit(key['input']);
      if (!id(key['id']) || keys.has(key['id']) || positions.has(input) || !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(String(key['easing']))) throw new Error('キーの識別子・位置・補間が不正です。同じ位置には1個だけ置けます。');
      keys.add(key['id']); positions.add(input);
      const [min, max] = propertyRange(property), value = key['value'];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('キーの値が範囲外です。');
      return { id: key['id'], input, value, easing: key['easing'] as KeyframeEasing };
    }).sort((a, b) => a.input - b.input);
    return { id: rule['id'], enabled: rule['enabled'], source, target: { layerId: target['layerId'], property }, keyframes, evaluation: { mode: 'follow', smoothing: { kind: 'none' } }, blend: { mode: property === 'opacity' ? 'replace' : 'add', priority: 0 } };
  });
}
