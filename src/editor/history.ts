export interface HistoryCheckpoint<T> { past: T[]; future: T[]; transaction?: T }

/** Bounded document history. Selection and editor preferences are not saved edits. */
export function createHistory<T>(clone: (value: T) => T, equal: (a: T, b: T) => boolean, limit = 100) {
  const past: T[] = [], future: T[] = [];
  let transaction: T | undefined;
  let version = 0;
  const record = (before: T, after: T) => {
    if (transaction !== undefined || equal(before, after)) return;
    past.push(clone(before));
    version++;
    if (past.length > limit) past.shift();
    future.length = 0;
  };
  return {
    record,
    begin(current: T) { if (transaction === undefined) { transaction = clone(current); version++; } },
    commit(current: T) { const before = transaction; transaction = undefined; version++; if (before !== undefined) record(before, current); },
    cancel() { const before = transaction; transaction = undefined; version++; return before; },
    undo(current: T): T | undefined {
      if (transaction !== undefined || !past.length) return undefined;
      version++; future.push(clone(current)); return past.pop();
    },
    redo(current: T): T | undefined {
      if (transaction !== undefined || !future.length) return undefined;
      version++; past.push(clone(current)); return future.pop();
    },
    reset() { past.length = future.length = 0; transaction = undefined; version++; },
    values(): readonly T[] { return [...past, ...future, ...(transaction === undefined ? [] : [transaction])]; },
    checkpoint(): HistoryCheckpoint<T> { return { past: past.map(clone), future: future.map(clone), ...(transaction === undefined ? {} : { transaction: clone(transaction) }) }; },
    restore(value: HistoryCheckpoint<T>) {
      if (!Array.isArray(value.past) || !Array.isArray(value.future) || value.past.length > limit || value.future.length > limit) throw new Error('編集履歴が不正です。');
      const old = value.past.map(clone), next = value.future.map(clone), active = value.transaction === undefined ? undefined : clone(value.transaction);
      past.splice(0, past.length, ...old); future.splice(0, future.length, ...next); transaction = active;
      version++;
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get active() { return transaction !== undefined; },
    get version() { return version; },
  };
}
