import { AmbientLight, Box3, Color, DirectionalLight, Group, LoadingManager, Mesh, OrthographicCamera, Scene, Texture, Vector3, WebGLRenderer, type Object3D, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadAsset } from '../../assets/client';
import { inspectGlb } from '../../assets/glb';
import type { Decoration, ModelDecoration } from '../../design/types';

export interface ModelSurface { element: HTMLDivElement; update(layer: Decoration, visible: boolean): void; destroy(): void }
interface Resource { promise: Promise<GLTF>; value?: GLTF; refs: number; bytes: number; disposed: boolean }
function dispose(gltf: GLTF) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>(), skeletons = new Set<{ dispose(): void }>();
  gltf.scenes.forEach((scene) => scene.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: { dispose(): void } }; if (!mesh.isMesh) return; geometries.add(mesh.geometry); if (mesh.skeleton) skeletons.add(mesh.skeleton);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => { materials.add(m); Object.values(m).forEach((v: unknown) => { if (v instanceof Texture) textures.add(v); }); });
  }));
  skeletons.forEach((s) => s.dispose()); geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
  const bitmaps = new Set<ImageBitmap>(); textures.forEach((t) => { if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) bitmaps.add(t.source.data); t.dispose(); }); bitmaps.forEach((b) => b.close());
}

/** One WebGL context; copied surfaces preserve the existing DOM composition/masks. */
export function createModelRenderer(doc: Document, report: (message: string) => void, observe: (stats: Record<string, unknown>) => void) {
  const view = doc.defaultView!, cache = new Map<string, Resource>(), instances = new Set<Instance>();
  let renderer: WebGLRenderer | undefined, closed = false, lost = false, frame: number | undefined, textureBytes = 0;
  let lastPaint = -Infinity, paints = 0, cpuMs = 0, maxCpuMs = 0;
  const stats = () => observe({ contexts: renderer ? 1 : 0, lost, assets: cache.size, instances: instances.size, textureBytes,
    surfaceBytes: [...instances].reduce((n, i) => n + i.canvas.width * i.canvas.height * 4, 0), paints, cpuMs, maxCpuMs,
    calls: renderer?.info.render.calls ?? 0, geometries: renderer?.info.memory.geometries ?? 0, textures: renderer?.info.memory.textures ?? 0, gpuMs: null });
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const ensure = () => {
    if (renderer) return renderer;
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true });
    renderer.setClearColor(new Color(0), 0); renderer.setPixelRatio(1);
    renderer.domElement.addEventListener('webglcontextlost', onLost); renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    return renderer;
  };
  function onLost(event: Event) { event.preventDefault(); lost = true; cancel(); instances.forEach((i) => { i.element.dataset.playback = 'context-lost'; }); stats(); }
  function onRestored() { lost = false; instances.forEach((i) => { i.dirty = true; }); schedule(); }
  const release = (id: string, entry: Resource) => {
    if (--entry.refs > 0) return; entry.disposed = true; if (cache.get(id) === entry) cache.delete(id); textureBytes -= entry.bytes;
    if (entry.value) dispose(entry.value); stats();
  };
  const acquire = (id: string) => {
    const found = cache.get(id); if (found) { found.refs++; return found; }
    const entry: Resource = { refs: 1, bytes: 0, disposed: false, promise: Promise.resolve(undefined as never) }; cache.set(id, entry);
    entry.promise = loadAsset(id).then(async ({ blob, metadata }) => {
      if (!metadata.model) throw new Error('GLB素材が見つかりません。');
      if (entry.disposed || closed) throw new Error('読み込みを中止しました。');
      const bytes = new Uint8Array(await blob.arrayBuffer()); inspectGlb(bytes);
      if (textureBytes + metadata.model.textureBytes > 128 * 1024 * 1024) throw new Error('3Dテクスチャ予算128MiBを超えました。ほかのモデルを削除してください。');
      textureBytes += metadata.model.textureBytes; entry.bytes = metadata.model.textureBytes;
      const manager = new LoadingManager(); manager.setURLModifier((url) => { if (!url.startsWith('blob:')) throw new Error('GLBからの外部アクセスを拒否しました。'); return url; });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, '');
      if (entry.disposed || closed) { dispose(gltf); throw new Error('読み込みを中止しました。'); }
      entry.value = gltf; return gltf;
    }); return entry;
  };
  interface Instance {
    element: HTMLDivElement; canvas: HTMLCanvasElement; scene: Scene; camera: OrthographicCamera; visual: Group;
    root?: Object3D; source?: GLTF; entry?: Resource; layer?: ModelDecoration; assetId: string; visible: boolean; dirty: boolean; alive: boolean; generation: number;
  }
  const cancel = () => { if (frame !== undefined) view.cancelAnimationFrame(frame); frame = undefined; };
  function schedule() { if (!closed && !lost && !doc.hidden && frame === undefined && [...instances].some((i) => i.visible && i.root && i.dirty)) frame = view.requestAnimationFrame(paint); }
  function paint(time: number) {
    frame = undefined; if (closed || lost || doc.hidden) return;
    if (time - lastPaint < 1000 / 30) { schedule(); return; } lastPaint = time;
    const before = view.performance.now();
    for (const i of instances) {
      if (!i.alive || !i.visible || !i.root || !i.dirty || !i.layer) continue;
      try {
        const r = ensure(), p = i.layer.placement, scale = Math.min(1.5, 1024 / Math.max(p.widthPx, p.heightPx));
        const w = Math.max(1, Math.round(p.widthPx * scale)), h = Math.max(1, Math.round(p.heightPx * scale));
        if (w !== i.canvas.width || h !== i.canvas.height) { i.canvas.width = w; i.canvas.height = h; }
        r.setSize(w, h, false); const aspect = w / h;
        i.camera.left = -aspect * .75; i.camera.right = aspect * .75; i.camera.top = .75; i.camera.bottom = -.75; i.camera.updateProjectionMatrix();
        const m = i.layer.model; i.visual.rotation.set(m.rotationX * Math.PI / 180, m.rotationY * Math.PI / 180, m.rotationZ * Math.PI / 180);
        r.render(i.scene, i.camera);
        const context = i.canvas.getContext('2d'); if (!context) throw new Error('3D描画用キャンバスを確保できませんでした。');
        context.clearRect(0, 0, w, h); context.drawImage(r.domElement, 0, 0); i.dirty = false;
        i.element.dataset.playback = 'still'; i.element.dataset.renderer = 'three'; i.element.style.visibility = 'visible'; paints++;
      } catch (error) { i.dirty = false; i.element.dataset.playback = 'error'; report(error instanceof Error ? error.message : 'WebGLを利用できません。'); }
    }
    cpuMs = view.performance.now() - before; maxCpuMs = Math.max(maxCpuMs, cpuMs); stats(); schedule();
  }
  const visibility = () => { cancel(); if (!doc.hidden) { instances.forEach((i) => { i.dirty = true; }); schedule(); } };
  doc.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', visibility);
  return {
    attach(parent: HTMLElement): ModelSurface {
      const element = doc.createElement('div'); element.className = 'media model-media'; element.dataset.format = 'glb'; element.style.visibility = 'hidden';
      const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1; element.append(canvas); parent.append(element);
      const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100); camera.position.set(0, 0, 4);
      const light = new DirectionalLight(0xffffff, 2.5); light.position.set(2, 4, 5); scene.add(new AmbientLight(0xffffff, 2), light);
      const visual = new Group(); scene.add(visual);
      const i: Instance = { element, canvas, scene, camera, visual, assetId: '', visible: false, dirty: false, alive: true, generation: 0 }; instances.add(i);
      const unload = () => {
        i.generation++; if (i.root) { i.root.traverse((o) => { const s = (o as Object3D & { skeleton?: { dispose(): void } }).skeleton; s?.dispose(); }); i.visual.clear(); delete i.root; }
        if (i.entry) release(i.assetId, i.entry); delete i.entry; delete i.source;
      };
      return { element,
        update(next, visible) {
          if (!i.alive || next.kind !== 'model3d') return;
          const changed = !i.layer || JSON.stringify(i.layer.model) !== JSON.stringify(next.model) || i.layer.placement.widthPx !== next.placement.widthPx || i.layer.placement.heightPx !== next.placement.heightPx;
          i.layer = next; i.dirty ||= changed || visible && !i.visible; i.visible = visible;
          if (i.assetId !== next.assetId) {
            unload(); i.assetId = next.assetId; const generation = i.generation; i.element.dataset.playback = 'loading';
            const entry = acquire(next.assetId); i.entry = entry;
            void entry.promise.then((gltf) => {
              if (!i.alive || generation !== i.generation) return;
              i.source = gltf; const root = clone(gltf.scene); i.root = root;
              const bounds = new Box3().setFromObject(root), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
              const edge = Math.max(size.x, size.y, size.z); if (!Number.isFinite(edge) || edge < 1e-8) throw new Error('GLBに表示できるメッシュがありません。');
              const normal = new Group(); normal.scale.setScalar(1 / edge); normal.position.copy(center).multiplyScalar(-1 / edge); normal.add(root); i.visual.add(normal);
              i.dirty = true; schedule();
            }).catch((error: unknown) => { if (i.alive && generation === i.generation) { i.element.dataset.playback = 'error'; report(error instanceof Error ? error.message : '3D素材を表示できません。'); } });
          }
          schedule();
        },
        destroy() { if (!i.alive) return; i.alive = false; unload(); instances.delete(i); canvas.width = canvas.height = 1; element.remove(); if (!instances.size) cancel(); stats(); },
      };
    },
    destroy() {
      if (closed) return; closed = true; cancel(); doc.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility);
      if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', onLost); renderer.domElement.removeEventListener('webglcontextrestored', onRestored); renderer.dispose(); renderer.forceContextLoss(); renderer = undefined; }
      stats();
    },
  };
}
