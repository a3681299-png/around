import { test, expect } from '@playwright/test';
import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createSharedModelPool } from '../src/diagnostics/shared-model-pool';

function fixture() {
  const geometry = new BoxGeometry(), texture = new Texture(); texture.userData['wwTextureIndex'] = 0;
  geometry.morphAttributes['position'] = [geometry.attributes['position']!.clone()];
  const material = new MeshBasicMaterial({ map: texture }), mesh = new Mesh(geometry, material), scene = new Scene(); scene.add(mesh);
  const gltf = { scene, scenes: [scene], animations: [], asset: { version: '2.0' }, userData: { wwTextures: [texture] } } as unknown as GLTF;
  return { gltf, mesh, geometry, texture, material };
}
test('shared resources preserve private material/texture transforms and morph influences', () => {
  const pool = createSharedModelPool(1000), a = fixture(), b = fixture();
  const first = pool.reserve('hash-a', 100, 10), second = pool.reserve('hash-a', 100, 10); first.prepare(a.gltf); second.prepare(b.gltf);
  expect(a.mesh.geometry).toBe(b.mesh.geometry); expect(a.texture.source).toBe(b.texture.source); expect(a.texture).not.toBe(b.texture); expect(a.material).not.toBe(b.material);
  a.texture.offset.x = .5; expect(b.texture.offset.x).toBe(0); a.mesh.morphTargetInfluences![0] = .8; expect(b.mesh.morphTargetInfluences![0]).toBe(0);
  expect(pool.stats().sharedBytes).toBe(90); expect(pool.stats().refs).toBe(2);
  first.release(); first.release(); expect(pool.stats().refs).toBe(1); expect(() => pool.clear()).toThrow('Release instances');
  second.release(); pool.clear(); expect(pool.stats().sharedBytes).toBe(0);
});
test('byte budget evicts unused LRU assets and never an active resource', () => {
  const pool = createSharedModelPool(100), a = fixture(), b = fixture(); let disposed = 0; a.geometry.addEventListener('dispose', () => { disposed++; });
  const first = pool.reserve('hash-a', 100, 10); first.prepare(a.gltf);
  expect(() => pool.reserve('hash-b', 100, 10)).toThrow('budget'); first.release();
  const second = pool.reserve('hash-b', 100, 10); second.prepare(b.gltf); expect(disposed).toBe(1); expect(pool.stats().sharedAssets).toBe(1);
  second.release(); pool.clear();
});
