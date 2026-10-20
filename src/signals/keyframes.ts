/** Declarative artwork, independent of the recording used to author it. */
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export interface SignalKeyframe {
  id: string;
  input: number;
  value: number;
  easing: KeyframeEasing;
}
export type SignalProperty = 'opacity' | 'position.x' | 'position.y' | 'rotation';
export type NumericSignal =
  'page.scroll.progress' | 'pointer.x' | 'pointer.y' | 'pointer.distance' | 'pointer.angle' | 'pointer.speed';
export interface SignalSource {
  signal: NumericSignal;
  axis: 'x' | 'y';
  space: 'page' | 'viewport' | 'anchor' | 'layer';
  inputRange: [number, number];
}
export interface SignalRule {
  id: string;
  enabled: boolean;
  source: SignalSource;
  target: { layerId: string; property: SignalProperty };
  keyframes: SignalKeyframe[];
  evaluation: { mode: 'follow'; smoothing: { kind: 'none' } };
  blend: { mode: 'replace' | 'add'; priority: 0 };
}
export const propertyRange = (property: SignalProperty): [number, number] =>
  property === 'opacity' ? [0, 1] : property === 'rotation' ? [-360, 360] : [-8192, 8192];
export const propertyLabel = (property: SignalProperty) =>
  ({ opacity: '不透明度', 'position.x': 'X オフセット', 'position.y': 'Y オフセット', rotation: '回転オフセット' })[
    property
  ];
export function defaultSignalRule(layerId: string, property: SignalProperty, source: SignalSource): SignalRule {
  const rule = defaultScrollOpacityRule(layerId);
  return {
    ...rule,
    id: `${property.replace('.', '-')}-${layerId}`.slice(0, 64),
    source,
    target: { layerId, property },
    keyframes:
      property === 'opacity'
        ? rule.keyframes
        : [
            { id: 'key-start', input: 0, value: property === 'rotation' ? -45 : -200, easing: 'linear' },
            { id: 'key-end', input: 1, value: property === 'rotation' ? 45 : 200, easing: 'linear' },
          ],
    blend: { mode: property === 'opacity' ? 'replace' : 'add', priority: 0 },
  };
}
export const SIGNAL_RULE_LIMITS = Object.freeze({ rules: 48, keyframes: 64 });
export function defaultScrollOpacityRule(layerId: string): SignalRule {
  return {
    id: `scroll-${layerId}`.slice(0, 64),
    enabled: true,
    source: { signal: 'page.scroll.progress', axis: 'y', space: 'page', inputRange: [0, 1] },
    target: { layerId, property: 'opacity' },
    keyframes: [
      { id: 'key-start', input: 0, value: 0, easing: 'linear' },
      { id: 'key-middle', input: 0.5, value: 1, easing: 'linear' },
      { id: 'key-end', input: 1, value: 0, easing: 'linear' },
    ],
    evaluation: { mode: 'follow', smoothing: { kind: 'none' } },
    blend: { mode: 'replace', priority: 0 },
  };
}
