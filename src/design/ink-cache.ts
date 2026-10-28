import { INK, type Ink } from './contrast';
import { SKIN_STATES, type DesignDocument } from './types';

/** Per mode, per part and per slot: white or black. Never part of the artwork. */
export type CachedInks = {
  readonly [mode in 'light' | 'dark']?: { readonly [target: string]: { readonly [slot: string]: Ink } };
};
/** Last legibility result per design signature, kept by the browser so the next page load can
 * paint readable text before the live check has run. At most a handful of entries. */
export type InkCache = { readonly [key: string]: CachedInks };

export const INK_CACHE_LIMIT = 4;
const SLOTS: readonly string[] = [...SKIN_STATES, 'compact'];
const TARGET = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[0-9a-f]{8}$/;
const INKS: readonly unknown[] = Object.values(INK);

/** Identifies the parts of a design that the ink decision depends on (art, slices, author colour). */
export function inkDesignKey(design: DesignDocument): string {
  const text = JSON.stringify(design.rules.map((rule) => [rule.target, rule.skin, rule.style.backgroundColor]));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Reads stored data defensively: anything unexpected is dropped; only the two engine colours pass. */
export function parseInkCache(value: unknown): InkCache {
  const out: Record<string, CachedInks> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, plan] of Object.entries(value).slice(0, INK_CACHE_LIMIT)) {
    if (!KEY.test(key) || !plan || typeof plan !== 'object' || Array.isArray(plan)) continue;
    const entry: { -readonly [mode in 'light' | 'dark']?: Record<string, Record<string, Ink>> } = {};
    for (const mode of ['light', 'dark'] as const) {
      const targets = (plan as Record<string, unknown>)[mode];
      if (!targets || typeof targets !== 'object' || Array.isArray(targets)) continue;
      const clean: Record<string, Record<string, Ink>> = {};
      for (const [target, slots] of Object.entries(targets).slice(0, 32)) {
        if (!TARGET.test(target) || !slots || typeof slots !== 'object' || Array.isArray(slots)) continue;
        const kept: Record<string, Ink> = {};
        for (const [slot, ink] of Object.entries(slots))
          if (SLOTS.includes(slot) && INKS.includes(ink)) kept[slot] = ink as Ink;
        if (Object.keys(kept).length) clean[target] = kept;
      }
      entry[mode] = clean;
    }
    out[key] = entry;
  }
  return out;
}

/** Adds one entry, newest last, dropping the oldest beyond the limit. */
export function withInkEntry(cache: InkCache, key: string, plan: CachedInks): InkCache {
  const { [key]: _old, ...rest } = cache;
  const keys = Object.keys(rest).slice(-(INK_CACHE_LIMIT - 1));
  return { ...Object.fromEntries(keys.map((name) => [name, rest[name]!])), [key]: plan };
}
