import { ASSET_LAB_MESSAGE } from './asset-runtime-broker';
import { createAssetLabScene } from './asset-runtime-scene';
import type { AssetMetadata } from '../assets/validation';

/** Experimental isolated-world bridge. Never installed by the ordinary build. */
export function installAssetRuntimeHost(doc: Document) {
  const origin = new URL(chrome.runtime.getURL('')).origin;
  let session = '', generation = 0, serial = 0, frame: HTMLIFrameElement | undefined, port: MessagePort | undefined;
  let container: HTMLDivElement | undefined, scene: ReturnType<typeof createAssetLabScene> | undefined;
  let last: { mode: 'resident' | 'binary'; id: string; count: number } | undefined, restarting: Promise<unknown> | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  let messages = 0, binaryBytes = 0, smallBytes = 0;
  const worker = async (values: Record<string, unknown>) => { const r = await chrome.runtime.sendMessage({ type: ASSET_LAB_MESSAGE, session, ...values }); if (!r?.ok) throw new Error(r?.error ?? 'Lab unavailable'); return r.value; };
  function disconnect() {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Renderer disconnected')); } pending.clear(); port?.close(); port = undefined; frame?.remove(); frame = undefined;
  }
  function command(action: string, values: Record<string, unknown> = {}): Promise<any> {
    if (!port) return Promise.reject(new Error('Renderer not connected'));
    const request = ++serial, message = { action, ...values, request, generation }; messages++; smallBytes += JSON.stringify(message).length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(request); reject(new Error('Renderer request timeout')); }, 120000);
      pending.set(request, { resolve, reject, timer }); port!.postMessage(message);
    });
  }
  async function connect() {
    disconnect(); const reply = await worker({ action: 'ticket' }); generation = reply.generation;
    const f = doc.createElement('iframe'); frame = f; f.id = 'ww-asset-runtime-lab'; f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none;z-index:2147483644';
    f.src = chrome.runtime.getURL('diagnostics/asset-runtime-lab.html') + '?ticket=' + reply.ticket; let loads = 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Renderer handshake timeout')), 15000);
      f.onload = () => {
        if (f !== frame) return;
        if (++loads > 1) { void restart().catch(() => undefined); return; }
        void (async () => {
          let binding: { key: string; generation: number } | undefined;
          for (let n = 0; n < 100 && f === frame; n++) { try { binding = await worker({ action: 'bind', generation }); break; } catch { await new Promise((r) => setTimeout(r, 20)); } }
          if (!binding || f !== frame) throw new Error('Renderer authorization failed');
          const c = new MessageChannel(); port = c.port1;
          port.onmessage = (e: MessageEvent) => {
            const m = e.data; if (m?.generation !== generation) return;
            messages++;
            if (m.type === 'ready') { clearTimeout(timer); resolve(); return; }
            const request = pending.get(m.request); if (!request) return; pending.delete(m.request); clearTimeout(request.timer);
            if (m.value?.buffer instanceof ArrayBuffer) binaryBytes += m.value.buffer.byteLength;
            if (m.error) request.reject(new Error(m.error)); else request.resolve(m.value);
          };
          port.start(); f.contentWindow!.postMessage({ type: ASSET_LAB_MESSAGE, ...binding }, origin, [c.port2]);
        })().catch((error: unknown) => { clearTimeout(timer); reject(error); });
      };
      (doc.fullscreenElement ?? doc.body).append(f);
    });
  }
  async function show(mode: 'resident' | 'binary', id: string, count = 1) {
    const started = performance.now(); last = { mode, id, count }; messages = binaryBytes = smallBytes = 0;
    scene?.destroy(); scene = undefined; container?.remove(); container = undefined;
    if (mode === 'resident') { const r = await command('snapshot', { id, count }); return { ...r, endToEndMs: performance.now() - started, messages, binaryBytes, smallBytes, generation }; }
    await command('clear'); const fetchStart = performance.now(), source = await command('binary', { id });
    const assetFetchMs = performance.now() - fetchStart;
    if (!(source.buffer instanceof ArrayBuffer) || source.buffer.byteLength !== source.metadata.byteLength) throw new Error('Invalid binary source');
    const blob = new Blob([source.buffer], { type: source.metadata.mime }), metadata = source.metadata as AssetMetadata;
    container = doc.createElement('div'); container.id = 'ww-asset-runtime-binary'; container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483643'; (doc.fullscreenElement ?? doc.body).append(container);
    scene = createAssetLabScene(container, async () => ({ blob, metadata }));
    const result = await scene.show(metadata, count); return { ...result, assetFetchMs, sourceMs: source.sourceMs, blobReadMs: source.blobReadMs, endToEndMs: performance.now() - started, messages, binaryBytes, smallBytes, generation };
  }
  async function restart(): Promise<unknown> {
    if (restarting) return restarting;
    restarting = (async () => { scene?.destroy(); scene = undefined; container?.remove(); container = undefined; await connect(); return last ? show(last.mode, last.id, last.count) : {}; })();
    try { return await restarting; } finally { restarting = undefined; }
  }
  const observer = new MutationObserver(() => { if (!doc.documentElement.hasAttribute('data-ww-theme')) destroy(); });
  function destroy() {
    observer.disconnect(); disconnect(); scene?.destroy(); scene = undefined; container?.remove(); container = undefined; last = undefined;
    if (session) void worker({ action: 'close' }).catch(() => undefined); session = '';
  }
  doc.addEventListener('fullscreenchange', () => { if (session && frame && !(doc.fullscreenElement ?? doc.body).contains(frame)) void restart().catch(() => undefined); });
  doc.defaultView!.addEventListener('pagehide', destroy);
  Object.assign(globalThis, { wwAssetRuntimeHost: {
    async start(secret: string) { destroy(); session = secret; await worker({ action: 'attach' }); await connect(); observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ww-theme'] }); return { generation }; },
    show, restart, destroy,
    async clear() { last = undefined; scene?.destroy(); scene = undefined; container?.remove(); container = undefined; return command('clear'); },
    state: () => ({ generation, connected: Boolean(port), messages, binaryBytes, smallBytes, last }),
  } });
}
