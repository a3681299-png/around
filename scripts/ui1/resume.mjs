/** Keep every completed pair; an unfinished tail is retained, never selected away as an outlier. */
export function resumeMeasurement(previous, current, conditions, now = new Date().toISOString()) {
  for (const key of ['mode', 'url', 'environment', 'builds'])
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
      throw new Error(`Cannot resume different measurement ${key}.`);
  const complete = (pair) =>
    conditions.every((condition) =>
      ['startup', 'steady', 'spa'].every((phase) => {
        const block = pair.blocks[condition]?.[phase];
        return Array.isArray(block?.frames) && block.clock?.source === 'document-start-main-world-raf-timestamps';
      }),
    );
  let prefix = 0;
  while (prefix < previous.pairs.length && complete(previous.pairs[prefix])) {
    if (previous.pairs[prefix].pair !== prefix) throw new Error('Completed pairs must be an uninterrupted prefix.');
    prefix++;
  }
  if (previous.pairs.slice(prefix).some(complete)) throw new Error('Cannot select away a completed pair.');
  return {
    ...previous,
    failure: undefined,
    interrupted: [
      ...(previous.interrupted ?? []),
      { at: now, failure: previous.failure, unfinishedPairs: previous.pairs.slice(prefix) },
    ],
    resumedAt: [...(previous.resumedAt ?? []), now],
    pairs: previous.pairs.slice(0, prefix),
  };
}
