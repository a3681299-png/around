import { TAKE_MESSAGE } from './take-storage';
import { parseSignalTake, takeDuration, TAKE_LIMITS, type SignalTake } from '../world/takes';
import type { TakeSummary } from '../timeline/types';
import { isDesignId } from '../design/schema';
import { TAKE_MESSAGES } from '../assets/limits';
import { oneOf } from '../validation';

const DATABASE = 'web-world-themes-signal-takes';
interface Row {
  id: string;
  chars: number;
  updatedAt: number;
  take: SignalTake;
}
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('テイク保存を使用中です。Studioを再読み込みしてください。'));
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
export function installTakeStorage() {
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
    const result = queue.then(() => handle(value as Record<string, unknown>));
    queue = result.catch(() => undefined);
    void result.then(
      (value) => respond({ ok: true, value }),
      (reason: unknown) =>
        respond({ ok: false, error: reason instanceof Error ? reason.message : 'テイク保存に失敗しました。' }),
    );
    return true;
  });
}
