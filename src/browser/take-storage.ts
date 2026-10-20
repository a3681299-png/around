import type { TakeStorage, TakeSummary } from '../timeline/types';
import { parseSignalTake, type SignalTake } from '../world/takes';

export const TAKE_MESSAGE = 'web-world-themes:signal-takes';
/** Extension storage boundary; no IndexedDB or Chrome calls enter the Studio UI. */
export function createTakeStorage(siteId: string): TakeStorage {
  const request = async <T>(action: string, extra: Record<string, unknown> = {}): Promise<T> => {
    const response = (await chrome.runtime.sendMessage({ type: TAKE_MESSAGE, action, siteId, ...extra })) as {
      ok?: boolean;
      value?: T;
      error?: string;
    };
    if (!response?.ok) throw new Error(response?.error ?? 'テイクの保存に失敗しました。');
    return response.value as T;
  };
  return {
    list: () => request<TakeSummary[]>('list'),
    get: async (id) => parseSignalTake(await request<SignalTake>('get', { id })),
    put: (take) => request<void>('put', { take: parseSignalTake(take) }),
    remove: (id) => request<void>('delete', { id }),
  };
}
