import { importAssets, loadAsset, loadAssetMetadata, releaseAssets } from '../assets/client';
import { getAsset } from '../assets/repository';
import { inspectAsset } from '../assets/inspect';
import type { AssetMetadata } from '../assets/validation';
import type { ModelDecoration } from '../design/types';
import { defaultModelSettings } from '../models/types';
import { createModelRenderer } from '../renderers/three/models';
import type { ModelSurface } from '../renderers/three/models';
import { PROFILE_MESSAGE, newAssetProfile, assetProfile, linkAssetProfile, profileAsync, profileSync, profileEnd, flushAssetProfile } from './asset-profile';

const fileInput = document.querySelector<HTMLInputElement>('#file')!, assetInput = document.querySelector<HTMLInputElement>('#asset')!;
const output = document.querySelector<HTMLElement>('#result')!, stage = document.querySelector<HTMLElement>('#stage')!;
const host = document.createElement('div'), shadow = host.attachShadow({ mode: 'open' }); stage.append(host);
let renderer: ReturnType<typeof createModelRenderer> | undefined, running = false;
let activeSurface: ModelSurface | undefined;
let latest: Record<string, unknown> = {}, stats: Record<string, unknown> = {};
const session = 'benchmark-' + crypto.randomUUID();
const stop = () => { activeSurface?.destroy(); activeSurface = undefined; renderer?.destroy(); renderer = undefined; shadow.replaceChildren(); };
const snapshot = () => chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'snapshot' }) as Promise<{ spans: unknown[] }>;
const clear = () => chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'clear' });
async function seed() {
  const file = fileInput.files?.[0]; if (!file) throw new Error('Fileを選択してください。');
  const [asset] = await importAssets([file], session); assetInput.value = asset!.id; return asset!.id;
}
async function run(mode: 'transport' | 'direct' | 'stored', warmup: 'none' | 'textures' | 'compile' | 'both' = 'none') {
  if (running) throw new Error('計測中です。');
  running = true; stop(); await clear();
  const started = performance.now(); let trace = newAssetProfile()!;
  try {
    let metadata: AssetMetadata, blob: Blob | undefined;
    if (mode === 'direct') {
      const file = fileInput.files?.[0]; if (!file) throw new Error('Fileを選択してください。');
      const bytes = new Uint8Array(await profileAsync(trace, 'direct.file-read', () => file.arrayBuffer(), { bytes: file.size }));
      const info = profileSync(trace, 'direct.inspect', () => inspectAsset(bytes, file.type));
      metadata = { ...info, id: 'asset-' + '0'.repeat(64), name: 'local-model', byteLength: bytes.length };
      blob = profileSync(trace, 'direct.blob-wrap', () => new Blob([bytes.buffer], { type: info.mime }), { bytes: bytes.length });
    } else if (mode === 'stored') {
      const row = await profileAsync(trace, 'direct.idb-read', () => getAsset(assetInput.value));
      if (!row) throw new Error('保存済み素材が見つかりません。');
      const { blob: stored, leases: _leases, ...info } = row; blob = stored; metadata = info;
    } else {
      const id = await seed(); metadata = await loadAssetMetadata(id); trace = assetProfile(id)!;
    }
    if (!metadata.model) throw new Error('GLB/VRMを選択してください。');
    linkAssetProfile(metadata.id, trace); if (mode !== 'direct') assetInput.value = metadata.id;
    const placement = { anchor: { kind: 'viewport' as const }, x: .5, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 0 };
    const layer: ModelDecoration = { id: 'image-benchmark', name: 'local-model', kind: 'model3d', assetId: metadata.id, source: metadata.model, model: defaultModelSettings(metadata.model), placement, opacity: 1, zIndex: 0, visible: true, locked: false };
    let failure: string | undefined;
    renderer = createModelRenderer(document, (message) => { failure = message; }, (value) => { stats = value; }, shadow, blob ? async () => ({ metadata, blob: blob! }) : loadAsset, { warmup, gpuBreakdown: true });
    const surface = renderer.attach(shadow.appendChild(document.createElement('div'))); activeSurface = surface; surface.update(layer, true);
    renderer.evaluate({ timeMs: 0, layout: { layers: [], groups: [], roots: [] }, effects: [], machine: { video: 'paused', events: [] }, needsFrame: false, subscriptions: { pointer: false, video: false },
      models: [{ id: layer.id, clip: layer.model.clip, timeMs: 0, previousClip: null, previousTimeMs: 0, fadeElapsedMs: 0, fadeDurationMs: 0, yawDeg: 0, lookYaw: 0, lookPitch: 0, suspended: false, phase: 'manual', blend: 1, speedPx: 0 }] });
    await new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 120000;
      const check = () => { if (failure) reject(new Error(failure)); else if (surface.element.dataset.profileReady) resolve(); else if (performance.now() > deadline) reject(new Error('first paint timeout')); else requestAnimationFrame(check); }; check();
    });
    profileEnd(trace, 'benchmark.total', started, { bytes: metadata.byteLength }); await flushAssetProfile();
    const canvas = surface.element.querySelector('canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0; for (let n = 3; n < pixels.length; n += 4) if (pixels[n]) alpha++;
    latest = { mode, trace, byteLength: metadata.byteLength, vrmVersion: metadata.model.vrm?.version, totalMs: performance.now() - started, alphaPixels: alpha, canvas: [canvas.width, canvas.height], stats, ...(await snapshot()) };
    output.textContent = JSON.stringify(latest, null, 2); return latest;
  } finally { running = false; }
}
for (const mode of ['transport', 'direct', 'stored'] as const) document.querySelector('#' + mode)!.addEventListener('click', () => { void run(mode).catch((error: unknown) => { output.textContent = String(error); }); });
document.querySelector('#seed')!.addEventListener('click', () => { void seed().then((id) => { output.textContent = '保存完了: ' + id; }, (error: unknown) => { output.textContent = String(error); }); });
document.querySelector('#stop')!.addEventListener('click', stop);
window.addEventListener('pagehide', () => { stop(); void releaseAssets(session); });
Object.assign(globalThis, { wwAssetBench: { run, seed, stop, snapshot, clear, latest: () => latest, grant: (id: string, tab: number) => chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'grant', id, tab }) } });

// Opt-in architecture probe. It never sends asset bytes or arbitrary Chrome
// commands to its parent; a worker-issued, tab-bound grant selects one asset.
if (parent !== window) {
  document.body.classList.add('framed');
  const nonce = new URL(location.href).searchParams.get('nonce');
  void chrome.runtime.sendMessage({ type: PROFILE_MESSAGE, action: 'claim', nonce }).then(async (reply: { id?: string; error?: string }) => {
    if (!reply.id) throw new Error(reply.error ?? 'probe not authorized');
    assetInput.value = reply.id; await run('stored'); document.documentElement.dataset.probeReady = 'true';
  }).catch((error: unknown) => { document.documentElement.dataset.probeError = String(error); });
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== 'https://www.youtube.com' || event.source !== parent || event.data?.type !== 'ww-binary-probe' || event.data.nonce !== nonce || event.ports.length !== 1) return;
    const port = event.ports[0]!;
    port.onmessage = (message: MessageEvent) => {
      const bytes = message.data;
      port.postMessage({ byteLength: bytes instanceof ArrayBuffer && bytes.byteLength <= 64 * 1024 * 1024 ? bytes.byteLength : 0 }); port.close();
    }; port.start();
  });
}
