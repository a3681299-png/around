import { TAKE_MESSAGE } from './take-storage';
import { parseSignalTake, takeDuration, TAKE_LIMITS, type SignalTake } from '../world/takes';
import type { TakeSummary } from '../timeline/types';
import { isDesignId } from '../design/schema';
import { TAKE_MESSAGES } from '../assets/limits';
import { oneOf } from '../validation';
import { sameBackupData } from '../backup/data';

export const TAKE_DATABASE = 'web-world-themes-signal-takes';
interface Row {
  id: string;
  chars: number;
  updatedAt: number;
  take: SignalTake;
}
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TAKE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('テイク保存を使用中です。エディターを再読み込みしてください。'));
  });
}
async function handle(data: Record<string, unknown>) {
  if (
    !isDesignId(data['siteId']) ||
    !oneOf(data['action'], ['list', 'get', 'put', 'delete']) ||
    Object.keys(data).some((key) => !['type', 'action', 'siteId', 'id', 'take'].includes(key))
  )
    throw new Error('テイク操作が不正です。');
  if (oneOf(data['action'], ['get', 'delete']) && !isDesignId(data['id'])) throw new Error('テイクのIDが不正です。');
  const incoming = data['action'] === 'put' ? parseSignalTake(data['take']) : undefined;
  if (incoming && incoming.siteId !== data['siteId']) throw new Error('保存先サイトが一致しません。');
  const db = await open();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('takes', oneOf(data['action'], ['put', 'delete']) ? 'readwrite' : 'readonly'),
        store = tx.objectStore('takes'),
        request = store.getAll();
      let result: unknown, failure: unknown;
      request.onsuccess = () => {
        try {
          const rows = request.result as Row[],
            own = rows.filter((row) => row.take.siteId === data['siteId']);
          if (data['action'] === 'list')
            result = own
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((row): TakeSummary => ({
                id: row.id,
                siteId: row.take.siteId,
                name: row.take.name,
                durationMs: takeDuration(row.take),
                samples: row.take.inputs.length,
              }));
          else if (data['action'] === 'get') {
            const row = own.find((row) => row.id === data['id']);
            if (!row) throw new Error('テイクが見つかりません。');
            result = parseSignalTake(row.take);
          } else if (data['action'] === 'delete') {
            if (own.some((row) => row.id === data['id'])) store.delete(data['id'] as string);
          } else if (incoming) {
            const chars = JSON.stringify(incoming).length,
              retained = rows.filter((row) => row.id !== incoming.id);
            if (
              retained.length >= TAKE_LIMITS.storedCount ||
              retained.reduce((sum, row) => sum + row.chars, 0) + chars > TAKE_LIMITS.storedChars
            )
              throw new Error(TAKE_MESSAGES.storage);
            store.put({ id: incoming.id, take: incoming, chars, updatedAt: Date.now() } satisfies Row);
          }
        } catch (reason) {
          failure = reason;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('テイク保存に失敗しました。'));
      tx.onerror = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
}
/** Backup uses the same database and parser as the ordinary take repository. */
export async function readStoredTakes(): Promise<SignalTake[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('takes').objectStore('takes').getAll();
      request.onsuccess = () => {
        try {
          resolve((request.result as Row[]).map((row) => parseSignalTake(row.take)));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function validateTakeMerge(current: readonly SignalTake[], incoming: readonly SignalTake[]): SignalTake[] {
  const result = new Map(current.map((take) => [take.id, take]));
  for (const take of incoming) {
    const existing = result.get(take.id);
    if (existing && !sameBackupData(existing, take)) throw new Error(`テイクIDが衝突しています: ${take.id}`);
    result.set(take.id, take);
  }
  const takes = [...result.values()];
  if (
    takes.length > TAKE_LIMITS.storedCount ||
    takes.reduce((sum, take) => sum + JSON.stringify(take).length, 0) > TAKE_LIMITS.storedChars
  )
    throw new Error(TAKE_MESSAGES.storage);
  return takes;
}

export async function restoreTakes(incoming: readonly SignalTake[]): Promise<void> {
  const parsed = incoming.map((take) => parseSignalTake(take)),
    db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('takes', 'readwrite'),
        store = tx.objectStore('takes'),
        request = store.getAll();
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const rows = request.result as Row[];
          validateTakeMerge(
            rows.map((row) => parseSignalTake(row.take)),
            parsed,
          );
          for (const take of parsed)
            if (!rows.some((row) => row.id === take.id))
              store.add({ id: take.id, take, chars: JSON.stringify(take).length, updatedAt: Date.now() } satisfies Row);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('テイクを復元できませんでした。'));
    });
  } finally {
    db.close();
  }
}

export function installTakeStorage(serialize?: <T>(operation: () => Promise<T>) => Promise<T>) {
  let queue: Promise<unknown> = Promise.resolve();
  chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      value.type !== TAKE_MESSAGE
    )
      return false;
    if (
      !sender.url?.startsWith(chrome.runtime.getURL('')) &&
      !(sender.origin === 'https://www.youtube.com' && sender.frameId === 0)
    )
      return false;
    const result = serialize
      ? serialize(() => handle(value as Record<string, unknown>))
      : queue.then(() => handle(value as Record<string, unknown>));
    queue = result.catch(() => undefined);
    void result.then(
      (value) => respond({ ok: true, value }),
      (reason: unknown) =>
        respond({ ok: false, error: reason instanceof Error ? reason.message : 'テイク保存に失敗しました。' }),
    );
    return true;
  });
}
