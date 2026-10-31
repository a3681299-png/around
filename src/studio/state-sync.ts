import { packCheckpoint, unpackCheckpoint, type PackedCheckpoint } from './checkpoint-codec';
import type { DesignDocument } from '../design/types';
import type { EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import type { HistoryCheckpoint } from '../editor/history';
import { freezeTree } from '../design/immutable';

/** Sparse tree changes: array indices are keys too; no unchanged subtree is serialized. */
export type TreeChange =
  | { unset: true }
  | { set: unknown }
  | { keyed: { field: 'id' | 'target'; items: Record<string, TreeChange>; order?: string[] } }
  | { keys: Record<string, TreeChange>; remove: string[]; length?: number };
function arrayKey(before: unknown[], next: unknown[]): 'id' | 'target' | undefined {
  for (const key of ['id', 'target'] as const) {
    const valid = (items: unknown[]) =>
      items.every(
        (item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>)[key] === 'string',
      ) && new Set(items.map((item) => (item as Record<string, unknown>)[key])).size === items.length;
    if (valid(before) && valid(next)) return key;
  }
}
export function treeChange(before: unknown, next: unknown): TreeChange | undefined {
  if (before === next) return;
  if (next === undefined) return { unset: true };
  if (
    !before ||
    !next ||
    typeof before !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(before) !== Array.isArray(next)
  )
    return { set: next };
  if (Array.isArray(before) && Array.isArray(next)) {
    const field = arrayKey(before, next);
    if (field) {
      const a = new Map(before.map((item) => [item[field] as string, item as unknown]));
      const order = next.map((item) => item[field] as string),
        items: Record<string, TreeChange> = Object.create(null) as Record<string, TreeChange>;
      for (const item of next) {
        const change = treeChange(a.get(item[field]), item);
        if (change) items[item[field]] = change;
      }
      const reordered = before.length !== next.length || order.some((id, i) => before[i]?.[field] !== id);
      if (!reordered && !Object.keys(items).length) return;
      return { keyed: { field, items, ...(reordered ? { order } : {}) } };
    }
  }
  const a = before as Record<string, unknown>,
    b = next as Record<string, unknown>;
  const keys: Record<string, TreeChange> = Object.create(null) as Record<string, TreeChange>,
    remove = Object.keys(a).filter((key) => !Object.hasOwn(b, key));
  for (const key of Object.keys(b)) {
    const change = treeChange(a[key], b[key]);
    if (change) keys[key] = change;
  }
  const length =
    Array.isArray(next) && (!Array.isArray(before) || before.length !== next.length) ? next.length : undefined;
  if (!Object.keys(keys).length && !remove.length && length === undefined) return;
  return { keys, remove, ...(length === undefined ? {} : { length }) };
}
export function applyTreeChange<T>(before: T, change: TreeChange | undefined): T {
  if (!change) return before;
  if ('unset' in change) return undefined as T;
  if ('set' in change) return change.set as T;
  if ('keyed' in change) {
    if (!Array.isArray(before)) throw new Error('配列差分の基準が不正です。');
    const { field, items, order } = change.keyed;
    const values = new Map(before.map((item: Record<string, unknown>) => [item[field], item]));
    const ids = order ?? before.map((item: Record<string, unknown>) => item[field] as string);
    if (new Set(ids).size !== ids.length) throw new Error('配列差分のIDが重複しています。');
    return ids.map((id) => {
      const value = applyTreeChange(values.get(id), Object.hasOwn(items, id) ? items[id] : undefined);
      if (!value || value[field] !== id) throw new Error('配列差分のIDが不正です。');
      return value;
    }) as T;
  }
  if (!before || typeof before !== 'object') throw new Error('差分の基準が不正です。');
  const next = (Array.isArray(before) ? [...before] : { ...before }) as Record<string, unknown>;
  for (const key of change.remove) delete next[key];
  for (const [key, value] of Object.entries(change.keys))
    Object.defineProperty(next, key, {
      value: applyTreeChange(next[key], value),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  if (change.length !== undefined) (next as unknown as unknown[]).length = change.length;
  return next as T;
}
interface HistorySplice {
  drop: number;
  start: number;
  remove: number;
  insert: (TreeChange | null)[];
}
interface HistoryChange {
  past?: HistorySplice;
  future?: HistorySplice;
  transaction?: { value: TreeChange | null } | null;
}
function historySplice(
  before: DesignDocument[],
  next: DesignDocument[],
  base: DesignDocument,
): HistorySplice | undefined {
  const drop = next.length ? Math.max(0, before.indexOf(next[0]!)) : 0;
  before = before.slice(drop);
  let start = 0,
    end = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) start++;
  while (
    end < before.length - start &&
    end < next.length - start &&
    before[before.length - end - 1] === next[next.length - end - 1]
  )
    end++;
  if (!drop && start === before.length && start === next.length) return;
  return {
    drop,
    start,
    remove: before.length - start - end,
    insert: next.slice(start, next.length - end).map((doc) => treeChange(base, doc) ?? null),
  };
}
function changeHistory(
  before: HistoryCheckpoint<DesignDocument>,
  next: HistoryCheckpoint<DesignDocument>,
  base: DesignDocument,
): HistoryChange | undefined {
  const past = historySplice(before.past, next.past, base),
    future = historySplice(before.future, next.future, base);
  const transaction =
    before.transaction === next.transaction
      ? undefined
      : next.transaction
        ? { value: treeChange(base, next.transaction) ?? null }
        : null;
  if (!past && !future && transaction === undefined) return;
  return {
    ...(past ? { past } : {}),
    ...(future ? { future } : {}),
    ...(transaction === undefined ? {} : { transaction }),
  };
}
function applyHistory(
  before: HistoryCheckpoint<DesignDocument>,
  change: HistoryChange | undefined,
  base: DesignDocument,
): HistoryCheckpoint<DesignDocument> {
  if (!change) return before;
  const splice = (items: DesignDocument[], value: HistorySplice | undefined) => {
    if (!value) return items;
    if (value.start < 0 || value.remove < 0 || value.start + value.remove > items.length)
      throw new Error('履歴差分が不正です。');
    if (value.drop < 0 || value.drop > items.length) throw new Error('履歴差分が不正です。');
    const next = items.slice(value.drop);
    next.splice(value.start, value.remove, ...value.insert.map((delta) => applyTreeChange(base, delta ?? undefined)));
    if (next.length > 100) throw new Error('編集履歴が不正です。');
    return next;
  };
  const transaction =
    change.transaction === undefined
      ? before.transaction
      : change.transaction === null
        ? undefined
        : applyTreeChange(base, change.transaction.value ?? undefined);
  return {
    past: splice(before.past, change.past),
    future: splice(before.future, change.future),
    ...(transaction ? { transaction } : {}),
  };
}
export interface StudioStateDelta {
  base: number;
  sequence: number;
  state?: TreeChange;
  history?: HistoryChange;
  savedFromDocument?: true;
}
export interface StudioStatePayload {
  state?: EditorSnapshot;
  checkpoint?: EditorCheckpoint | PackedCheckpoint;
  sequence?: number;
  delta?: StudioStateDelta;
}

/** One encoder per ordered port. Attach/reconnect gets a base; subsequent traffic is incremental. */
export function createStudioStateEncoder() {
  let previous: EditorSnapshot | undefined,
    checkpoint: EditorCheckpoint | undefined,
    sequence = 0;
  return {
    encode(next: EditorSnapshot, nextCheckpoint: EditorCheckpoint): StudioStatePayload {
      if (!previous || !checkpoint || previous.sessionId !== next.sessionId) {
        previous = next;
        checkpoint = nextCheckpoint;
        return { state: next, checkpoint: packCheckpoint(nextCheckpoint), sequence: ++sequence };
      }
      const savedFromDocument = next.saved !== previous.saved && next.saved === next.document;
      const state = treeChange(previous, savedFromDocument ? { ...next, saved: previous.saved } : next),
        history = changeHistory(checkpoint.history, nextCheckpoint.history, previous.document);
      previous = next;
      checkpoint = nextCheckpoint;
      if (!state && !history && !savedFromDocument) return {};
      return {
        delta: {
          base: sequence,
          sequence: ++sequence,
          ...(state ? { state } : {}),
          ...(history ? { history } : {}),
          ...(savedFromDocument ? { savedFromDocument: true } : {}),
        },
      };
    },
  };
}
export function createStudioStateDecoder() {
  let state: EditorSnapshot | undefined,
    checkpoint: EditorCheckpoint | undefined,
    sequence = 0;
  return {
    accept(payload: StudioStatePayload): { state: EditorSnapshot; checkpoint: EditorCheckpoint } | undefined {
      let next = payload.state,
        history = payload.checkpoint ? unpackCheckpoint(payload.checkpoint)?.history : undefined;
      let nextSequence = payload.sequence;
      if (payload.delta) {
        const delta = payload.delta;
        if (!state || !checkpoint || delta.base !== sequence || delta.sequence !== sequence + 1)
          throw new Error('エディターの差分の順序が一致しません。再接続してください。');
        next = applyTreeChange(state, delta.state);
        if (delta.savedFromDocument) next = { ...next, saved: next.document };
        history = applyHistory(checkpoint.history, delta.history, state.document);
        nextSequence = delta.sequence;
      }
      if (!next) return;
      if (!history || nextSequence === undefined) throw new Error('エディターの初期状態がありません。');
      const nextCheckpoint: EditorCheckpoint = {
        version: 1,
        siteId: next.document.siteId,
        draft: next.document,
        ...(next.saved ? { saved: next.saved } : {}),
        selectedIds: [...next.view.selectedIds],
        ...(next.selectedTarget ? { selectedTarget: next.selectedTarget } : {}),
        tool: next.view.tool ?? 'select',
        snapping: next.view.snapping,
        history,
      };
      state = freezeTree(next);
      checkpoint = freezeTree(nextCheckpoint);
      sequence = nextSequence;
      return { state, checkpoint };
    },
  };
}
