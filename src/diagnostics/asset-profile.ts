/** Opt-in, bounded development measurements. Never persisted with a work. */
declare const __WW_ASSET_PROFILE__: boolean;
export const ASSET_PROFILE = typeof __WW_ASSET_PROFILE__ !== 'undefined' && __WW_ASSET_PROFILE__;
export const PROFILE_MESSAGE = 'ww.asset-profile.v1';
export interface AssetSpan {
  id: string; context: string; contextInstance: string; name: string; startMs: number; durationMs: number;
  bytes?: number; wireChars?: number; count?: number;
}
const spans: AssetSpan[] = [], links = new Map<string, string>();
const context = typeof document === 'undefined' ? 'worker' : location.protocol === 'chrome-extension:' ? 'extension' : 'content';
const contextInstance = ASSET_PROFILE ? crypto.randomUUID() : '';
export const validProfile = (id: unknown): id is string => typeof id === 'string' && /^ap-[a-zA-Z0-9-]{1,64}$/.test(id);
export const newAssetProfile = () => ASSET_PROFILE ? 'ap-' + crypto.randomUUID() : undefined;
export const assetProfile = (asset: string) => ASSET_PROFILE ? links.get(asset) : undefined;
export function linkAssetProfile(asset: string, id: string | undefined) {
  if (!ASSET_PROFILE || !id) return;
  if (links.size >= 128) links.delete(links.keys().next().value!);
  links.set(asset, id);
}
export function profileEnd(id: string | undefined, name: string, start: number, extra: Pick<AssetSpan, 'bytes' | 'wireChars' | 'count'> = {}) {
  if (!ASSET_PROFILE || !id || name.length > 100) return;
  if (spans.length >= 8192) spans.shift();
  spans.push({ id, context, contextInstance, name, startMs: start, durationMs: performance.now() - start, ...extra });
}
export function profileSync<T>(id: string | undefined, name: string, action: () => T, extra?: Pick<AssetSpan, 'bytes' | 'wireChars' | 'count'>): T {
  if (!ASSET_PROFILE || !id) return action();
  const start = performance.now(); try { return action(); } finally { profileEnd(id, name, start, extra); }
}
export async function profileAsync<T>(id: string | undefined, name: string, action: () => Promise<T>, extra?: Pick<AssetSpan, 'bytes' | 'wireChars' | 'count'>): Promise<T> {
  if (!ASSET_PROFILE || !id) return action();
  const start = performance.now(); try { return await action(); } finally { profileEnd(id, name, start, extra); }
}
export function profileSnapshot() { return ASSET_PROFILE ? spans.map((span) => ({ ...span })) : []; }
export function profileClear() { spans.length = 0; links.clear(); }
export function profileIngest(input: unknown) {
  if (!ASSET_PROFILE || !Array.isArray(input) || input.length > 8192) return;
  for (const raw of input) {
    if (!raw || !validProfile(raw.id) || !['worker', 'extension', 'content'].includes(raw.context) || typeof raw.contextInstance !== 'string' || !/^[a-f0-9-]{36}$/.test(raw.contextInstance) || typeof raw.name !== 'string' || raw.name.length > 100
      || !Number.isFinite(raw.startMs) || !Number.isFinite(raw.durationMs) || raw.durationMs < 0) continue;
    if (spans.length >= 8192) spans.shift();
    spans.push({ id: raw.id, context: raw.context, contextInstance: raw.contextInstance, name: raw.name, startMs: raw.startMs, durationMs: raw.durationMs,
      ...Object.fromEntries(['bytes', 'wireChars', 'count'].flatMap((key) => Number.isFinite(raw[key]) && raw[key] >= 0 ? [[key, raw[key]]] : [])) });
  }
}
/** Batch after measured work, not one IPC message per span or per frame. */
export async function flushAssetProfile() {
  if (!ASSET_PROFILE || context === 'worker' || !spans.length) return;
  const batch = spans.splice(0);
  await chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'ingest', spans: batch }).catch(() => undefined);
}
