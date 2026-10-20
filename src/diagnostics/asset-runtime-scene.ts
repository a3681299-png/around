import { createModelRenderer, type ModelSurface } from '../renderers/three/models';
import { defaultModelSettings } from '../models/types';
import type { ModelDecoration } from '../design/types';
import type { AssetMetadata } from '../assets/validation';
import type { loadAsset } from '../assets/client';
import { newAssetProfile, linkAssetProfile, profileEnd, flushAssetProfile, profileSnapshot, PROFILE_MESSAGE } from './asset-profile';

/** Uses the existing DOM/Three renderer; no second model renderer implementation. */
export function createAssetLabScene(parent: HTMLElement, read: typeof loadAsset) {
  const host = parent.ownerDocument.createElement('div'), shadow = host.attachShadow({ mode: 'open' }); parent.append(host);
  let renderer: ReturnType<typeof createModelRenderer> | undefined, surfaces: ModelSurface[] = [], error = '', stats: Record<string, unknown> = {}, epoch = 0;
  function clear() { epoch++; for (const s of surfaces) s.destroy(); surfaces = []; renderer?.destroy(); renderer = undefined; shadow.replaceChildren(); }
  return {
    async show(metadata: AssetMetadata, count = 1, profileId?: string) {
      clear(); if (!metadata.model || !Number.isInteger(count) || count < 1 || count > 5) throw new Error('Invalid model count');
      const current = epoch, started = performance.now(), trace = profileId ?? newAssetProfile()!; linkAssetProfile(metadata.id, trace); error = '';
      renderer = createModelRenderer(parent.ownerDocument, (message) => { error = message; }, (value) => { stats = value; }, shadow, read);
      for (let n = 0; n < count; n++) {
        const layer: ModelDecoration = { id: 'image-lab-' + n, name: 'lab', kind: 'model3d', assetId: metadata.id, source: metadata.model, model: defaultModelSettings(metadata.model),
          placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 0 }, opacity: 1, zIndex: n, visible: true, locked: false };
        const root = parent.ownerDocument.createElement('div'); root.style.cssText = `position:absolute;left:${20 + n * 130}px;top:30px;width:200px;height:200px;pointer-events:none`; shadow.append(root);
        const s = renderer.attach(root); surfaces.push(s); s.update(layer, true);
      }
      renderer.evaluate({ timeMs: 0, layout: { layers: [], groups: [], roots: [] }, effects: [], machine: { video: 'paused', events: [] }, needsFrame: false, subscriptions: { pointer: false, video: false }, models: [] });
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 120000;
        const check = () => { if (current !== epoch) reject(new Error('Cancelled')); else if (error) reject(new Error(error)); else if (surfaces.every((s) => Boolean(s.element.dataset.profileReady))) resolve(); else if (performance.now() > deadline) reject(new Error('Render timeout')); else requestAnimationFrame(check); }; check();
      });
      let alphaPixels = 0;
      for (const surface of surfaces) { const c = surface.element.querySelector('canvas')!, p = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; for (let n = 3; n < p.length; n += 4) if (p[n]) alphaPixels++; }
      profileEnd(trace, 'lab.source-to-display', started); const local = profileSnapshot(); await flushAssetProfile();
      const logs = location.protocol === 'chrome-extension:' ? await chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'snapshot' }) : { spans: local };
      return { totalMs: performance.now() - started, trace, alphaPixels, stats, ...logs };
    },
    clear,
    destroy() { clear(); host.remove(); },
    stats: () => stats,
  };
}
