import { SIGNAL_RULE_LIMITS, type SignalRule, type KeyframeEasing } from './keyframes';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new Error('シグナルルールの形式が不正です。');
  return value as Record<string, unknown>;
}
function unit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('キーの位置と値は0〜100%で指定してください。'); return value;
}
export function parseSignalRules(value: unknown, layerIds: ReadonlySet<string>): SignalRule[] {
  if (!Array.isArray(value) || value.length > SIGNAL_RULE_LIMITS.rules) throw new Error('シグナルルールは48本までです。');
  const ids = new Set<string>(), targets = new Set<string>();
  return value.map((raw) => {
    const rule = object(raw, ['id', 'enabled', 'source', 'target', 'keyframes', 'evaluation', 'blend']);
    if (!id(rule['id']) || ids.has(rule['id']) || typeof rule['enabled'] !== 'boolean') throw new Error('ルールの識別子が不正または重複しています。'); ids.add(rule['id']);
    const source = object(rule['source'], ['signal', 'axis', 'space', 'inputRange']), target = object(rule['target'], ['layerId', 'property']);
    if (source['signal'] !== 'page.scroll.progress' || source['axis'] !== 'y' || source['space'] !== 'page' || !Array.isArray(source['inputRange']) || source['inputRange'].length !== 2) throw new Error('v1の駆動元はページの縦スクロール進捗です。');
    const range: [number, number] = [unit(source['inputRange'][0]), unit(source['inputRange'][1])];
    if (range[0] >= range[1]) throw new Error('入力範囲の開始は終了より小さくしてください。');
    if (!id(target['layerId']) || !layerIds.has(target['layerId']) || target['property'] !== 'opacity') throw new Error('不透明度ルールの対象が見つかりません。');
    if (rule['enabled'] && targets.has(target['layerId'])) throw new Error('v1では同じ不透明度へ接続できる有効なルールは1本です。');
    if (rule['enabled']) targets.add(target['layerId']);
    const evaluation = object(rule['evaluation'], ['mode', 'smoothing']), smoothing = object(evaluation['smoothing'], ['kind']), blend = object(rule['blend'], ['mode', 'priority']);
    if (evaluation['mode'] !== 'follow' || smoothing['kind'] !== 'none' || blend['mode'] !== 'replace' || blend['priority'] !== 0) throw new Error('v1は往復追従・平滑化なし・置換に対応します。');
    if (!Array.isArray(rule['keyframes']) || rule['keyframes'].length < 1 || rule['keyframes'].length > SIGNAL_RULE_LIMITS.keyframes) throw new Error('キーは1〜64個で指定してください。');
    const keys = new Set<string>(), positions = new Set<number>();
    const keyframes = rule['keyframes'].map((raw) => {
      const key = object(raw, ['id', 'input', 'value', 'easing']), input = unit(key['input']);
      if (!id(key['id']) || keys.has(key['id']) || positions.has(input) || !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(String(key['easing']))) throw new Error('キーの識別子・位置・補間が不正です。同じ位置には1個だけ置けます。');
      keys.add(key['id']); positions.add(input);
      return { id: key['id'], input, value: unit(key['value']), easing: key['easing'] as KeyframeEasing };
    }).sort((a, b) => a.input - b.input);
    return { id: rule['id'], enabled: rule['enabled'], source: { signal: 'page.scroll.progress', axis: 'y', space: 'page', inputRange: range },
      target: { layerId: target['layerId'], property: 'opacity' }, keyframes, evaluation: { mode: 'follow', smoothing: { kind: 'none' } }, blend: { mode: 'replace', priority: 0 } };
  });
}
