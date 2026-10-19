import { AmbientLight, Box3, Color, DirectionalLight, Group, LoadingManager, Mesh, OrthographicCamera, Scene, Texture, Vector3, WebGLRenderer, type Object3D, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createRigPlayer } from './rig-player';
import type { ModelEvaluation } from '../../world/models';
import type { WorldFrame } from '../../world/types';
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
export function createModelRenderer(doc: Document, report: (message: string) => void, observe: (stats: Record<string, unknown>) => void, parent: ShadowRoot) {
  const view = doc.defaultView!, cache = new Map<string, Resource>(), instances = new Set<Instance>();
  let renderer: WebGLRenderer | undefined, closed = false, lost = false, frame: number | undefined, budgetBytes = 0;
  let lastPaint = -Infinity, paints = 0, cpuMs = 0, maxCpuMs = 0;
  const cpuSamples: number[] = [], paintTimes: number[] = [];
  let calls = 0, triangles = 0, gpuMs: number | null = null, backend = '';
  const queries: WebGLQuery[] = [];
  const stats = () => observe({ contexts: renderer ? 1 : 0, lost, assets: cache.size, instances: instances.size, estimatedGpuAssetBytes: budgetBytes,
    surfaceBytes: [...instances].reduce((n, i) => n + i.canvas.width * i.canvas.height * 4, 0), paints, cpuMs, maxCpuMs,
    calls, triangles, backend, fps: paintTimes.length > 1 ? (paintTimes.length - 1) * 1000 / (paintTimes.at(-1)! - paintTimes[0]!) : 0,
    p95CpuMs: [...cpuSamples].sort((a, b) => a - b)[Math.floor(cpuSamples.length * .95)] ?? 0, geometries: renderer?.info.memory.geometries ?? 0, textures: renderer?.info.memory.textures ?? 0, gpuMs });
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const ensure = () => {
    if (renderer) return renderer;
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true });
    renderer.domElement.hidden = true; renderer.domElement.dataset.wwThreeBackend = ''; parent.append(renderer.domElement);
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info'); backend = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    renderer.setClearColor(new Color(0), 0); renderer.setPixelRatio(1);
    renderer.domElement.addEventListener('webglcontextlost', onLost); renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    return renderer;
  };
  function onLost(event: Event) { event.preventDefault(); lost = true; queries.length = 0; gpuMs = null; cancel(); instances.forEach((i) => { i.element.dataset.playback = 'context-lost'; }); stats(); }
  function onRestored() { lost = false; instances.forEach((i) => { i.dirty = true; i.failed = false; }); schedule(); }
  const release = (id: string, entry: Resource) => {
    if (--entry.refs > 0) return; entry.disposed = true; if (cache.get(id) === entry) cache.delete(id); budgetBytes -= entry.bytes; entry.bytes = 0;
    if (entry.value) dispose(entry.value); stats();
  };
  const acquire = (id: string) => {
    const found = cache.get(id); if (found) { found.refs++; return found; }
    const entry: Resource = { refs: 1, bytes: 0, disposed: false, promise: Promise.resolve(undefined as never) }; cache.set(id, entry);
    entry.promise = loadAsset(id).then(async ({ blob, metadata }) => {
      if (!metadata.model) throw new Error('GLB素材が見つかりません。');
      if (entry.disposed || closed) throw new Error('読み込みを中止しました。');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (entry.disposed || closed) throw new Error('読み込みを中止しました。'); const { gpuBytes } = inspectGlb(bytes);
      if (budgetBytes + gpuBytes > 128 * 1024 * 1024) throw new Error('3D描画資源の予算128MiBを超えました。ほかのモデルを削除してください。');
      budgetBytes += gpuBytes; entry.bytes = gpuBytes;
      const manager = new LoadingManager(); manager.setURLModifier((url) => { if (!url.startsWith('blob:')) throw new Error('GLBからの外部アクセスを拒否しました。'); return url; });
      const textures = new Set<Texture>(); let failed = false;
      const releaseTexture = (t: Texture) => { t.dispose(); if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) t.source.data.close(); };
      const loader = new GLTFLoader(manager);
      loader.register((parser) => ({ name: 'WW_LOCAL_TEXTURE_GUARD', loadTexture(index: number) { return parser.loadTexture(index).then((texture) => { if (!texture) throw new Error('GLB内のテクスチャを読み込めません。'); textures.add(texture); if (failed || entry.disposed || closed) releaseTexture(texture); return texture; }); } }));
      let gltf: GLTF;
      try { gltf = await loader.parseAsync(bytes.buffer, ''); }
      catch (error) { failed = true; textures.forEach(releaseTexture); throw error; }
      if (entry.disposed || closed) { dispose(gltf); throw new Error('読み込みを中止しました。'); }
      // glTF permits unnamed nodes. Loader tracks then target source UUIDs,
      // which SkeletonUtils.clone regenerates. Give those targets a local name
      // before cloning; keep binary metadata and author-visible names unchanged.
      const names = new Map<string, string>();
      gltf.scenes.forEach((scene) => scene.traverse((node) => { if (!node.name) { node.name = `ww-node-${node.uuid}`; names.set(node.uuid, node.name); } }));
      gltf.animations.forEach((clip) => clip.tracks.forEach((track) => { const dot = track.name.indexOf('.'), name = names.get(track.name.slice(0, dot)); if (name) track.name = name + track.name.slice(dot); }));
      entry.value = gltf; return gltf;
    }).catch((error: unknown) => { budgetBytes -= entry.bytes; entry.bytes = 0; if (cache.get(id) === entry) cache.delete(id); throw error; }); return entry;
  };
  interface Instance {
    element: HTMLDivElement; canvas: HTMLCanvasElement; scene: Scene; camera: OrthographicCamera; visual: Group;
    player?: ReturnType<typeof createRigPlayer>; inPlace?: boolean; evaluation?: ModelEvaluation;
    root?: Object3D; source?: GLTF; entry?: Resource; layer?: ModelDecoration; assetId: string; visible: boolean; dirty: boolean; failed: boolean; alive: boolean; generation: number;
  }
  const cancel = () => { if (frame !== undefined) view.cancelAnimationFrame(frame); frame = undefined; };
  function schedule() { if (!closed && !lost && !doc.hidden && frame === undefined && [...instances].some((i) => i.visible && i.root && i.dirty && !i.failed)) frame = view.requestAnimationFrame(paint); }
  function paint(time: number) {
    frame = undefined; if (closed || lost || doc.hidden) return;
    if (time - lastPaint < 1000 / 30 - .5) { schedule(); return; } lastPaint = time;
    const before = view.performance.now(); calls = triangles = 0;
    let attemptedGpu = false;
    let gpu: { gl: WebGL2RenderingContext; target: number; query: WebGLQuery } | undefined;
    for (const i of instances) {
      if (!i.alive || !i.visible || !i.root || !i.dirty || i.failed || !i.layer) continue;
      try {
        const r = ensure(), p = i.layer.placement, scale = Math.min(1.5, 1024 / Math.max(p.widthPx, p.heightPx));
        const budgetScale = Math.min(scale, Math.sqrt(512 * 1024 / (p.widthPx * p.heightPx)));
        const w = Math.max(1, Math.round(p.widthPx * budgetScale)), h = Math.max(1, Math.round(p.heightPx * budgetScale));
        if (w !== i.canvas.width || h !== i.canvas.height) { i.canvas.width = w; i.canvas.height = h; }
        if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
        const gl = r.getContext() as WebGL2RenderingContext, timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
        if (timer && !attemptedGpu) {
          attemptedGpu = true;
          while (queries.length && gl.getQueryParameter(queries[0]!, gl.QUERY_RESULT_AVAILABLE)) { const q = queries.shift()!; if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6; gl.deleteQuery(q); }
          if (queries.length < 3) { const q = gl.createQuery(); if (q) { gl.beginQuery(timer.TIME_ELAPSED_EXT, q); gpu = { gl, target: timer.TIME_ELAPSED_EXT, query: q }; } }
        } const aspect = w / h;
        i.camera.left = -aspect * .75; i.camera.right = aspect * .75; i.camera.top = .75; i.camera.bottom = -.75; i.camera.updateProjectionMatrix();
        const m = i.layer.model; i.visual.rotation.set(m.rotationX * Math.PI / 180, (m.rotationY + (i.evaluation?.yawDeg ?? 0) + (m.locomotion.faceMovement ? m.locomotion.forwardDeg : 0)) * Math.PI / 180, m.rotationZ * Math.PI / 180);
        if (i.inPlace !== m.inPlace || !i.player) { i.player?.destroy(); i.player = createRigPlayer(i.source!, i.root, m.inPlace); i.inPlace = m.inPlace; }
        if (i.evaluation) i.player.paint(i.evaluation, m);
        r.render(i.scene, i.camera); calls += r.info.render.calls; triangles += r.info.render.triangles;
        const context = i.canvas.getContext('2d'); if (!context) throw new Error('3D描画用キャンバスを確保できませんでした。');
        context.clearRect(0, 0, w, h); context.drawImage(r.domElement, 0, 0); i.dirty = false;
        i.element.dataset.playback = reduced.matches ? 'reduced-motion' : i.layer.model.playing && i.evaluation?.clip !== null ? 'playing' : 'paused';
        if (i.evaluation) { i.element.dataset.modelFrame = JSON.stringify(i.evaluation); } i.element.dataset.renderer = 'three'; i.element.style.visibility = 'visible'; paints++;
      } catch (error) { i.dirty = false; i.failed = true; i.element.dataset.playback = 'error'; report(error instanceof Error ? error.message : 'WebGLを利用できません。'); }
    }
    if (gpu && !gpu.gl.isContextLost()) { gpu.gl.endQuery(gpu.target); queries.push(gpu.query); }
    paintTimes.push(time); if (paintTimes.length > 120) paintTimes.shift();
    cpuMs = view.performance.now() - before; cpuSamples.push(cpuMs); if (cpuSamples.length > 120) cpuSamples.shift(); maxCpuMs = Math.max(maxCpuMs, cpuMs); stats(); schedule();
  }
  const dropRenderer = () => {
    if (!renderer) return; const gl = renderer.getContext() as WebGL2RenderingContext; queries.splice(0).forEach((q) => gl.deleteQuery(q));
    renderer.domElement.removeEventListener('webglcontextlost', onLost); renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
    renderer.domElement.remove(); renderer.dispose(); renderer.forceContextLoss(); renderer = undefined; lost = false; gpuMs = null;
  };
  const visibility = () => { cancel(); if (!doc.hidden) { instances.forEach((i) => { i.dirty = true; i.failed = false; }); schedule(); } };
  doc.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', visibility);
  return {
    evaluate(world: WorldFrame) {
      const frames = new Map(world.models?.map((f) => [f.id, f]));
      for (const i of instances) { const value = i.layer && frames.get(i.layer.id); if (value && JSON.stringify(value) !== JSON.stringify(i.evaluation)) { i.evaluation = value; i.dirty = true; } }
      schedule();
    },
    attach(parent: HTMLElement): ModelSurface {
      const element = doc.createElement('div'); element.className = 'media model-media'; element.dataset.format = 'glb'; element.style.visibility = 'hidden';
      const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1; element.append(canvas); parent.append(element);
      const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100); camera.position.set(0, 0, 4);
      const light = new DirectionalLight(0xffffff, 2.5); light.position.set(2, 4, 5); scene.add(new AmbientLight(0xffffff, 2), light);
      const visual = new Group(); scene.add(visual);
      const i: Instance = { element, canvas, scene, camera, visual, assetId: '', visible: false, dirty: false, failed: false, alive: true, generation: 0 }; instances.add(i);
      const unload = () => {
        i.generation++; i.player?.destroy(); delete i.player; if (i.root) { i.root.traverse((o) => { const s = (o as Object3D & { skeleton?: { dispose(): void } }).skeleton; s?.dispose(); }); i.visual.clear(); delete i.root; }
        if (i.entry) release(i.assetId, i.entry); delete i.entry; delete i.source;
      };
      return { element,
        update(next, visible) {
          if (!i.alive || next.kind !== 'model3d') return;
          if (i.failed && visible && !i.visible) { unload(); i.assetId = ''; }
          const changed = !i.layer || JSON.stringify(i.layer.model) !== JSON.stringify(next.model) || i.layer.placement.widthPx !== next.placement.widthPx || i.layer.placement.heightPx !== next.placement.heightPx;
          i.layer = next; i.dirty ||= changed || visible && !i.visible; i.visible = visible; if (!visible && canvas.width > 1) { canvas.width = canvas.height = 1; stats(); }
          if (i.assetId !== next.assetId) {
            unload(); i.failed = false; i.assetId = next.assetId; const generation = i.generation; i.element.dataset.playback = 'loading';
            const entry = acquire(next.assetId); i.entry = entry;
            void entry.promise.then((gltf) => {
              if (!i.alive || generation !== i.generation) return;
              i.source = gltf; const root = clone(gltf.scene); i.root = root;
              const bounds = new Box3().setFromObject(root), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
              const edge = Math.max(size.x, size.y, size.z); if (!Number.isFinite(edge) || edge < 1e-8) throw new Error('GLBに表示できるメッシュがありません。');
              const normal = new Group(); normal.scale.setScalar(1 / edge); normal.position.copy(center).multiplyScalar(-1 / edge); normal.add(root); i.visual.add(normal);
              i.dirty = true; schedule();
            }).catch((error: unknown) => { if (i.alive && generation === i.generation) { i.failed = true; i.element.dataset.playback = 'error'; report(error instanceof Error ? error.message : '3D素材を表示できません。'); } });
          }
          schedule();
        },
        destroy() { if (!i.alive) return; i.alive = false; unload(); instances.delete(i); canvas.width = canvas.height = 1; element.remove(); if (!instances.size) { cancel(); dropRenderer(); } stats(); },
      };
    },
    destroy() {
      if (closed) return; closed = true; cancel(); doc.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility);
      dropRenderer();
      stats();
    },
  };
}
