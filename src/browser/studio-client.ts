import { createStudioStateDecoder } from '../studio/state-sync';
import { packCheckpoint } from '../studio/checkpoint-codec';
import {
  STUDIO_PORT,
  STUDIO_PROBE,
  type StudioMessage,
  type StudioRequest,
  type StudioTarget,
} from '../studio/protocol';
import type { EditCommand, EditorCheckpoint, EditorSnapshot } from '../editor-core/types';
import { ASSET_LIMITS } from '../assets/validation';
import { ASSET_MESSAGES } from '../assets/limits';
import { releaseAssets } from '../assets/client';
import { importStudioAssets } from '../assets/studio-upload';

import type { StudioConnectionState, StudioConnection } from '../studio/connection';
import { requestStudioSurface } from './side-panel';
import {
  CLOSE_SIDE_PANEL,
  OPEN_SIDE_PANEL,
  OPEN_STUDIO_WINDOW,
  OPEN_INPAGE_STUDIO,
  type OpenEditorResponse,
} from '../editor/messages';
import type { TimelinePort, TimelineCommand, TimelineUpdate } from '../timeline/types';
export function createStudioClient(
  notify: (value: StudioConnectionState) => void,
  checkpointChanged: (target: number, checkpoint: EditorCheckpoint | undefined) => void,
  visibilityDocument?: Document,
): StudioConnection {
  const owner = `studio-${crypto.randomUUID()}`;
  let port: chrome.runtime.Port | undefined,
    tabId: number | undefined,
    state: EditorSnapshot | undefined,
    backup: EditorCheckpoint | undefined;
  let connected = false,
    stopped = false,
    epoch = 0,
    serial = 0,
    retry: ReturnType<typeof setTimeout> | undefined,
    retries = 0;
  let commands: Promise<void> = Promise.resolve();
  let pendingImport: { controller: AbortController; lease: string } | undefined;
  const cancelImport = () => {
    if (!pendingImport) return;
    pendingImport.controller.abort();
    // Do not wait for a file read or an in-flight worker reply before cleanup.
    // Worker mutations serialize this release after any already-sent upload;
    // the import's finally also releases it after the reply settles.
    void releaseAssets(pendingImport.lease).catch(() => undefined);
  };
  let observed = false,
    timelineState: TimelineUpdate = {
      status: {
        available: false,
        mode: 'live',
        source: 'live',
        timeMs: 0,
        durationMs: 0,
        samples: 0,
        progress: 0,
        rate: 1,
        saved: false,
        message: '',
        error: false,
      },
      take: null,
      library: [],
    };
  const timelineListeners = new Set<(value: TimelineUpdate) => void>();
  const useTimeline = (value: TimelineUpdate) => {
    timelineState = { ...timelineState, ...value };
    timelineListeners.forEach((listener) => listener(value));
  };
  const timeline: TimelinePort = {
    snapshot: () => timelineState,
    subscribe(listener) {
      timelineListeners.add(listener);
      return () => timelineListeners.delete(listener);
    },
    dispatch(value: TimelineCommand) {
      if (value.type === 'observe') observed = value.value;
      const generation = epoch;
      commands = commands
        .catch(() => undefined)
        .then(async () => {
          if (generation !== epoch || !connected || !state?.active) return;
          await request({ type: 'timeline', session: state.sessionId, command: value } as Omit<StudioRequest, 'id'>);
        })
        .catch((reason: unknown) => {
          if (generation === epoch)
            useTimeline({
              status: {
                ...timelineState.status,
                error: true,
                message: reason instanceof Error ? reason.message : 'タイムライン通信に失敗しました。',
              },
            });
        });
      return commands;
    },
  };
  const pending = new Map<
    number,
    {
      resolve: (message: Extract<StudioMessage, { type: 'reply' }>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const emit = (message: string) => notify({ target: tabId, connected, message, ...(state ? { state } : {}) });
  const useState = (next: EditorSnapshot, checkpoint?: EditorCheckpoint) => {
    if (state && next.sessionId === state.sessionId && next.revision < state.revision) return;
    state = next;
    if (!connected) return;
    if (!next.active) {
      backup = undefined;
      if (tabId !== undefined) checkpointChanged(tabId, undefined);
    } else {
      if (checkpoint) backup = checkpoint;
      if (backup) {
        backup = {
          ...backup,
          draft: next.document,
          ...(next.saved ? { saved: next.saved } : {}),
          selectedIds: [...next.view.selectedIds],
          tool: next.view.tool ?? 'select',
          snapping: next.view.snapping,
        };
        if (!next.saved) delete backup.saved;
        if (next.selectedTarget) backup.selectedTarget = next.selectedTarget;
        else delete backup.selectedTarget;
        if (tabId !== undefined) checkpointChanged(tabId, backup);
      }
    }
  };
  const request = (value: Omit<StudioRequest, 'id'>): Promise<Extract<StudioMessage, { type: 'reply' }>> => {
    const activePort = port;
    if (!activePort) return Promise.reject(new Error('YouTubeへ接続していません。'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('応答がありません。対象タブを確認してください。'));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      try {
        activePort.postMessage({ ...value, id });
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error('接続が切れました。'));
      }
    });
  };
  const connect = async () => {
    if (tabId === undefined || stopped) return;
    const generation = epoch,
      target = tabId;
    try {
      const next = chrome.tabs.connect(target, { name: STUDIO_PORT, frameId: 0 });
      port = next;
      const decoder = createStudioStateDecoder();
      next.onMessage.addListener((message: StudioMessage) => {
        if (generation !== epoch || port !== next || !message || typeof message !== 'object') return;
        if (message.type === 'handoff') {
          stopped = true;
          disconnect();
          emit('別のStudioへ編集を引き継ぎました。未保存の変更と履歴は対象タブで保持しています。');
          return;
        }
        if (message.type === 'timeline') {
          useTimeline(message.update);
          return;
        }
        if (message.type !== 'state' && message.type !== 'reply') return;
        let received;
        try {
          if (message.type === 'reply' && !message.ok && message.state && message.sequence === undefined)
            useState(message.state);
          else received = decoder.accept(message);
        } catch {
          next.disconnect();
          return;
        }
        if (message.type === 'reply' && message.ok && message.checkpoint) connected = true;
        if (received) useState(received.state, received.checkpoint);
        if (message.type === 'state') {
          emit(
            state?.active
              ? '接続中'
              : state?.enabled
                ? '編集を終了しました。接続ボタンで再開できます。'
                : 'テーマがOFFまたは強さ0%です。',
          );
        } else if (message.type === 'reply') {
          const entry = pending.get(message.id);
          if (!entry) return;
          pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.ok) entry.resolve(message);
          else entry.reject(new Error(message.error ?? '操作を実行できませんでした。'));
        }
      });
      next.onDisconnect.addListener(() => {
        if (generation !== epoch || port !== next) return;
        // Queued commands and file reads belong to the disconnected document.
        epoch++;
        cancelImport();
        port = undefined;
        connected = false;
        useTimeline({
          status: {
            ...timelineState.status,
            available: false,
            mode: 'paused',
            message: '編集対象との再接続を待っています。',
          },
        });
        pending.forEach((entry) => {
          clearTimeout(entry.timer);
          entry.reject(new Error('YouTubeとの接続が切れました。'));
        });
        pending.clear();
        emit('再接続を待っています。未保存の編集は保持しています。');
        if (!stopped)
          retry = setTimeout(
            () => {
              void connect();
            },
            Math.min(5000, 300 * 2 ** Math.min(4, retries++)),
          );
      });
      await request({
        type: 'attach',
        owner,
        ...(backup ? { resume: packCheckpoint(backup) } : {}),
        ...(visibilityDocument ? { visible: !visibilityDocument.hidden } : {}),
      } as Omit<StudioRequest, 'id'>);
      if (generation !== epoch) return;
      connected = true;
      retries = 0;
      publishVisibility();
      if (observed) void timeline.dispatch({ type: 'observe', value: true });
      emit('接続中');
    } catch (error) {
      if (generation !== epoch) return;
      connected = false;
      emit(error instanceof Error ? error.message : '接続できません。');
      // Retry a target whose storage is still loading after a document reload.
      if (error instanceof Error && error.message.includes('読み込み中') && !stopped) {
        const old = port;
        port = undefined;
        old?.disconnect();
        retry = setTimeout(
          () => {
            void connect();
          },
          Math.min(5000, 300 * 2 ** Math.min(4, retries++)),
        );
      }
    }
  };
  const disconnect = () => {
    epoch++;
    cancelImport();
    clearTimeout(retry);
    const old = port;
    port = undefined;
    connected = false;
    useTimeline({
      status: {
        ...timelineState.status,
        available: false,
        mode: 'paused',
        message: '編集対象との接続を待っています。',
      },
    });
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(new Error('編集対象を切り替えました。'));
    });
    pending.clear();
    old?.disconnect();
  };
  const onTabRemoved = (id: number) => {
    if (id === tabId) {
      stopped = true;
      disconnect();
      emit('対象のYouTubeタブが閉じられました。タブ一覧から編集先を選び直してください。');
    }
  };
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  // Browser-only UI visibility, independent of document revisions and history.
  function publishVisibility() {
    if (visibilityDocument && connected)
      void request({ type: 'surface-visibility', visible: !visibilityDocument.hidden } as Omit<
        StudioRequest,
        'id'
      >).catch(() => undefined);
  }
  visibilityDocument?.addEventListener('visibilitychange', publishVisibility);
  function enqueue(action: () => Promise<unknown>) {
    const generation = epoch;
    commands = commands
      .catch(() => undefined)
      .then(async () => {
        if (generation !== epoch || !connected) throw new Error('接続してから操作してください。');
        await action();
        emit('接続中');
      })
      .catch((error: unknown) => {
        if (generation === epoch) emit(error instanceof Error ? error.message : '操作に失敗しました。');
      });
    return commands;
  }
  const focusTarget = async () => {
    if (tabId === undefined) return;
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  };
  return {
    timeline,
    async targets(): Promise<StudioTarget[]> {
      const tabs = await chrome.tabs.query({});
      const results = await Promise.all(
        tabs.flatMap((tab) =>
          tab.id === undefined
            ? []
            : [
                chrome.tabs.sendMessage(tab.id, { type: STUDIO_PROBE }).then(
                  (info: Omit<StudioTarget, 'id'> | undefined) => (info?.siteId ? { ...info, id: tab.id! } : undefined),
                  () => undefined,
                ),
              ],
        ),
      );
      return results.filter((target): target is StudioTarget => Boolean(target));
    },
    async select(target: number, resume?: EditorCheckpoint) {
      disconnect();
      useTimeline({
        status: {
          ...timelineState.status,
          available: false,
          source: 'live',
          mode: 'live',
          timeMs: 0,
          durationMs: 0,
          samples: 0,
          progress: 0,
          saved: false,
          message: '',
        },
        take: null,
        library: [],
      });
      stopped = false;
      tabId = target;
      state = undefined;
      backup = resume;
      retries = 0;
      emit('接続しています…');
      await connect();
    },
    reconnect() {
      if (tabId !== undefined) {
        disconnect();
        stopped = false;
        void connect();
      }
    },
    dispatch(command: EditCommand) {
      return enqueue(async () => {
        const current = state!;
        await request({ type: 'command', session: current.sessionId, revision: current.revision, command } as Omit<
          StudioRequest,
          'id'
        >);
      });
    },
    import(files: readonly File[]) {
      return enqueue(async () => {
        const generation = epoch;
        const large = files.some((f) => f.size > ASSET_LIMITS.fileBytes);
        if (
          !files.length ||
          files.length > ASSET_LIMITS.batchCount ||
          files.reduce((n, f) => n + f.size, 0) > (large ? ASSET_LIMITS.batchBytes : ASSET_LIMITS.fileBytes)
        )
          throw new Error(ASSET_MESSAGES.batch);
        const lease = `studio-upload-${crypto.randomUUID()}`,
          controller = new AbortController(),
          target = tabId;
        pendingImport = { controller, lease };
        try {
          const surface = visibilityDocument ? new URL(visibilityDocument.URL).searchParams.get('surface') : undefined;
          const ownerTab = surface === 'sidepanel' ? target : (await chrome.tabs.getCurrent())?.id;
          controller.signal.throwIfAborted();
          if (ownerTab === undefined) throw new Error('Studioの保持先が見つかりません。');
          const assets = await importStudioAssets(files, lease, controller.signal, ownerTab);
          if (generation !== epoch || !connected) throw new Error('素材の読み込み中に接続が変わりました。');
          const current = state!;
          await request({
            type: 'import-assets',
            session: current.sessionId,
            revision: current.revision,
            assets: assets.map((a) => a.id),
          } as Omit<StudioRequest, 'id'>);
        } finally {
          if (pendingImport?.controller === controller) pendingImport = undefined;
          await releaseAssets(lease).catch(() => undefined);
        }
      });
    },
    async thumbnail(id: string) {
      if (!connected) return;
      try {
        return (await request({ type: 'thumbnail', layer: id } as Omit<StudioRequest, 'id'>)).thumbnail;
      } catch {
        return;
      }
    },
    focusTarget,
    async openWorkspace(surface = 'inpage') {
      if (tabId === undefined || !connected) throw new Error('先に編集対象へ接続してください。');
      if (surface === 'sidepanel' || surface === 'window') {
        await requestStudioSurface(surface === 'sidepanel' ? OPEN_SIDE_PANEL : OPEN_STUDIO_WINDOW, tabId);
        return;
      }
      const response = await chrome.tabs.sendMessage<{ type: string }, OpenEditorResponse>(tabId, {
        type: OPEN_INPAGE_STUDIO,
      });
      await chrome.runtime.sendMessage({ type: CLOSE_SIDE_PANEL, tabId });
      if (!response?.ok) throw new Error(response?.error ?? '制作画面を開けませんでした。');
      await focusTarget();
    },
    get state() {
      return state;
    },
    get target() {
      return tabId;
    },
    get isConnected() {
      return connected;
    },
    stop() {
      stopped = true;
      disconnect();
      emit('接続を解除しました。');
    },
    destroy() {
      stopped = true;
      disconnect();
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      visibilityDocument?.removeEventListener('visibilitychange', publishVisibility);
    },
  };
}
