import type { TakeStorage, TakeSummary } from './types';
import { takeDuration, type SignalTake } from '../world/takes';

/** Takes kept only for this page's lifetime: a host without extension storage (the Playground). */
export function createMemoryTakeStorage(): TakeStorage {
  const takes = new Map<string, SignalTake>();
  return {
    async list(): Promise<TakeSummary[]> {
      return [...takes.values()].reverse().map((take) => ({
        id: take.id,
        siteId: take.siteId,
        name: take.name,
        durationMs: takeDuration(take),
        samples: take.inputs.length,
      }));
    },
    async get(id) {
      const take = takes.get(id);
      if (!take) throw new Error('テイクが見つかりません。');
      return take;
    },
    async put(take) {
      takes.delete(take.id);
      takes.set(take.id, take);
    },
    async remove(id) {
      takes.delete(id);
    },
  };
}
