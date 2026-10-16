/** Bounded document history. Selection and editor preferences are not saved edits. */
export function createHistory<T>(clone: (value: T) => T, equal: (a: T, b: T) => boolean, limit = 100) {
  const past: T[] = [], future: T[] = [];
  let transaction: T | undefined;
  const record = (before: T, after: T) => {
    if (transaction !== undefined || equal(before, after)) return;
    past.push(clone(before));
    if (past.length > limit) past.shift();
    future.length = 0;
  };
  return {
    record,
    begin(current: T) { if (transaction === undefined) transaction = clone(current); },
    commit(current: T) { const before = transaction; transaction = undefined; if (before !== undefined) record(before, current); },
    cancel() { const before = transaction; transaction = undefined; return before; },
    undo(current: T): T | undefined {
      if (transaction !== undefined || !past.length) return undefined;
      future.push(clone(current)); return past.pop();
    },
    redo(current: T): T | undefined {
      if (transaction !== undefined || !future.length) return undefined;
      past.push(clone(current)); return future.pop();
    },
    reset() { past.length = future.length = 0; transaction = undefined; },
    values(): readonly T[] { return [...past, ...future, ...(transaction === undefined ? [] : [transaction])]; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get active() { return transaction !== undefined; },
  };
}
