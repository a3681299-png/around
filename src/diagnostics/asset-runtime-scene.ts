import { createModelRenderer, type ModelSurface } from '../renderers/three/models';
import { defaultModelSettings } from '../models/types';
import type { ModelDecoration } from '../design/types';
import type { AssetMetadata } from '../assets/validation';
import type { loadAsset } from '../assets/client';
import {
  newAssetProfile,
  linkAssetProfile,
  profileEnd,
  flushAssetProfile,
  profileSnapshot,
  PROFILE_MESSAGE,
} from './asset-profile';
import { createSharedModelPool } from './shared-model-pool';
import type { AssetWarmup } from './asset-gpu-preparation';

/** Uses the existing DOM/Three renderer; no second model renderer implementation. */
export function createAssetLabScene(parent: HTMLElement, read: typeof loadAsset) {
  const host = parent.ownerDocument.createElement('div'),
    shadow = host.attachShadow({ mode: 'open' });
  parent.append(host);
  let renderer: ReturnType<typeof createModelRenderer> | undefined,
    surfaces: ModelSurface[] = [],
    error = '',
    stats: Record<string, unknown> = {},
    epoch = 0;
  const pool = createSharedModelPool();
  let shared = false,
    warmup: AssetWarmup = 'none';
  let layers: ModelDecoration[] = [],
    animation: number | undefined;
  function clear(force = false) {
    epoch++;
    if (animation !== undefined) cancelAnimationFrame(animation);
    animation = undefined;
    for (const s of surfaces) s.destroy();
    surfaces = [];
    layers = [];
    if (force || !shared) {
      renderer?.destroy();
      renderer = undefined;
      pool.clear();
      stats = { contexts: 0, instances: 0, estimatedGpuAssetBytes: 0 };
    }
    for (const child of [...shadow.children]) if (!child.hasAttribute('data-ww-three-backend')) child.remove();
  }
  function configure(settings: { shared?: boolean; warmup?: AssetWarmup }) {
    const nextShared = settings.shared === true,
      nextWarmup = settings.warmup ?? 'none';
    if (!['none', 'textures', 'compile', 'both'].includes(nextWarmup)) throw new Error('Invalid GPU preparation mode');
    if (nextShared !== shared || nextWarmup !== warmup) {
      clear(true);
      shared = nextShared;
      warmup = nextWarmup;
    }
  }
  const api = {
    async show(metadata: AssetMetadata, count = 1, profileId?: string, many?: AssetMetadata[]) {
      clear();
      if (!metadata.model || !Number.isInteger(count) || count < 1 || count > 5) throw new Error('Invalid model count');
      const current = epoch,
        started = performance.now(),
        trace = profileId ?? newAssetProfile()!;
      linkAssetProfile(metadata.id, trace);
      error = '';
      renderer ??= createModelRenderer(
        parent.ownerDocument,
        (message) => {
          error = message;
        },
        (value) => {
          stats = value;
        },
        shadow,
        read,
        { warmup, ...(shared ? { shared: pool, keepContext: true } : {}) },
      );
      for (let n = 0; n < count; n++) {
        const asset = many?.[n] ?? metadata;
        if (!asset.model) throw new Error('Not a model');
        linkAssetProfile(asset.id, trace);
        const layer: ModelDecoration = {
          id: 'image-lab-' + n,
          name: 'lab',
          kind: 'model3d',
          assetId: asset.id,
          source: asset.model,
          model: defaultModelSettings(asset.model),
          placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 0 },
          opacity: 1,
          zIndex: n,
          visible: true,
          locked: false,
        };
        const root = parent.ownerDocument.createElement('div');
        root.style.cssText = `position:absolute;left:${20 + n * 130}px;top:30px;width:200px;height:200px;pointer-events:none`;
        shadow.append(root);
        const s = renderer.attach(root);
        surfaces.push(s);
        layers.push(layer);
        s.update(layer, true);
      }
      renderer.evaluate({
        timeMs: 0,
        layout: { layers: [], groups: [], roots: [] },
        effects: [],
        machine: { video: 'paused', events: [] },
        needsFrame: false,
        subscriptions: { pointer: false, video: false },
        models: [],
      });
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 120000;
        const check = () => {
          if (current !== epoch) reject(new Error('Cancelled'));
          else if (error) reject(new Error(error));
          else if (surfaces.every((s) => Boolean(s.element.dataset.profileReady))) resolve();
          else if (performance.now() > deadline) reject(new Error('Render timeout'));
          else requestAnimationFrame(check);
        };
        check();
      });
      let alphaPixels = 0;
      for (const surface of surfaces) {
        const c = surface.element.querySelector('canvas')!,
          p = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        for (let n = 3; n < p.length; n += 4) if (p[n]) alphaPixels++;
      }
      profileEnd(trace, 'lab.source-to-display', started);
      const local = profileSnapshot();
      await flushAssetProfile();
      const logs =
        location.protocol === 'chrome-extension:'
          ? await chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'snapshot' })
          : { spans: local };
      return { totalMs: performance.now() - started, trace, alphaPixels, stats, ...logs };
    },
    configure,
    resetObservations() {
      renderer?.resetObservations();
    },
    async showMany(metadata: AssetMetadata[]) {
      if (!metadata.length || metadata.length > 5) throw new Error('Invalid model count');
      return api.show(metadata[0]!, metadata.length, undefined, metadata);
    },
    pose(index: number, happy: number) {
      const existing = layers[index];
      if (!existing?.model.vrm || !Number.isFinite(happy) || happy < 0 || happy > 1)
        throw new Error('Invalid instance');
      const layer = structuredClone(existing);
      layer.model.vrm!.expressions['happy'] = happy;
      layers[index] = layer;
      surfaces[index]!.update(layer, true);
      api.animate(false, 0);
    },
    animate(enabled: boolean, timeMs = 0) {
      if (animation !== undefined) cancelAnimationFrame(animation);
      animation = undefined;
      const tick = (time: number) => {
        renderer?.evaluate({
          timeMs: time,
          layout: { layers: [], groups: [], roots: [] },
          effects: [],
          machine: { video: 'playing', events: [] },
          needsFrame: enabled,
          subscriptions: { pointer: false, video: false },
          models: layers.map((layer, n) => ({
            id: layer.id,
            clip: layer.model.clip,
            timeMs: time,
            previousClip: null,
            previousTimeMs: 0,
            fadeElapsedMs: 0,
            fadeDurationMs: 0,
            yawDeg: 0,
            lookYaw: Math.sin(time / 500 + n) * 25,
            lookPitch: 0,
            suspended: false,
            phase: 'manual',
            blend: 1,
            speedPx: 0,
          })),
        });
        if (enabled && !document.hidden) animation = requestAnimationFrame(tick);
      };
      tick(timeMs);
    },
    add2D(count: number) {
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('2D budget');
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#bd7cda';
      ctx.fillRect(4, 4, 24, 24);
      const url = c.toDataURL();
      for (let n = 0; n < count; n++) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = `position:absolute;left:${(n % 5) * 65}px;top:${260 + Math.floor(n / 5) * 32}px;width:32px;height:32px;pointer-events:none`;
        img.dataset.lab2d = '';
        shadow.append(img);
      }
    },
    clear,
    destroy() {
      clear(true);
      host.remove();
    },
    stats: () => ({ ...stats, shared: pool.stats() }),
  };
  return api;
}
