import { createCreatorPanel } from '../editor/panel';
import { shortcutCommand } from '../editor-core/shortcuts';
import type { EditorCheckpoint, EditCommand } from '../editor-core/types';
import type { StudioConnection, StudioConnectionState, StudioRecovery } from './connection';
import type { StudioPreferences } from './preferences';
import type { StudioTarget } from './protocol';
import { studioActions } from './ui-actions';
import { buttonIcon } from '../editor/icons';

interface StudioPorts {
  hostName: string;
  connect(notify: (value: StudioConnectionState) => void, checkpoint: (target: number, value: EditorCheckpoint | undefined) => void): StudioConnection;
  recovery: StudioRecovery;
  preferences: StudioPreferences;
}

/** Shared full-size UI. The composition root supplies transport, storage and preferences. */
export function mountStudio(doc: Document, root: HTMLElement, ports: StudioPorts) {
  const hostName = ports.hostName.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  root.innerHTML = `<header class="connection-bar"><strong>WORLD THEMES STUDIO</strong><label>編集対象 <select aria-label="編集する${hostName}タブ"><option value="">対象を選ぶ</option></select></label><button class="refresh-targets" type="button" title="開いている対応タブを取得">タブを更新</button><button class="connect-target" type="button">接続 / 再開</button><button class="disconnect-target" type="button">接続を解除</button><button class="focus-target" type="button">${hostName}を表示</button><span class="connection-status" role="status" aria-live="polite">接続先を選んでください。</span></header><p class="recovery-status" role="status"></p><div class="studio-mount"><section class="connection-empty"><h1>Webサイトが、あなたのキャンバスに。</h1><p>${hostName}を開いてテーマをONにし、上の一覧から接続してください。Studioの変更は実際の${hostName}タブへ反映されます。</p><p>Studioと${hostName}を並べると、制作パネルと作品を同時に見ながら編集できます。</p></section></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const targetSelect = get<HTMLSelectElement>('select'), mount = get('.studio-mount'), message = get('.connection-status'), recoveryStatus = get('.recovery-status');
  const connectionBar = get('.connection-bar'); connectionBar.querySelector('strong')!.remove();
  for (const [selector, name] of [['refresh-targets', 'refresh'], ['connect-target', 'connect'], ['disconnect-target', 'close'], ['focus-target', 'external']]) buttonIcon(get<HTMLButtonElement>('.' + selector), name!);
  let alive = true, targets: StudioTarget[] = [], panel: ReturnType<typeof createCreatorPanel> | undefined, paneTarget: number | undefined;
  let stage: HTMLElement | undefined, refreshEpoch = 0, switchEpoch = 0;
  let pendingCommands = 0, latest: StudioConnectionState | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const backups = new Map<number, EditorCheckpoint | undefined>();
  const persist = () => {
    clearTimeout(recoveryTimer);
    for (const [target, value] of backups) {
      backups.delete(target);
      void ports.recovery.write(target, value).then(() => { if (alive) recoveryStatus.textContent = ''; }, (error: unknown) => {
        if (alive) recoveryStatus.textContent = `接続復旧用の保持に失敗しました。作品を保存してください。${error instanceof Error ? error.message : ''}`;
      });
    }
  };
  const connection = ports.connect(render, (target, value) => {
    backups.set(target, value); clearTimeout(recoveryTimer); recoveryTimer = setTimeout(persist, 180);
  });
  const dispatch = (command: EditCommand) => {
    if (!connection.isConnected || !connection.state?.active) return;
    pendingCommands++;
    void connection.dispatch(command).finally(() => { pendingCommands--; if (!pendingCommands && latest) render(latest); });
  };
  function render(value: StudioConnectionState) {
    if (!alive) return;
    latest = value;
    message.textContent = value.message; message.dataset.connected = String(value.connected);
    get<HTMLButtonElement>('.disconnect-target').disabled = !value.connected;
    get<HTMLButtonElement>('.focus-target').disabled = value.target === undefined;
    if (!value.state || pendingCommands && value.connected && value.target === paneTarget) return;
    if (!panel || paneTarget !== value.target) {
      panel?.destroy(); mount.replaceChildren(); paneTarget = value.target;
      panel = createCreatorPanel(doc, studioActions(dispatch, (files) => { if (connection.isConnected) void connection.import(files); }, (id) => connection.thumbnail(id)),
        targets.find((target) => target.id === value.target)?.anchors ?? [], { preferences: ports.preferences, hostLabel: ports.hostName, fullPage: true, persistWorkspace: true });
      mount.append(panel.host); connectionBar.slot = 'connection'; message.slot = 'connection-status'; panel.host.append(connectionBar, message);
      stage = doc.createElement('section'); stage.className = 'studio-stage'; stage.setAttribute('aria-label', '素材とプレビュー');
      stage.innerHTML = `<div class="preview-link"><strong>ライブキャンバス</strong><p>${hostName}の画面に制作UIを配置して、作品を直接編集できます。</p><button class="stage-inpage" type="button">${hostName}でStudioを開く</button><button class="stage-focus" type="button">${hostName}を表示</button></div>`;
      panel.host.shadowRoot!.querySelector('.canvas-slot')!.append(stage);
      stage.querySelector('.stage-focus')!.addEventListener('click', focusTarget);
      stage.querySelector('.stage-inpage')!.addEventListener('click', () => { void connection.openWorkspace().catch((error: unknown) => { message.textContent = error instanceof Error ? error.message : '制作画面を開けませんでした。'; }); });
    }
    const ready = value.connected && value.state.active;
    panel.host.toggleAttribute('data-disconnected', !ready);
    panel.render({ ...value.state.view, saving: value.state.view.saving || !ready });

  }
  async function refreshTargets() {
    const epoch = ++refreshEpoch;
    try {
      const list = await connection.targets(); if (!alive || epoch !== refreshEpoch) return;
      const previous = connection.target ?? Number(targetSelect.value);
      targets = list;
      targetSelect.replaceChildren(new Option('対象を選ぶ', ''));
      for (const target of list) { const option = doc.createElement('option'); option.value = String(target.id); option.textContent = `${target.enabled ? '' : 'OFF · '}#${target.id} ${target.title || target.siteId}`; targetSelect.append(option); }
      if (list.some((target) => target.id === previous)) targetSelect.value = String(previous);
      if (!list.length) message.textContent = `対応する編集対象がありません。${ports.hostName}を開いて一覧を更新してください。`;
    } catch { if (alive) message.textContent = 'タブ一覧を取得できませんでした。'; }
  }
  async function selectTarget(target: number) {
    const epoch = ++switchEpoch; persist();
    try {
      const checkpoint = await ports.recovery.read(target); if (!alive || epoch !== switchEpoch) return;
      await connection.select(target, checkpoint);
    } catch (error) { if (alive) message.textContent = error instanceof Error ? error.message : '接続できませんでした。'; }
  }
  function focusTarget() { void connection.focusTarget().catch(() => { if (alive) message.textContent = '編集対象が閉じられました。一覧を更新してください。'; }); }
  get('.refresh-targets').addEventListener('click', () => { void refreshTargets(); });
  targetSelect.addEventListener('change', () => {
    if (targetSelect.value) void selectTarget(Number(targetSelect.value)); else { persist(); connection.stop(); }
  });
  get('.connect-target').addEventListener('click', () => { if (targetSelect.value) { if (connection.target === Number(targetSelect.value)) connection.reconnect(); else void selectTarget(Number(targetSelect.value)); } });
  get('.disconnect-target').addEventListener('click', () => { persist(); connection.stop(); });
  get('.focus-target').addEventListener('click', focusTarget);
  const consumedKeys = new Set<string>();
  const keydown = (event: KeyboardEvent) => {
    if (!connection.isConnected || !connection.state?.active || panel?.host.hasAttribute('data-ww-scrubbing') || event.isComposing || event.composedPath().some((node) => node instanceof HTMLElement && (node.matches('input,textarea,select,summary,[role="tab"],[role="separator"],[role="menuitem"]') || node.isContentEditable))) return;
    const command = shortcutCommand(event, connection.state.view, true); if (!command) return;
    dispatch(command); consumedKeys.add(event.code || event.key); event.preventDefault(); event.stopImmediatePropagation();
  };
  const keyup = (event: KeyboardEvent) => { if (consumedKeys.delete(event.code || event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const dragover = (event: DragEvent) => { if (connection.isConnected && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } };
  const drop = (event: DragEvent) => { if (connection.isConnected && event.dataTransfer?.files.length) { event.preventDefault(); event.stopImmediatePropagation(); void connection.import([...event.dataTransfer.files]); } };
  // Bubble phase lets menus and focused input controls own their shortcuts first.
  doc.addEventListener('keydown', keydown, true); doc.addEventListener('keyup', keyup, true); doc.addEventListener('dragover', dragover); doc.addEventListener('drop', drop, true);
  return {
    async start(target?: number) { await refreshTargets(); if (!alive) return; const selected = targets.find((item) => item.id === target) ?? (targets.length === 1 ? targets[0] : undefined); if (selected) { targetSelect.value = String(selected.id); await selectTarget(selected.id); } },
    destroy() { persist(); alive = false; connection.destroy(); panel?.destroy(); doc.removeEventListener('keydown', keydown, true); doc.removeEventListener('keyup', keyup, true); doc.removeEventListener('dragover', dragover); doc.removeEventListener('drop', drop, true); },
  };
}
