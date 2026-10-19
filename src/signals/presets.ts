import type { SignalSource } from './keyframes';
export const SIGNAL_PRESETS: readonly { id: string; label: string; source: SignalSource; unit: string }[] = [
  { id: 'scroll', label: 'ページのスクロール', source: { signal: 'page.scroll.progress', axis: 'y', space: 'page', inputRange: [0, 1] }, unit: '%' },
  { id: 'mouse-x', label: 'マウス X / 画面', source: { signal: 'pointer.x', axis: 'x', space: 'viewport', inputRange: [0, 1] }, unit: '%' },
  { id: 'mouse-y', label: 'マウス Y / 画面', source: { signal: 'pointer.y', axis: 'y', space: 'viewport', inputRange: [0, 1] }, unit: '%' },
  { id: 'anchor-x', label: 'マウス X / 配置アンカー', source: { signal: 'pointer.x', axis: 'x', space: 'anchor', inputRange: [0, 1] }, unit: '%' },
  { id: 'anchor-y', label: 'マウス Y / 配置アンカー', source: { signal: 'pointer.y', axis: 'y', space: 'anchor', inputRange: [0, 1] }, unit: '%' },
  { id: 'layer-distance', label: 'マウスと基本位置の距離', source: { signal: 'pointer.distance', axis: 'y', space: 'layer', inputRange: [0, 1] }, unit: '%' },
  { id: 'anchor-distance', label: 'マウスとアンカー中心の距離', source: { signal: 'pointer.distance', axis: 'y', space: 'anchor', inputRange: [0, 1] }, unit: '%' },
  { id: 'layer-angle', label: 'マウスから基本位置への角度', source: { signal: 'pointer.angle', axis: 'y', space: 'layer', inputRange: [-180, 180] }, unit: '°' },
  { id: 'anchor-angle', label: 'マウスからアンカーへの角度', source: { signal: 'pointer.angle', axis: 'y', space: 'anchor', inputRange: [-180, 180] }, unit: '°' },
  { id: 'mouse-speed', label: 'マウスの速度', source: { signal: 'pointer.speed', axis: 'y', space: 'viewport', inputRange: [0, 2000] }, unit: 'px/s' },
];
export const signalPreset = (source: SignalSource) => SIGNAL_PRESETS.find((preset) => preset.source.signal === source.signal && preset.source.space === source.space) ?? SIGNAL_PRESETS[0]!;
