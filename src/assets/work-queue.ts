/** Bounded scheduling; reads use their own queue and mutations remain serial. */
export function createWorkQueue(concurrency: number, capacity = 64) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid queue concurrency');
  let active = 0;
  const pending: (() => void)[] = [];
  function drain() { while (active < concurrency && pending.length) pending.shift()!(); }
  return {
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (pending.length >= capacity) return Promise.reject(new Error('素材の要求が多すぎます。読み込み完了後に再試行してください。'));
      return new Promise<T>((resolve, reject) => {
        const abort = () => { const index = pending.indexOf(start); if (index >= 0) { pending.splice(index, 1); reject(signal?.reason); } };
        const start = () => {
          signal?.removeEventListener('abort', abort);
          if (signal?.aborted) { reject(signal.reason); return; }
          active++;
          Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain(); });
        };
        signal?.addEventListener('abort', abort, { once: true }); pending.push(start); drain();
      });
    },
    stats: () => ({ active, pending: pending.length }),
  };
}
