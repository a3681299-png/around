import type { CreatorEditor } from '../editor/controller';
import type { SiteAdapter } from '../sites/types';
import { STUDIO_PORT, STUDIO_PROBE, parseEditCommand, type StudioMessage, type StudioRequest } from '../studio/protocol';
import { ASSET_LIMITS, base64ToBytes } from '../assets/validation';

/** Authenticated extension Port; no window messages or page-script command bridge. */
export function connectStudioHost(doc: Document, site: SiteAdapter, editor: CreatorEditor) {
  const ports = new Map<chrome.runtime.Port, () => void>();
  const trusted = (sender: chrome.runtime.MessageSender | undefined) => sender?.id === chrome.runtime.id && sender.url?.split('?')[0] === chrome.runtime.getURL('studio/index.html');
  const onProbe = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (!trusted(sender) || !message || typeof message !== 'object' || !('type' in message) || message.type !== STUDIO_PROBE) return false;
    respond({ title: doc.title.slice(0, 160), siteId: site.id, enabled: editor.snapshot().enabled, anchors: site.decorationAnchors ?? [], targets: site.designTargets ?? [] }); return false;
  };
  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== STUDIO_PORT || !trusted(port.sender) || port.sender?.frameId && port.sender.frameId !== 0) return;
    let owner: string | undefined, closed = false, attached = false, lastHistory = -1, timer: ReturnType<typeof setTimeout> | undefined;
    let queue: Promise<void> = Promise.resolve();
    const post = (message: StudioMessage) => { if (!closed) { try { port.postMessage(message); } catch { cleanup(); } } };
    const checkpoint = () => { lastHistory = editor.historyVersion; return editor.checkpoint(); };
    const unsubscribe = editor.subscribe(() => {
      if (!attached || !owner || timer) return;
      timer = setTimeout(() => { timer = undefined; post({ type: 'state', state: editor.snapshot(), ...(lastHistory !== editor.historyVersion ? { checkpoint: checkpoint() } : {}) }); }, 25);
    });
    function cleanup() { if (closed) return; closed = true; clearTimeout(timer); unsubscribe(); if (owner) editor.detachStudio(owner); ports.delete(port); }
    ports.set(port, cleanup);
    const receive = (raw: unknown) => {
      queue = queue.catch(() => undefined).then(async () => {
        if (closed || !raw || typeof raw !== 'object') return;
        const request = raw as StudioRequest;
        if (!Number.isSafeInteger(request.id) || request.id < 0) return;
        try {
          if (request.type === 'attach') {
            if (typeof request.owner !== 'string' || !/^studio-[\w-]{1,100}$/.test(request.owner)) throw new Error('Studioの識別子が不正です。');
            if (owner && owner !== request.owner) throw new Error('接続の所有者が変わりました。');
            owner = request.owner;
            const state = await editor.attachStudio(request.owner, request.resume);
            if (closed) { editor.detachStudio(request.owner); return; }
            attached = true;
            post({ type: 'reply', id: request.id, ok: true, state, checkpoint: checkpoint() });
          } else if (!owner) throw new Error('先に編集対象へ接続してください。');
          else if (request.type === 'command') {
            const command = parseEditCommand(request.command), state = await editor.command(owner, request.session, request.revision, command);
            post({ type: 'reply', id: request.id, ok: true, state, ...(lastHistory !== editor.historyVersion ? { checkpoint: checkpoint() } : {}) });
          } else if (request.type === 'import') {
            if (!Array.isArray(request.files) || !request.files.length || request.files.length > ASSET_LIMITS.batchCount) throw new Error('素材の数が不正です。');
            let total = 0;
            const files = request.files.map((file) => {
              if (typeof file.name !== 'string' || file.name.length > 120 || typeof file.mime !== 'string' || typeof file.base64 !== 'string' || file.base64.length > Math.ceil(ASSET_LIMITS.fileBytes / 3) * 4) throw new Error('素材が不正です。');
              const bytes = base64ToBytes(file.base64); total += bytes.length; if (total > ASSET_LIMITS.batchBytes) throw new Error('素材は合計32MBまでです。');
              return new File([new Uint8Array(bytes).buffer], file.name, { type: file.mime });
            });
            const state = await editor.import(owner, request.session, request.revision, files); post({ type: 'reply', id: request.id, ok: true, state, checkpoint: checkpoint() });
          } else if (request.type === 'thumbnail') {
            if (typeof request.layer !== 'string' || !editor.snapshot().view.images.some((layer) => layer.id === request.layer)) throw new Error('素材が見つかりません。');
            const data = await editor.thumbnail(request.layer); post({ type: 'reply', id: request.id, ok: true, ...(data ? { thumbnail: data } : {}) });
          } else if (request.type === 'detach') { editor.detachStudio(owner); owner = undefined; attached = false; post({ type: 'reply', id: request.id, ok: true }); }
          else throw new Error('未対応のStudio操作です。');
        } catch (error) { post({ type: 'reply', id: request.id, ok: false, error: error instanceof Error ? error.message : '通信に失敗しました。', state: editor.snapshot() }); }
      });
    };
    port.onMessage.addListener(receive); port.onDisconnect.addListener(cleanup);
  };
  chrome.runtime.onMessage.addListener(onProbe); chrome.runtime.onConnect.addListener(onConnect);
  return () => { chrome.runtime.onMessage.removeListener(onProbe); chrome.runtime.onConnect.removeListener(onConnect); for (const [port, cleanup] of ports) { cleanup(); port.disconnect(); } ports.clear(); };
}
