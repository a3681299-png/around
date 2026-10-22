import type { SignalRule } from './keyframes';

/** Rule values are significant; object property insertion order is not. */
export function sameSignalRule(a: SignalRule | undefined, b: SignalRule | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.enabled === b.enabled &&
    a.source.signal === b.source.signal &&
    a.source.axis === b.source.axis &&
    a.source.space === b.source.space &&
    a.source.inputRange[0] === b.source.inputRange[0] &&
    a.source.inputRange[1] === b.source.inputRange[1] &&
    a.target.layerId === b.target.layerId &&
    a.target.property === b.target.property &&
    a.evaluation.mode === b.evaluation.mode &&
    a.evaluation.smoothing.kind === b.evaluation.smoothing.kind &&
    a.blend.mode === b.blend.mode &&
    a.blend.priority === b.blend.priority &&
    a.keyframes.length === b.keyframes.length &&
    a.keyframes.every((key, index) => {
      const other = b.keyframes[index]!;
      return (
        key.id === other.id && key.input === other.input && key.value === other.value && key.easing === other.easing
      );
    })
  );
}
