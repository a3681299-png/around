/** YouTube's native white rim/wash is preserved above the art. Verify the source colour's
 * compositing line and visible chroma, instead of pretending that native paint is absent.
 * Missing paint (white), a different hue and a fully obscured edge must all fail. */
export function hasFrameColour(actual: readonly number[], source: readonly number[]): boolean {
  if (actual.length !== 3 || source.length !== 3) return false;
  const channel = source.indexOf(Math.min(...source));
  const alpha = (actual[channel]! - source[channel]!) / (255 - source[channel]!);
  return (
    alpha >= -1 / 255 &&
    alpha <= 0.5 + 1 / 255 &&
    source.every((value, index) => Math.abs(actual[index]! - (value + (255 - value) * alpha)) <= 2)
  );
}
