import { STUDIO_PORT, STUDIO_PROBE, type StudioMessage, type StudioRequest, type StudioTarget } from '../studio/protocol';
import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import { ASSET_LIMITS, bytesToBase64 } from '../assets/validation';

import type { StudioConnectionState, StudioConnection } from '../studio/connection';
export function createStudioClient(notify: (value: StudioConnectionState) => void, checkpointChanged: (target: number, checkpoint: EditorCheckpoint | undefined) => void): StudioConnection {
  const owner = `studio-${crypto.randomUUID()}`;
  let port: chrome.runtime.Port | undefined, tabId: number | undefined, state: EditorSnapshot | undefined, backup: EditorCheckpoint | undefined;
  let connected = false, stopped = false, epoch = 0, serial = 0, retry: ReturnType<typeof setTimeout> | undefined, retries = 0;
  let commands: Promise<void> = Promise.resolve();
  const pending = new Map<number, { resolve: (message: Extract<StudioMessage, { type: 'reply' }>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const emit = (message: string) => notify({ target: tabId, connected, message, ...(state ? { state } : {}) });
  const useState = (next: EditorSnapshot, checkpoint?: EditorCheckpoint) => {
    if (state && next.sessionId === state.sessionId && next.revision < state.revision) return;
    state = next;
    if (!connected) return;
    if (!next.active) { backup = undefined; if (tabId !== undefined) checkpointChanged(tabId, undefined); }
    else {
      if (checkpoint) backup = checkpoint;
      if (backup) {
        backup = { ...backup, draft: next.document, ...(next.saved ? { saved: next.saved } : {}), selectedIds: [...next.view.selectedIds], snapping: next.view.snapping };
        if (!next.saved) delete backup.saved;
        if (next.selectedTarget) backup.selectedTarget = next.selectedTarget; else delete backup.selectedTarget;
        if (tabId !== undefined) checkpointChanged(tabId, backup);
      }
    }
  };
  const request = (value: Omit<StudioRequest, 'id'>): Promise<Extract<StudioMessage, { type: 'reply' }>> => {
    const activePort = port; if (!activePort) return Promise.reject(new Error('YouTubeへ接続していません。'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('応答がありません。対象タブを確認してください。')); }, 30_000);
      pending.set(id, { resolve, reject, timer });
      try { activePort.postMessage({ ...value, id }); } catch { clearTimeout(timer); pending.delete(id); reject(new Error('接続が切れました。')); }
    });
  };
  const connect = async () => {
    if (tabId === undefined || stopped) return;
    const generation = epoch, target = tabId;
    try {
      const next = chrome.tabs.connect(target, { name: STUDIO_PORT, frameId: 0 }); port = next;
      next.onMessage.addListener((message: StudioMessage) => {
        if (generation !== epoch || port !== next || !message || typeof message !== 'object') return;
        if (message.type === 'state') { useState(message.state, message.checkpoint); emit(message.state.active ? '接続中' : message.state.enabled ? '編集を終了しました。接続ボタンで再開できます。' : 'テーマがOFFまたは強さ0%です。'); }
        else if (message.type === 'reply') {
          const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); clearTimeout(entry.timer);
          if (message.ok && message.checkpoint) connected = true;
          if (message.state) useState(message.state, message.checkpoint);
          if (message.ok) entry.resolve(message); else entry.reject(new Error(message.error ?? '操作を実行できませんでした。'));
        }
      });
      next.onDisconnect.addListener(() => {
        if (generation !== epoch || port !== next) return;
        port = undefined; connected = false;
        pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(new Error('YouTubeとの接続が切れました。')); }); pending.clear();
        emit('再接続を待っています。未保存の編集は保持しています。');
        if (!stopped) retry = setTimeout(() => { void connect(); }, Math.min(5000, 300 * 2 ** Math.min(4, retries++)));
      });
      await request({ type: 'attach', owner, ...(backup ? { resume: backup } : {}) } as Omit<StudioRequest, 'id'>);
      if (generation !== epoch) return;
      connected = true; retries = 0; emit('接続中');
    } catch (error) {
      if (generation !== epoch) return;
      connected = false; emit(error instanceof Error ? error.message : '接続できません。');
      // Retry a target whose storage is still loading after a document reload.
      if (error instanceof Error && error.message.includes('読み込み中') && !stopped) {
        const old = port; port = undefined; old?.disconnect();
        retry = setTimeout(() => { void connect(); }, Math.min(5000, 300 * 2 ** Math.min(4, retries++)));
      }
    }
  };
  const disconnect = () => {
    epoch++; clearTimeout(retry); const old = port; port = undefined; connected = false;
    pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(new Error('編集対象を切り替えました。')); }); pending.clear(); old?.disconnect();
  };
  const onTabRemoved = (id: number) => { if (id === tabId) { stopped = true; disconnect(); emit('対象のYouTubeタブが閉じられました。タブ一覧から編集先を選び直してください。'); } };
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  function enqueue(action: () => Promise<unknown>) {
    const generation = epoch;
    commands = commands.catch(() => undefined).then(async () => { if (generation !== epoch || !connected) throw new Error('接続してから操作してください。'); await action(); emit('接続中'); })
      .catch((error: unknown) => { if (generation === epoch) emit(error instanceof Error ? error.message : '操作に失敗しました。'); });
    return commands;
  }
  return {
    async targets(): Promise<StudioTarget[]> {
      const tabs = await chrome.tabs.query({});
      const results = await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [chrome.tabs.sendMessage(tab.id, { type: STUDIO_PROBE }).then((info: Omit<StudioTarget, 'id'> | undefined) => info?.siteId ? { ...info, id: tab.id! } : undefined, () => undefined)]));
      return results.filter((target): target is StudioTarget => Boolean(target));
    },
    async select(target: number, resume?: EditorCheckpoint) { disconnect(); stopped = false; tabId = target; state = undefined; backup = resume; retries = 0; emit('接続しています…'); await connect(); },
    reconnect() { if (tabId !== undefined) { disconnect(); stopped = false; void connect(); } },
    dispatch(command: EditCommand) { return enqueue(async () => { const current = state!; await request({ type: 'command', session: current.sessionId, revision: current.revision, command } as Omit<StudioRequest, 'id'>); }); },
    import(files: readonly File[]) {
      return enqueue(async () => {
        if (!files.length || files.length > ASSET_LIMITS.batchCount || files.reduce((n, f) => n + f.size, 0) > ASSET_LIMITS.batchBytes) throw new Error('一度に追加する素材は8個・合計32MBまでです。');
        const source = await Promise.all(files.map(async (file) => ({ name: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120), mime: file.type, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) })));
        const current = state!; await request({ type: 'import', session: current.sessionId, revision: current.revision, files: source } as Omit<StudioRequest, 'id'>);
      });
    },
    async thumbnail(id: string) { if (!connected) return; try { return (await request({ type: 'thumbnail', layer: id } as Omit<StudioRequest, 'id'>)).thumbnail; } catch { return; } },
    async focusTarget() { if (tabId === undefined) return; const tab = await chrome.tabs.update(tabId, { active: true }); if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }); },
    get state() { return state; }, get target() { return tabId; }, get isConnected() { return connected; },
    stop() { stopped = true; disconnect(); emit('接続を解除しました。'); },
    destroy() { stopped = true; disconnect(); chrome.tabs.onRemoved.removeListener(onTabRemoved); },
  };
}
