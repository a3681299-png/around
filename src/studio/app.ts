import { createCreatorPanel } from '../editor/panel';
import { shortcutCommand } from '../editor-core/shortcuts';
import type { EditorCheckpoint, EditCommand } from '../editor-core/types';
import type { StudioConnection, StudioConnectionState, StudioRecovery } from './connection';
import type { StudioPreferences } from './preferences';
import type { StudioTarget } from './protocol';
import { studioActions } from './ui-actions';

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
  let alive = true, targets: StudioTarget[] = [], panel: ReturnType<typeof createCreatorPanel> | undefined, paneTarget: number | undefined;
  let stage: HTMLElement | undefined, assetKey = '', refreshEpoch = 0, switchEpoch = 0;
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
  function assets(state: StudioConnectionState) {
    if (!stage || !state.state) return;
    const layers = [...new Map(state.state.view.images.map((layer) => [layer.assetId, layer])).values()];
    const key = JSON.stringify(layers.map((layer) => [layer.id, layer.name, layer.assetId]));
    if (key === assetKey) return; assetKey = key;
    const list = stage.querySelector<HTMLElement>('.asset-library')!; list.replaceChildren();
    if (!layers.length) { const hint = doc.createElement('p'); hint.className = 'hint'; hint.textContent = '左の「画像を追加」「アニメーションを追加」から制作を始めましょう。素材の原本はレイヤーと分けて保存されます。'; list.append(hint); }
    layers.forEach((layer) => {
      const card = doc.createElement('button'); card.type = 'button'; card.className = 'asset-card'; card.title = layer.name;
      const thumb = doc.createElement('span'); thumb.className = 'thumbnail'; thumb.textContent = layer.kind === 'animation' ? '▶' : '▧';
      const name = doc.createElement('span'); name.textContent = layer.name; const type = doc.createElement('small'); type.textContent = layer.kind === 'animation' ? layer.format.toUpperCase() : '画像';
      card.append(thumb, name, type); card.addEventListener('click', () => dispatch({ type: 'select', id: layer.id })); list.append(card);
      void connection.thumbnail(layer.id).then((url) => {
        if (!alive || !card.isConnected || !(url?.startsWith('data:image/png;base64,') || url?.startsWith('data:image/svg+xml;charset=utf-8,'))) return;
        const img = doc.createElement('img'); img.src = url; img.alt = ''; thumb.replaceChildren(img);
      });
    });
  }
  function render(value: StudioConnectionState) {
    if (!alive) return;
    latest = value;
    message.textContent = value.message; message.dataset.connected = String(value.connected);
    get<HTMLButtonElement>('.disconnect-target').disabled = !value.connected;
    get<HTMLButtonElement>('.focus-target').disabled = value.target === undefined;
    if (!value.state || pendingCommands && value.connected && value.target === paneTarget) return;
    if (!panel || paneTarget !== value.target) {
      panel?.destroy(); mount.replaceChildren(); paneTarget = value.target; assetKey = '';
      panel = createCreatorPanel(doc, studioActions(dispatch, (files) => { if (connection.isConnected) void connection.import(files); }, (id) => connection.thumbnail(id)),
        targets.find((target) => target.id === value.target)?.anchors ?? [], { preferences: ports.preferences, fullPage: true, persistWorkspace: true });
      mount.append(panel.host);
      stage = doc.createElement('section'); stage.className = 'studio-stage'; stage.setAttribute('aria-label', '素材とプレビュー');
      stage.innerHTML = `<div class="preview-link"><span class="eyebrow">LIVE CANVAS</span><h2>プレビューは実際の${hostName}に</h2><p>この画面でレイヤーや設定を編集し、${hostName}上で選択・移動・変形できます。同じ編集セッションとUndo履歴を共有します。</p><button class="stage-focus" type="button">${hostName}を表示する ↗</button><p class="hint">Studioと${hostName}を別ウィンドウで並べて使えます。未保存の編集は接続中のタブだけにプレビューされます。</p></div><section class="asset-shelf"><h3>この作品の素材</h3><p class="hint">クリックしてレイヤーを選択。複製・削除は共通ツールバーで行えます。</p><div class="asset-library"></div></section>`;
      panel.host.shadowRoot!.querySelector('.editor-body')!.append(stage);
      stage.querySelector('button')!.addEventListener('click', focusTarget);
    }
    const ready = value.connected && value.state.active;
    panel.host.toggleAttribute('data-disconnected', !ready);
    panel.render({ ...value.state.view, saving: value.state.view.saving || !ready });
    assets(value);
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
    if (!connection.isConnected || !connection.state?.active || event.isComposing || event.composedPath().some((node) => node instanceof HTMLElement && (node.matches('input,textarea,select,[role="tab"],[role="separator"],[role="menuitem"]') || node.isContentEditable))) return;
    const command = shortcutCommand(event, connection.state.view); if (!command) return;
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
