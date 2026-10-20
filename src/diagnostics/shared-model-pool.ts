import { Mesh, Texture, type BufferGeometry, type Material } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
export const SHARED_MODEL_VERSION = 'three0.186.1-vrm3.5.5-vertices1';

export interface SharedModelLease {
  privateBytes: number;
  geometries: Set<BufferGeometry>;
  bitmaps: Set<ImageBitmap>;
  prepare(gltf: GLTF): void;
  release(): void;
}

/** Experimental only. Materials, Texture transforms and VRM components stay private. */
export function createSharedModelPool(maxBytes = 224 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid shared resource budget');
  interface Entry { refs: number; bytes: number; used: number; geometries: Set<BufferGeometry>; slots: Map<number, BufferGeometry>; sources: Map<number, Texture['source']>; bitmaps: Set<ImageBitmap>; anchors: Map<string, Texture> }
  const entries = new Map<string, Entry>(); let bytes = 0, tick = 0;
  function evict(id: string, e: Entry) {
    if (e.refs) throw new Error('Cannot evict a live resource');
    entries.delete(id); bytes -= e.bytes; e.geometries.forEach((g) => g.dispose()); e.anchors.forEach((t) => t.dispose()); e.bitmaps.forEach((b) => b.close());
  }
  const texturesOf = (gltf: GLTF) => {
    const textures = new Set<Texture>(gltf.userData['wwTextures'] ?? []);
    gltf.scene.traverse((n) => { if (!(n instanceof Mesh)) return; for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
      for (const v of Object.values((m as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms ?? {})) if (v.value instanceof Texture) textures.add(v.value);
    } }); return textures;
  };
  return {
    reserve(id: string, estimatedBytes: number, privateBytes: number): SharedModelLease {
      if (!Number.isSafeInteger(estimatedBytes) || !Number.isSafeInteger(privateBytes) || privateBytes < 0 || estimatedBytes <= 0 || privateBytes > estimatedBytes) throw new Error('Invalid resource estimate');
      id += ':' + SHARED_MODEL_VERSION;
      let e = entries.get(id); const sharedBytes = Math.max(0, estimatedBytes - privateBytes);
      if (!e) {
        for (const [key, item] of [...entries].sort((a, b) => a[1].used - b[1].used)) if (!item.refs && bytes + sharedBytes > maxBytes) evict(key, item);
        if (bytes + sharedBytes > maxBytes) throw new Error('Shared model budget exceeded');
        e = { refs: 0, bytes: sharedBytes, used: ++tick, geometries: new Set(), slots: new Map(), sources: new Map(), bitmaps: new Set(), anchors: new Map() }; entries.set(id, e); bytes += sharedBytes;
      }
      e.refs++; e.used = ++tick; const entry = e; let released = false;
      return {
        privateBytes, geometries: entry.geometries, bitmaps: entry.bitmaps,
        prepare(gltf) {
          if (released) throw new Error('Shared lease released');
          let slot = 0; const originals = new Map<BufferGeometry, BufferGeometry>();
          gltf.scene.traverse((node) => {
            if (!(node instanceof Mesh)) return;
            const original: BufferGeometry = node.geometry, mapped = originals.get(original);
            if (mapped) { node.geometry = mapped; return; }
            let geometry = entry.slots.get(slot);
            if (!geometry) { geometry = original; entry.slots.set(slot, geometry); entry.geometries.add(geometry); }
            else if (original !== geometry) original.dispose();
            originals.set(original, geometry); node.geometry = geometry; slot++;
          });
          const replaced = new Set<ImageBitmap>();
          for (const t of texturesOf(gltf)) {
            const index = t.userData['wwTextureIndex']; if (!Number.isSafeInteger(index)) continue;
            const found = entry.sources.get(index);
            if (found) { if (t.source !== found && typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) replaced.add(t.source.data); t.source = found; }
            else { entry.sources.set(index, t.source); if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) entry.bitmaps.add(t.source.data); }
            // Keep a private, unused anchor Texture for each GPU sampler configuration.
            const key = [index, t.colorSpace, t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.flipY, t.anisotropy, t.premultiplyAlpha, t.unpackAlignment, t.format, t.type].join(':');
            if (!entry.anchors.has(key)) entry.anchors.set(key, t.clone());
          }
          for (const b of replaced) if (!entry.bitmaps.has(b)) b.close();
        },
        release() { if (released) return; released = true; entry.refs--; entry.used = ++tick; if (!entry.refs && !entry.slots.size && !entry.sources.size) evict(id, entry); },
      };
    },
    anchors: () => [...entries.values()].flatMap((e) => [...e.anchors.values()]),
    stats: () => ({ sharedBytes: bytes, sharedAssets: entries.size, refs: [...entries.values()].reduce((n, e) => n + e.refs, 0), sharedGeometries: [...entries.values()].reduce((n, e) => n + e.geometries.size, 0), textureSources: [...entries.values()].reduce((n, e) => n + e.sources.size, 0) }),
    clear() { for (const [id, e] of entries) { if (e.refs) throw new Error('Release instances before clearing the pool'); evict(id, e); } },
  };
}
export type SharedModelPool = ReturnType<typeof createSharedModelPool>;
