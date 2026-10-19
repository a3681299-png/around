/** Declarative artwork, independent of the recording used to author it. */
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export interface SignalKeyframe { id: string; input: number; value: number; easing: KeyframeEasing }
export interface SignalRule {
  id: string;
  enabled: boolean;
  source: { signal: 'page.scroll.progress'; axis: 'y'; space: 'page'; inputRange: [number, number] };
  target: { layerId: string; property: 'opacity' };
  keyframes: SignalKeyframe[];
  evaluation: { mode: 'follow'; smoothing: { kind: 'none' } };
  blend: { mode: 'replace'; priority: 0 };
}
export const SIGNAL_RULE_LIMITS = Object.freeze({ rules: 48, keyframes: 64 });
export function defaultScrollOpacityRule(layerId: string): SignalRule {
  return { id: `scroll-${layerId}`.slice(0, 64), enabled: true,
    source: { signal: 'page.scroll.progress', axis: 'y', space: 'page', inputRange: [0, 1] }, target: { layerId, property: 'opacity' },
    keyframes: [{ id: 'key-start', input: 0, value: 0, easing: 'linear' }, { id: 'key-middle', input: .5, value: 1, easing: 'linear' }, { id: 'key-end', input: 1, value: 0, easing: 'linear' }],
    evaluation: { mode: 'follow', smoothing: { kind: 'none' } }, blend: { mode: 'replace', priority: 0 } };
}
