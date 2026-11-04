import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  LoadingManager,
  Mesh,
  OrthographicCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Material,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createRigPlayer } from './rig-player';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { AnimationClip } from 'three';
import { createVrmPlayer, isVrm, disposeInstanceSkeletons } from './vrm-player';
import { parseVrmAnimation, vrmAnimationClip } from './vrma-clip';
import type { ModelEvaluation } from '../../world/models';
import type { WorldFrame } from '../../world/types';
import { loadAsset } from '../../assets/client';
import { parseVerifiedModelSource, verifiedModelBytes } from '../../assets/verified-source';
import { ASSET_MESSAGES, MODEL_RESOURCE_LIMITS } from '../../assets/limits';
import { inspectGlb } from '../../assets/glb';
import type { Decoration, ModelDecoration } from '../../design/types';
import {
  ASSET_PROFILE,
  assetProfile,
  profileAsync,
  profileSync,
  profileEnd,
  flushAssetProfile,
} from '../../diagnostics/asset-profile';
import { prepareAssetGpu, measureAssetGpuApi, type AssetWarmup } from '../../diagnostics/asset-gpu-preparation';
import type { SharedModelPool, SharedModelLease } from '../../diagnostics/shared-model-pool';

export interface ModelSurface {
  element: HTMLDivElement;
  update(layer: Decoration, visible: boolean): void;
  destroy(): void;
}
interface Resource {
  key: string;
  promise: Promise<GLTF>;
  controller: AbortController;
  shared?: SharedModelLease;
  value?: GLTF;
  refs: number;
  bytes: number;
  disposed: boolean;
  trace?: string;
}
function dispose(gltf: GLTF, shared?: SharedModelLease) {
  const geometries = new Set<Mesh['geometry']>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>(),
    skeletons = new Set<{ dispose(): void }>();
  for (const texture of gltf.userData['wwTextures'] ?? []) if (texture instanceof Texture) textures.add(texture);
  gltf.scenes.forEach((scene) =>
    scene.traverse((node) => {
      const mesh = node as Mesh & { skeleton?: { dispose(): void } };
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      if (mesh.skeleton) skeletons.add(mesh.skeleton);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        materials.add(m);
        Object.values(m).forEach((v: unknown) => {
          if (v instanceof Texture) textures.add(v);
        });
        // MToon exposes textures through uniforms/getters rather than own fields.
        const uniforms = (m as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms;
        for (const uniform of Object.values(uniforms ?? {}))
          if (uniform.value instanceof Texture) textures.add(uniform.value);
      });
    }),
  );
  skeletons.forEach((s) => s.dispose());
  geometries.forEach((g) => {
    if (!shared?.geometries.has(g)) g.dispose();
  });
  materials.forEach((m) => m.dispose());
  const bitmaps = new Set<ImageBitmap>();
  textures.forEach((t) => {
    if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) bitmaps.add(t.source.data);
    t.dispose();
  });
  bitmaps.forEach((b) => {
    if (!shared?.bitmaps.has(b)) b.close();
  });
}
export interface ModelRendererLabOptions {
  warmup?: AssetWarmup;
  warmupPhase?: 'before-player' | 'after-pose';
  shared?: SharedModelPool;
  keepContext?: boolean;
  gpuBreakdown?: boolean;
}

/** One WebGL context; copied surfaces preserve the existing DOM composition/masks. */
export function createModelRenderer(
  doc: Document,
  report: (message: string) => void,
  observe: (stats: Record<string, unknown>) => void,
  parent: ShadowRoot,
  readAsset: typeof loadAsset = loadAsset,
  labOptions?: ModelRendererLabOptions,
  onContextLost?: () => void,
) {
  const options = ASSET_PROFILE ? labOptions : undefined;
  const view = doc.defaultView!,
    cache = new Map<string, Resource>(),
    instances = new Set<Instance>();
  let renderer: WebGLRenderer | undefined,
    idleTimer: number | undefined,
    closed = false,
    lost = false,
    frame: number | undefined,
    budgetBytes = 0;
  let lastPaint = -Infinity,
    paints = 0,
    cpuMs = 0,
    maxCpuMs = 0;
  const cpuSamples: number[] = [],
    paintTimes: number[] = [];
  let calls = 0,
    triangles = 0,
    gpuMs: number | null = null,
    backend = '',
    preparation: Awaited<ReturnType<typeof prepareAssetGpu>> | undefined;
  const queries: WebGLQuery[] = [];
  let gpuApi: ReturnType<typeof measureAssetGpuApi> | undefined,
    firstRenderApi: Record<string, { calls: number; cpuMs: number }> | undefined;
  const programInventory = () =>
    (renderer?.info.programs ?? []).map((p) => ({ id: p.id, name: p.name, cacheKey: p.cacheKey }));
  let preparationPrograms: ReturnType<typeof programInventory> | undefined,
    beforeRenderPrograms: ReturnType<typeof programInventory> | undefined,
    firstRenderPrograms: ReturnType<typeof programInventory> | undefined;
  const stats = () =>
    observe({
      contexts: renderer ? 1 : 0,
      lost,
      assets: cache.size,
      instances: instances.size,
      estimatedGpuAssetBytes: budgetBytes + (options?.shared?.stats().sharedBytes ?? 0),
      ...(options?.shared ? { shared: options.shared.stats() } : {}),
      ...(preparation ? { preparation } : {}),
      surfaceBytes: [...instances].reduce((n, i) => n + i.canvas.width * i.canvas.height * 4, 0),
      paints,
      cpuMs,
      maxCpuMs,
      calls,
      triangles,
      backend,
      fps: paintTimes.length > 1 ? ((paintTimes.length - 1) * 1000) / (paintTimes.at(-1)! - paintTimes[0]!) : 0,
      p95CpuMs: [...cpuSamples].sort((a, b) => a - b)[Math.floor(cpuSamples.length * 0.95)] ?? 0,
      geometries: renderer?.info.memory.geometries ?? 0,
      textures: renderer?.info.memory.textures ?? 0,
      programs: renderer?.info.programs?.length ?? 0,
      gpuMs,
      ...(gpuApi
        ? {
            gpuApi: gpuApi.snapshot(),
            checkShaderErrors: renderer?.debug.checkShaderErrors,
            firstRenderApi,
            programInventory: {
              preparation: preparationPrograms,
              beforeRender: beforeRenderPrograms,
              firstRender: firstRenderPrograms,
            },
          }
        : {}),
    });
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  function cancelIdle() {
    if (idleTimer !== undefined) view.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  const ensure = (trace?: string) => {
    cancelIdle();
    if (renderer) return renderer;
    renderer = profileSync(
      trace,
      'gpu.create-context',
      () => new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true }),
    );
    renderer.domElement.hidden = true;
    renderer.domElement.dataset.wwThreeBackend = '';
    parent.append(renderer.domElement);
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    backend = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (options?.gpuBreakdown) gpuApi = measureAssetGpuApi(gl);
    renderer.setClearColor(new Color(0), 0);
    renderer.setPixelRatio(1);
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    return renderer;
  };
  function onLost(event: Event) {
    event.preventDefault();
    onContextLost?.();
    cancel();
    dropRenderer();
    lost = true;
    instances.forEach((i) => {
      i.element.dataset.playback = 'context-lost';
    });
    stats();
    // The lost context is gone. Existing live instances may upload into a new one.
    lost = false;
    instances.forEach((i) => {
      i.dirty = true;
      i.failed = false;
    });
    schedule();
  }
  const release = (entry: Resource) => {
    if (--entry.refs > 0) return;
    entry.disposed = true;
    entry.controller.abort();
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
    budgetBytes -= entry.bytes;
    entry.bytes = 0;
    if (entry.value) dispose(entry.value, entry.shared);
    entry.shared?.release();
    stats();
  };
  let resourceSerial = 0;
  const acquire = (id: string, vrm: boolean) => {
    const key = vrm ? `${id}:vrm:${++resourceSerial}` : id;
    const found = cache.get(key);
    if (found) {
      found.refs++;
      return found;
    }
    const entry: Resource = {
      key,
      controller: new AbortController(),
      refs: 1,
      bytes: 0,
      disposed: false,
      promise: Promise.resolve(undefined as never),
    };
    cache.set(key, entry);
    const readStart = ASSET_PROFILE ? performance.now() : 0;
    entry.promise = readAsset(id, entry.controller.signal)
      .then(async ({ blob, modelBuffer, metadata }) => {
        const trace = assetProfile(id);
        if (trace) entry.trace = trace;
        profileEnd(trace, 'renderer.source-load', readStart);
        if (!metadata.model) throw new Error('GLB素材が見つかりません。');
        if (entry.disposed || closed) throw new Error('読み込みを中止しました。');
        const bytes = blob
          ? new Uint8Array(
              await profileAsync(trace, 'renderer.blob-read', () => blob.arrayBuffer(), { bytes: blob.size }),
            )
          : undefined;
        if (modelBuffer)
          profileSync(trace, 'renderer.buffer-source', () => undefined, { bytes: modelBuffer.byteLength });
        if (entry.disposed || closed) throw new Error('読み込みを中止しました。');
        const gpuBytes =
          (modelBuffer && verifiedModelBytes(modelBuffer)) ??
          profileSync(trace, 'renderer.inspect', () => inspectGlb(bytes!).gpuBytes);
        if (options?.shared) entry.shared = options.shared.reserve(id, gpuBytes, metadata.model.bones.length * 64);
        const ownBytes = entry.shared?.privateBytes ?? gpuBytes;
        if (budgetBytes + ownBytes + (options?.shared?.stats().sharedBytes ?? 0) > MODEL_RESOURCE_LIMITS.pageGpuBytes)
          throw new Error(ASSET_MESSAGES.pageGpuSize);
        budgetBytes += ownBytes;
        entry.bytes = ownBytes;
        const manager = new LoadingManager();
        manager.setURLModifier((url) => {
          if (!url.startsWith('blob:')) throw new Error('GLBからの外部アクセスを拒否しました。');
          return url;
        });
        const textures = new Set<Texture>();
        let failed = false;
        const releaseTexture = (t: Texture) => {
          t.dispose();
          if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap) t.source.data.close();
        };
        const loader = new GLTFLoader(manager);
        if (metadata.model.vrm)
          loader.register((parser) => {
            const plugin = new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false });
            if (ASSET_PROFILE && trace) {
              const afterRoot = plugin.afterRoot.bind(plugin);
              plugin.afterRoot = (gltf) => profileAsync(trace, 'parse.vrm-after-root', () => afterRoot(gltf));
            }
            return plugin;
          });
        loader.register((parser) => ({
          name: 'WW_LOCAL_TEXTURE_GUARD',
          loadTexture(index: number) {
            return profileAsync(trace, 'parse.texture', () => parser.loadTexture(index), { count: 1 }).then(
              (texture) => {
                if (!texture) throw new Error('GLB内のテクスチャを読み込めません。');
                if (options?.shared) texture.userData['wwTextureIndex'] = index;
                textures.add(texture);
                if (failed || entry.disposed || closed) releaseTexture(texture);
                return texture;
              },
            );
          },
        }));
        let gltf: GLTF;
        try {
          gltf = await profileAsync(trace, 'parse.gltf-inclusive', () =>
            modelBuffer ? parseVerifiedModelSource(modelBuffer, loader) : loader.parseAsync(bytes!.buffer, ''),
          );
        } catch (error) {
          failed = true;
          textures.forEach(releaseTexture);
          throw error;
        }
        gltf.userData['wwTextures'] = [...textures];
        if (entry.disposed || closed) {
          dispose(gltf);
          throw new Error('読み込みを中止しました。');
        }
        if (metadata.model.vrm) {
          const avatar = isVrm(gltf);
          if (!avatar) {
            dispose(gltf);
            throw new Error('VRMのHumanoidを読み込めませんでした。');
          }
          try {
            profileSync(trace, 'parse.vrm-postprocess', () => {
              VRMUtils.removeUnnecessaryVertices(avatar.scene);
              VRMUtils.rotateVRM0(avatar);
            });
          } catch (error) {
            dispose(gltf);
            throw error;
          }
        }
        // glTF permits unnamed nodes. Loader tracks then target source UUIDs,
        // which SkeletonUtils.clone regenerates. Give those targets a local name
        // before cloning; keep binary metadata and author-visible names unchanged.
        const names = new Map<string, string>();
        gltf.scenes.forEach((scene) =>
          scene.traverse((node) => {
            if (!node.name) {
              node.name = `ww-node-${node.uuid}`;
              names.set(node.uuid, node.name);
            }
          }),
        );
        gltf.animations.forEach((clip) =>
          clip.tracks.forEach((track) => {
            const dot = track.name.indexOf('.'),
              name = names.get(track.name.slice(0, dot));
            if (name) track.name = name + track.name.slice(dot);
          }),
        );
        if (entry.shared) {
          try {
            entry.shared.prepare(gltf);
          } catch (error) {
            dispose(gltf, entry.shared);
            throw error;
          }
        }
        entry.value = gltf;
        return gltf;
      })
      .catch((error: unknown) => {
        budgetBytes -= entry.bytes;
        entry.bytes = 0;
        entry.shared?.release();
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      });
    return entry;
  };
  interface Instance {
    element: HTMLDivElement;
    canvas: HTMLCanvasElement;
    scene: Scene;
    camera: OrthographicCamera;
    visual: Group;
    player?: ReturnType<typeof createRigPlayer>;
    vrmPlayer?: ReturnType<typeof createVrmPlayer>;
    inPlace?: boolean;
    evaluation?: ModelEvaluation;
    worldTime?: number;
    root?: Object3D;
    source?: GLTF;
    entry?: Resource;
    layer?: ModelDecoration;
    assetId: string;
    visible: boolean;
    dirty: boolean;
    failed: boolean;
    alive: boolean;
    generation: number;
    profiled?: boolean;
    preparing?: boolean;
    posePrepared?: boolean;
    /** The character motion list the clips below belong to (asset IDs in order). */
    motionKey?: string;
    motionClips?: AnimationClip[] | undefined;
    motionAbort?: AbortController;
    playerMotions?: AnimationClip[] | undefined;
  }
  /** Reads each motion asset, validates it again and turns it into a clip on this VRM. */
  function loadMotions(i: Instance, layer: ModelDecoration, avatar: VRM, key: string) {
    i.motionAbort?.abort();
    const abort = new AbortController();
    i.motionAbort = abort;
    i.motionKey = key;
    i.motionClips = undefined;
    void Promise.all(
      layer.character!.motions.map(async (motion) => {
        const { blob, metadata } = await readAsset(motion.assetId, abort.signal);
        if (!blob || !metadata.vrmAnimation) throw new Error('キャラの動作の素材が見つかりません。');
        const clip = vrmAnimationClip(await parseVrmAnimation(new Uint8Array(await blob.arrayBuffer())), avatar);
        clip.name = motion.id;
        return clip;
      }),
    )
      .then((clips) => {
        if (abort.signal.aborted || !i.alive || i.motionKey !== key) return;
        i.motionClips = clips;
        i.dirty = true;
        schedule();
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || !i.alive) return;
        report(error instanceof Error ? error.message : 'キャラの動作を読み込めません。');
      });
  }
  const cancel = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
  };
  function schedule() {
    if (
      !closed &&
      !lost &&
      !doc.hidden &&
      frame === undefined &&
      [...instances].some((i) => i.visible && i.root && i.dirty && !i.failed && !i.preparing)
    )
      frame = view.requestAnimationFrame(paint);
  }
  function paint(time: number) {
    frame = undefined;
    if (closed || lost || doc.hidden) return;
    if (time - lastPaint < 1000 / 30 - 0.5) {
      schedule();
      return;
    }
    lastPaint = time;
    const before = view.performance.now();
    calls = triangles = 0;
    let attemptedGpu = false;
    let gpu: { gl: WebGL2RenderingContext; target: number; query: WebGLQuery } | undefined;
    for (const i of instances) {
      if (!i.alive || !i.visible || !i.root || !i.dirty || i.failed || i.preparing || !i.layer) continue;
      try {
        const trace = ASSET_PROFILE && !i.profiled ? i.entry?.trace : undefined;
        const firstStart = trace ? performance.now() : 0;
        const r = ensure(trace),
          p = i.layer.placement,
          scale = Math.min(1.5, 1024 / Math.max(p.widthPx, p.heightPx));
        const budgetScale = Math.min(scale, Math.sqrt((512 * 1024) / (p.widthPx * p.heightPx)));
        const w = Math.max(1, Math.round(p.widthPx * budgetScale)),
          h = Math.max(1, Math.round(p.heightPx * budgetScale));
        if (w !== i.canvas.width || h !== i.canvas.height) {
          i.canvas.width = w;
          i.canvas.height = h;
        }
        if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
        const gl = r.getContext() as WebGL2RenderingContext,
          timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
            TIME_ELAPSED_EXT: number;
            GPU_DISJOINT_EXT: number;
          } | null;
        if (timer && !attemptedGpu) {
          attemptedGpu = true;
          while (queries.length && gl.getQueryParameter(queries[0]!, gl.QUERY_RESULT_AVAILABLE)) {
            const q = queries.shift()!;
            if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
              gpuMs = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
            gl.deleteQuery(q);
          }
          if (queries.length < 3) {
            const q = gl.createQuery();
            if (q) {
              gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
              gpu = { gl, target: timer.TIME_ELAPSED_EXT, query: q };
            }
          }
        }
        const aspect = w / h;
        i.camera.left = -aspect * 0.75;
        i.camera.right = aspect * 0.75;
        i.camera.top = 0.75;
        i.camera.bottom = -0.75;
        i.camera.updateProjectionMatrix();
        const m = i.layer.model;
        i.visual.rotation.set(
          (m.rotationX * Math.PI) / 180,
          ((m.rotationY + (i.evaluation?.yawDeg ?? 0) + (m.locomotion.faceMovement ? m.locomotion.forwardDeg : 0)) *
            Math.PI) /
            180,
          (m.rotationZ * Math.PI) / 180,
        );
        const avatar = isVrm(i.source!);
        const playerStart = trace ? performance.now() : 0;
        // A character plays its .vrma motions; they load once per motion list, then the player
        // is rebuilt on them. Until they arrive the model holds its rest pose.
        const motionKey = avatar && i.layer.character ? i.layer.character.motions.map((x) => x.assetId).join() : '';
        if (motionKey && i.motionKey !== motionKey) loadMotions(i, i.layer, avatar!, motionKey);
        const motions = motionKey && i.motionKey === motionKey ? i.motionClips : undefined;
        if (i.inPlace !== m.inPlace || (!i.player && !i.vrmPlayer) || i.playerMotions !== motions) {
          i.player?.destroy();
          i.vrmPlayer?.destroy();
          if (avatar) i.vrmPlayer = createVrmPlayer(i.source!, avatar, m.inPlace, motions);
          else i.player = createRigPlayer(i.source!, i.root, m.inPlace);
          i.inPlace = m.inPlace;
          i.playerMotions = motions;
        }
        if (ASSET_PROFILE && trace) profileEnd(trace, 'first.player-create', playerStart);
        if (i.evaluation) {
          if (i.vrmPlayer)
            i.element.dataset.vrmPose = JSON.stringify(i.vrmPlayer.paint(i.evaluation, m, i.worldTime ?? 0));
          else i.player?.paint(i.evaluation, m);
        }
        if (options?.warmupPhase === 'after-pose' && options.warmup && options.warmup !== 'none' && !i.posePrepared) {
          i.preparing = true;
          const generation = i.generation;
          // The microtask starts after this paint's optional GPU query has ended.
          // This experiment remains profiling-only; normal scheduling is unchanged.
          void Promise.resolve()
            .then(async () => {
              if (!i.alive || closed || generation !== i.generation) return;
              preparation = await prepareAssetGpu(r, i.scene, i.camera, options.warmup!);
              if (!i.alive || closed || generation !== i.generation) return;
              preparationPrograms = programInventory();
              i.posePrepared = true;
            })
            .catch((error: unknown) => {
              if (i.alive && generation === i.generation) {
                i.failed = true;
                report(error instanceof Error ? error.message : 'シェーダーを準備できませんでした。');
              }
            })
            .finally(() => {
              i.preparing = false;
              schedule();
            });
          continue;
        }
        if (trace && gpuApi) beforeRenderPrograms = programInventory();
        const beforeApi = trace && gpuApi?.snapshot();
        if (ASSET_PROFILE && trace)
          profileSync(trace, 'first.webgl-render-inclusive', () => r.render(i.scene, i.camera));
        else r.render(i.scene, i.camera);
        if (trace && gpuApi) firstRenderPrograms = programInventory();
        if (beforeApi && gpuApi)
          firstRenderApi = Object.fromEntries(
            Object.entries(gpuApi.snapshot()).map(([name, value]) => [
              name,
              { calls: value.calls - beforeApi[name]!.calls, cpuMs: value.cpuMs - beforeApi[name]!.cpuMs },
            ]),
          );
        calls += r.info.render.calls;
        triangles += r.info.render.triangles;
        const context = i.canvas.getContext('2d');
        if (!context) throw new Error('3D描画用キャンバスを確保できませんでした。');
        if (ASSET_PROFILE && trace)
          profileSync(trace, 'first.canvas-copy', () => {
            context.clearRect(0, 0, w, h);
            context.drawImage(r.domElement, 0, 0);
          });
        else {
          context.clearRect(0, 0, w, h);
          context.drawImage(r.domElement, 0, 0);
        }
        i.dirty = false;
        i.element.dataset.playback = reduced.matches
          ? 'reduced-motion'
          : i.layer.model.playing && i.evaluation?.clip !== null
            ? 'playing'
            : 'paused';
        if (i.evaluation) {
          i.element.dataset.modelFrame = JSON.stringify(i.evaluation);
        }
        i.element.dataset.renderer = 'three';
        i.element.style.visibility = 'visible';
        paints++;
        if (ASSET_PROFILE && trace) {
          const generation = i.generation;
          i.profiled = true;
          profileEnd(trace, 'first.paint-inclusive', firstStart);
          view.requestAnimationFrame(() =>
            view.requestAnimationFrame(() => {
              if (!i.alive || closed || generation !== i.generation) return;
              profileEnd(trace, 'first.presentation-proxy-inclusive', firstStart);
              i.element.dataset.profileReady = trace;
              void flushAssetProfile();
            }),
          );
        }
      } catch (error) {
        i.dirty = false;
        i.failed = true;
        i.element.dataset.playback = 'error';
        report(error instanceof Error ? error.message : 'WebGLを利用できません。');
      }
    }
    if (gpu && !gpu.gl.isContextLost()) {
      gpu.gl.endQuery(gpu.target);
      queries.push(gpu.query);
    }
    paintTimes.push(time);
    if (paintTimes.length > 120) paintTimes.shift();
    cpuMs = view.performance.now() - before;
    cpuSamples.push(cpuMs);
    if (cpuSamples.length > 120) cpuSamples.shift();
    maxCpuMs = Math.max(maxCpuMs, cpuMs);
    stats();
    schedule();
  }
  const dropRenderer = () => {
    cancelIdle();
    if (!renderer) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    queries.splice(0).forEach((q) => gl.deleteQuery(q));
    renderer.domElement.removeEventListener('webglcontextlost', onLost);
    gpuApi?.restore();
    gpuApi = undefined;
    firstRenderApi = undefined;
    renderer.domElement.remove();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = undefined;
    lost = false;
    gpuMs = null;
  };
  const retireRenderer = () => {
    cancelIdle();
    if (!renderer) return;
    // Release render-list references immediately; only the empty context is retained.
    renderer.renderLists.dispose();
    if (closed || doc.hidden || lost) {
      dropRenderer();
    } else if (!options?.keepContext) {
      idleTimer = view.setTimeout(() => {
        idleTimer = undefined;
        if (!instances.size) {
          dropRenderer();
          stats();
        }
      }, 30_000);
    }
  };
  const visibility = () => {
    cancel();
    if (doc.hidden) {
      dropRenderer();
      stats();
    } else {
      instances.forEach((i) => {
        i.dirty = true;
        i.failed = false;
      });
      schedule();
    }
  };
  doc.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', visibility);
  return {
    resetObservations() {
      cpuSamples.length = paintTimes.length = 0;
      paints = 0;
      cpuMs = maxCpuMs = calls = triangles = 0;
      gpuMs = null;
      stats();
    },
    evaluate(world: WorldFrame) {
      const frames = new Map(world.models?.map((f) => [f.id, f]));
      for (const i of instances) {
        const value = i.layer && frames.get(i.layer.id);
        if (
          value &&
          (JSON.stringify(value) !== JSON.stringify(i.evaluation) ||
            (i.layer?.source.vrm && i.layer.model.playing && !value.suspended && i.worldTime !== world.timeMs))
        ) {
          i.evaluation = value;
          i.dirty = true;
        }
        i.worldTime = world.timeMs;
      }
      schedule();
    },
    attach(parent: HTMLElement): ModelSurface {
      cancelIdle();
      const element = doc.createElement('div');
      element.className = 'media model-media';
      element.dataset.format = 'glb';
      element.style.visibility = 'hidden';
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = 1;
      element.append(canvas);
      parent.append(element);
      const scene = new Scene(),
        camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
      camera.position.set(0, 0, 4);
      const light = new DirectionalLight(0xffffff, 2.5);
      light.position.set(2, 4, 5);
      scene.add(new AmbientLight(0xffffff, 2), light);
      const visual = new Group();
      scene.add(visual);
      const i: Instance = {
        element,
        canvas,
        scene,
        camera,
        visual,
        assetId: '',
        visible: false,
        dirty: false,
        failed: false,
        alive: true,
        generation: 0,
      };
      instances.add(i);
      const unload = () => {
        i.posePrepared = false;
        if (ASSET_PROFILE) delete element.dataset.profileReady;
        i.generation++;
        delete i.profiled;
        i.player?.destroy();
        i.vrmPlayer?.destroy();
        delete i.player;
        delete i.vrmPlayer;
        i.motionAbort?.abort();
        delete i.motionKey;
        delete i.motionClips;
        delete i.playerMotions;
        if (i.root) {
          if (!i.source || !isVrm(i.source)) disposeInstanceSkeletons(i.root);
          i.visual.clear();
          delete i.root;
        }
        if (i.entry) release(i.entry);
        delete i.entry;
        delete i.source;
      };
      return {
        element,
        update(next, visible) {
          if (!i.alive || next.kind !== 'model3d') return;
          if (i.failed && visible && !i.visible) {
            unload();
            i.assetId = '';
          }
          const changed =
            !i.layer ||
            JSON.stringify(i.layer.model) !== JSON.stringify(next.model) ||
            i.layer.placement.widthPx !== next.placement.widthPx ||
            i.layer.placement.heightPx !== next.placement.heightPx;
          i.layer = next;
          i.dirty ||= changed || (visible && !i.visible);
          i.visible = visible;
          if (!visible && canvas.width > 1) {
            canvas.width = canvas.height = 1;
            stats();
          }
          if (i.assetId !== next.assetId) {
            unload();
            i.failed = false;
            i.assetId = next.assetId;
            const generation = i.generation;
            i.element.dataset.playback = 'loading';
            i.element.dataset.format = next.source.format;
            const entry = acquire(next.assetId, Boolean(next.source.vrm));
            i.entry = entry;
            void entry.promise
              .then(async (gltf) => {
                if (!i.alive || generation !== i.generation) return;
                i.source = gltf;
                const root = isVrm(gltf) ? gltf.scene : clone(gltf.scene);
                i.root = root;
                const bounds = profileSync(entry.trace, 'renderer.bounds', () => new Box3().setFromObject(root)),
                  size = bounds.getSize(new Vector3()),
                  center = bounds.getCenter(new Vector3());
                const edge = Math.max(size.x, size.y, size.z);
                if (!Number.isFinite(edge) || edge < 1e-8) throw new Error('GLBに表示できるメッシュがありません。');
                const normal = new Group();
                normal.scale.setScalar(1 / edge);
                normal.position.copy(center).multiplyScalar(-1 / edge);
                normal.add(root);
                i.visual.add(normal);
                if (
                  options?.warmupPhase !== 'after-pose' &&
                  ((options?.warmup && options.warmup !== 'none') || options?.shared)
                ) {
                  i.preparing = true;
                  try {
                    const r = ensure(entry.trace);
                    for (const texture of options?.shared?.anchors() ?? []) r.initTexture(texture);
                    preparation = await prepareAssetGpu(r, i.scene, i.camera, options?.warmup ?? 'none');
                    if (options?.gpuBreakdown) preparationPrograms = programInventory();
                  } finally {
                    i.preparing = false;
                  }
                  if (!i.alive || generation !== i.generation || closed) return;
                }
                i.dirty = true;
                schedule();
              })
              .catch((error: unknown) => {
                if (i.alive && generation === i.generation) {
                  i.failed = true;
                  i.element.dataset.playback = 'error';
                  report(error instanceof Error ? error.message : '3D素材を表示できません。');
                }
              });
          }
          schedule();
        },
        destroy() {
          if (!i.alive) return;
          i.alive = false;
          unload();
          instances.delete(i);
          canvas.width = canvas.height = 1;
          element.remove();
          if (!instances.size) {
            cancel();
            retireRenderer();
          }
          stats();
        },
      };
    },
    destroy() {
      if (closed) return;
      closed = true;
      cancel();
      doc.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', visibility);
      dropRenderer();
      stats();
    },
  };
}
