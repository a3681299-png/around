import { ASSET_LIMITS } from './validation';

interface Transfer { owner: string; bytes: Uint8Array; offset: number; touched: number; name: string; mime: string }
/** Bounded, ordered uploads. A worker restart simply cancels unfinished transfers. */
export function createAssetTransfers() {
  const entries = new Map<string, Transfer>();
  const get = (id: unknown, owner: string, now: number) => {
    for (const [key, value] of entries) if (now - value.touched > 60000) entries.delete(key);
    const entry = typeof id === 'string' ? entries.get(id) : undefined;
    if (!entry || entry.owner !== owner) throw new Error('素材転送が中断されました。もう一度追加してください。');
    entry.touched = now; return entry;
  };
  return {
    start(id: string, owner: string, size: unknown, name: unknown, mime: unknown, now: number) {
      for (const [key, value] of entries) if (now - value.touched > 60000 || value.owner === owner) entries.delete(key);
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > ASSET_LIMITS.modelBytes || typeof name !== 'string' || !name.length || name.length > 120 || /[\u0000-\u001f]/.test(name) || typeof mime !== 'string' || mime.length > 120) throw new Error('素材転送の形式が不正です。');
      if (entries.size >= 4 || [...entries.values()].reduce((n, e) => n + e.bytes.length, size) > ASSET_LIMITS.modelBytes * 2) throw new Error('素材転送の容量予算を超えています。読み込み完了後に追加してください。');
      entries.set(id, { owner, bytes: new Uint8Array(size), offset: 0, touched: now, name, mime }); return id;
    },
    append(id: unknown, owner: string, offset: unknown, bytes: Uint8Array, now: number) {
      const entry = get(id, owner, now);
      if (offset !== entry.offset || !bytes.length || bytes.length > ASSET_LIMITS.chunkBytes || bytes.length + entry.offset > entry.bytes.length) throw new Error('素材転送の順序・容量が不正です。');
      entry.bytes.set(bytes, entry.offset); entry.offset += bytes.length;
    },
    finish(id: unknown, owner: string, now: number) { const e = get(id, owner, now); if (e.offset !== e.bytes.length) throw new Error('素材の転送が未完了です。'); entries.delete(id as string); return e; },
    abort(id: unknown, owner: string, now: number) { get(id, owner, now); entries.delete(id as string); },
  };
}
