import { importAssets, releaseAssets } from '../assets/client';
import { getAsset } from '../assets/repository';
import { ASSET_LIMITS } from '../assets/validation';
import { ASSET_LAB_MESSAGE } from './asset-runtime-broker';
import { createAssetLabScene } from './asset-runtime-scene';

const stage = document.querySelector<HTMLElement>('#stage')!, output = document.querySelector<HTMLElement>('#output')!;
const session = 'asset-lab-' + crypto.randomUUID();
let allowed: string[] = [], port: MessagePort | undefined, generation = 0, key = '', busy = false;
const request = async (values: Record<string, unknown>) => { const r = await chrome.runtime.sendMessage({ type: ASSET_LAB_MESSAGE, ...values }); if (!r?.ok) throw new Error(r?.error ?? 'Lab unavailable'); return r.value; };
const read = async (id: string) => { if (parent !== window && !allowed.includes(id)) throw new Error('Asset outside grant'); const row = await getAsset(id); if (!row) throw new Error('Asset missing'); const { blob, leases: _leases, ...metadata } = row; return { blob, metadata }; };
const scene = createAssetLabScene(stage, read);
async function seed() { const file = document.querySelector<HTMLInputElement>('#file')!.files?.[0]; if (!file) throw new Error('Choose local file'); return (await importAssets([file], session))[0]!; }
document.querySelector('#seed')!.addEventListener('click', () => { void seed().then((m) => { output.textContent = JSON.stringify(m); }, (e: unknown) => { output.textContent = String(e); }); });
document.querySelector('#stop')!.addEventListener('click', () => scene.clear());
Object.assign(globalThis, { wwAssetLab: { seed, show: scene.show, clear: scene.clear, stats: scene.stats, open: (ids: string[], tab: number) => request({ action: 'open', ids, tab }) } });
if (parent !== window) {
  document.body.classList.add('framed');
  void request({ action: 'claim', ticket: new URL(location.href).searchParams.get('ticket') }).then((reply) => { allowed = reply.ids; key = reply.key; generation = reply.generation; document.documentElement.dataset.authorized = 'true'; }, (e: unknown) => { document.documentElement.dataset.error = String(e); });
  window.addEventListener('message', (e: MessageEvent) => {
    if (!key || e.origin !== 'https://www.youtube.com' || e.source !== parent || e.data?.type !== ASSET_LAB_MESSAGE || e.data.key !== key || e.data.generation !== generation || e.ports.length !== 1 || port) return;
    port = e.ports[0]!; key = ''; const connected = port;
    connected.onmessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m || m.generation !== generation || !Number.isSafeInteger(m.request)) return;
      const reply = (value: unknown, transfer: Transferable[] = []) => connected.postMessage({ request: m.request, generation, value }, transfer);
      if (m.action === 'clear') { scene.clear(); reply({ cleared: true }); return; }
      if (busy || !allowed.includes(m.id)) { connected.postMessage({ request: m.request, generation, error: 'Busy or forbidden asset' }); return; }
      busy = true;
      void (async () => {
        const start = performance.now(), asset = await read(m.id), sourceMs = performance.now() - start;
        if (m.action === 'binary') {
          if (asset.blob.size > ASSET_LIMITS.modelBytes) throw new Error('Source over budget');
          const before = performance.now(), buffer = await asset.blob.arrayBuffer();
          reply({ metadata: asset.metadata, sourceMs, blobReadMs: performance.now() - before, buffer }, [buffer]); return;
        }
        if (m.action !== 'snapshot') throw new Error('Unknown renderer command');
        const result = await scene.show(asset.metadata, m.count); reply({ ...result, sourceMs });
      })().catch((error: unknown) => { connected.postMessage({ request: m.request, generation, error: String(error) }); }).finally(() => { busy = false; });
    };
    connected.start(); connected.postMessage({ type: 'ready', generation });
  });
}
window.addEventListener('pagehide', () => { port?.close(); scene.destroy(); if (parent === window) void releaseAssets(session); });
