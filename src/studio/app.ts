import { createCreatorPanel } from '../editor/panel';
import { shortcutCommand } from '../editor-core/shortcuts';
import type { EditorCheckpoint, EditorRevision, EditCommand } from '../editor-core/types';
import type { StudioConnection, StudioConnectionState, StudioRecovery } from './connection';
import type { StudioPreferences } from './preferences';
import type { StudioTarget } from './protocol';
import { studioActions } from './ui-actions';
import { buttonIcon } from '../editor/icons';
import type { SkinSlot } from '../editor-core/skins';

interface StudioPorts {
  /** 緊急OFF and 操作チェック for the editor's header; `header` is slotted into its menu bar. */
  mountSafety?(root: HTMLElement, connection: StudioConnection): { header: HTMLElement; destroy(): void };
  openSettings?(target?: number): void;
  /** In the browser's side panel only: closes it (fullscreen hides the browser's own button). */
  closePanel?(): void;
  hostName: string;
  sidePanel?: boolean;
  connect(
    notify: (value: StudioConnectionState) => void,
    checkpoint: (target: number, value: EditorCheckpoint | undefined, origin: EditorRevision) => void,
  ): StudioConnection;
  recovery: StudioRecovery;
  preferences: StudioPreferences;
  /** Preview URLs for UI skin art, read from the extension's own asset store. */
  skinAssetUrl?(assetId: string): Promise<string | undefined>;
}

/** Shared full-size UI. The composition root supplies transport, storage and preferences. */
export function mountStudio(doc: Document, root: HTMLElement, ports: StudioPorts) {
  const hostName = ports.hostName.replace(
    /[&<>"']/g,
    (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!,
  );
  root.innerHTML = `<header class="connection-bar"><label>編集対象 <select aria-label="編集する${hostName}タブ"><option value="">対象を選ぶ</option></select></label><button class="refresh-targets" type="button" title="開いている対応タブを取得">タブを更新</button><button class="connect-target" type="button">接続 / 再開</button><button class="disconnect-target" type="button">接続を解除</button><button class="focus-target" type="button">${hostName}を表示</button><span class="connection-status" role="status" aria-live="polite">接続先を選んでください。</span></header><p class="recovery-status" role="status"></p><div class="studio-mount"><section class="connection-empty"><h1>Webサイトが、あなたのキャンバスに。</h1><p>${hostName}を開いて「作品を表示する」をONにし、上の一覧から接続してください。エディターの変更は実際の${hostName}タブへ反映されます。</p><p>エディターと${hostName}を並べると、パネルと作品を同時に見ながら編集できます。</p></section></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const targetSelect = get<HTMLSelectElement>('select'),
    mount = get('.studio-mount'),
    message = get('.connection-status'),
    recoveryStatus = get('.recovery-status');
  const connectionBar = get('.connection-bar');
  const recoveryChoice = doc.createElement('section');
  recoveryChoice.className = 'recovery-choice';
  recoveryChoice.setAttribute('aria-label', '作業中のコピーの復旧');
  recoveryChoice.innerHTML = `<p>保存済みの作品と作業中のコピーが異なります。保存済みの作品を使うと、作業中のコピーは破棄されます。</p><button type="button">保存済みの作品を使う</button><button type="button">作業中のコピーを復元</button>`;
  recoveryChoice.hidden = true;
  mount.before(recoveryChoice);
  const [keepSaved, restoreDraft] = recoveryChoice.querySelectorAll('button');
  const settingsButton = doc.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'studio-display-settings';
  settingsButton.textContent = '設定';
  settingsButton.hidden = !ports.openSettings;
  settingsButton.addEventListener('click', () => ports.openSettings?.(connection.target));
  connectionBar.append(settingsButton);
  // In Chrome's side panel: fullscreen hides the toolbar and its own close button, so the panel
  // carries one (chunk 4 follow-up), first on the status line at its foot (the editor's
  // `panel-close` slot: the narrow panel does not show the connection bar, and its menu bar is
  // full). The draft stays, as when the toolbar closes the panel.
  const closeButton = ports.closePanel ? doc.createElement('button') : undefined;
  if (closeButton) {
    closeButton.type = 'button';
    closeButton.className = 'close-panel';
    closeButton.slot = 'panel-close';
    closeButton.textContent = '閉じる';
    closeButton.title = 'サイドパネルを閉じます。編集中の内容は残ります。';
    closeButton.setAttribute('aria-label', 'サイドパネルを閉じる');
    closeButton.addEventListener('click', () => ports.closePanel?.());
  }
  for (const [selector, name] of [
    ['refresh-targets', 'refresh'],
    ['connect-target', 'connect'],
    ['disconnect-target', 'close'],
    ['focus-target', 'external'],
  ])
    buttonIcon(get<HTMLButtonElement>('.' + selector), name!);
  let alive = true,
    importError: string | undefined,
    targets: StudioTarget[] = [],
    panel: ReturnType<typeof createCreatorPanel> | undefined,
    paneTarget: number | undefined;
  let stage: HTMLElement | undefined,
    refreshEpoch = 0,
    switchEpoch = 0;
  let pendingCommands = 0,
    latest: StudioConnectionState | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const backups = new Map<number, { value: EditorCheckpoint | undefined; origin: EditorRevision }>();
  const persist = () => {
    clearTimeout(recoveryTimer);
    for (const [target, { value, origin }] of backups) {
      backups.delete(target);
      void ports.recovery.write(target, value, origin).then(
        () => {
          if (alive) recoveryStatus.textContent = '';
        },
        (error: unknown) => {
          if (alive)
            recoveryStatus.textContent = `接続復旧用の保持に失敗しました。作品を保存してください。${error instanceof Error ? error.message : ''}`;
        },
      );
    }
  };
  const connection = ports.connect(render, (target, value, origin) => {
    backups.set(target, { value, origin });
    clearTimeout(recoveryTimer);
    const previous = latest?.target === target ? latest.state : undefined;
    if (!value || previous?.recoveryPending || (previous?.view.dirty && value.draft === value.saved)) persist();
    else recoveryTimer = setTimeout(persist, 180);
  });
  const safety = ports.mountSafety?.(root, connection);
  const dispatch = (command: EditCommand) => {
    if (!connection.isConnected || !connection.state?.active) return;
    importError = undefined;
    pendingCommands++;
    panel?.host.setAttribute('aria-busy', 'true');
    void connection.dispatch(command).finally(() => {
      pendingCommands--;
      panel?.host.setAttribute('aria-busy', String(pendingCommands > 0));
      if (!pendingCommands && latest) render(latest);
    });
  };
  keepSaved!.addEventListener('click', () => dispatch({ type: 'keep-saved' }));
  restoreDraft!.addEventListener('click', () => dispatch({ type: 'restore-draft' }));
  // A side panel's width (320–480, up to half a window) gets the one-column arrangement with tabs.
  const narrow = () => (doc.defaultView?.innerWidth ?? 0) < 720;
  let builtNarrow = narrow();
  const onResize = () => {
    if (alive && panel && latest && builtNarrow !== narrow()) render(latest);
  };
  doc.defaultView?.addEventListener('resize', onResize);
  // A file this page could not read or send never reaches the YouTube tab, so the page tells it in the
  // status line itself until the next command or import.
  const importFiles = (files: readonly File[], slot?: SkinSlot) => {
    if (!connection.isConnected) return;
    importError = undefined;
    void connection.import(files, slot).catch((error: unknown) => {
      importError = error instanceof Error ? error.message : '素材を読み込めませんでした。';
      if (latest) render(latest);
    });
  };
  const importSkin = (files: readonly File[], slot: SkinSlot) => importFiles(files, slot);
  // The page measures its parts only while the skin tool is open.
  const unsubscribeSkinPage = connection.skinPage?.subscribe((info) => panel?.setSkinPage(info));
  function render(value: StudioConnectionState) {
    if (!alive) return;
    latest = value;
    message.textContent =
      (ports.sidePanel && value.target !== undefined ? ports.hostName + ' #' + value.target + ' · ' : '') +
      value.message;
    message.dataset.connected = String(value.connected);
    recoveryChoice.hidden = !value.state?.recoveryPending || !value.state.active;
    keepSaved!.disabled = restoreDraft!.disabled = !value.connected || pendingCommands > 0;
    get<HTMLButtonElement>('.disconnect-target').disabled = !value.connected;
    get<HTMLButtonElement>('.focus-target').disabled = value.target === undefined;
    if (!value.state || (pendingCommands && value.connected && value.target === paneTarget)) return;
    if (!panel || paneTarget !== value.target || builtNarrow !== narrow()) {
      builtNarrow = narrow();
      panel?.destroy();
      mount.replaceChildren();
      paneTarget = value.target;
      const skinTargets = (targets.find((target) => target.id === value.target)?.targets ?? []).filter(
        (target) => target.skin,
      );
      panel = createCreatorPanel(
        doc,
        studioActions(
          dispatch,
          (files) => {
            importFiles(files);
          },
          (id) => connection.thumbnail(id),
        ),
        targets.find((target) => target.id === value.target)?.anchors ?? [],
        {
          preferences: ports.preferences,
          ...(ports.openSettings ? { onSettings: () => ports.openSettings!(connection.target) } : {}),
          timeline: connection.timeline,
          hostLabel: ports.hostName,
          // The arrangement follows the width; the surface (side panel or window) only sets transport.
          sidePanel: builtNarrow,
          surface: ports.sidePanel ? 'sidepanel' : 'window',
          ...(connection.importMotions
            ? {
                motions: {
                  import: (files, layer, labels, origin) => {
                    if (!connection.isConnected) return;
                    importError = undefined;
                    void connection.importMotions!(files, layer, labels, origin).catch((error: unknown) => {
                      importError = error instanceof Error ? error.message : '動作を読み込めませんでした。';
                      if (latest) render(latest);
                    });
                  },
                },
              }
            : {}),
          ...(skinTargets.length && ports.skinAssetUrl
            ? {
                skin: {
                  targets: skinTargets,
                  assetUrl: ports.skinAssetUrl,
                  import: (files: readonly File[], slot: SkinSlot) => importSkin(files, slot),
                },
              }
            : {}),
          onSurface: (surface) => {
            void connection.openWorkspace(surface).catch((error: unknown) => {
              message.textContent = error instanceof Error ? error.message : '切替できませんでした。';
            });
          },
        },
      );
      mount.append(panel.host);
      settingsButton.hidden = true;
      connectionBar.slot = 'connection';
      message.slot = 'connection-status';
      panel.host.append(connectionBar, message);
      if (closeButton) panel.host.append(closeButton);
      if (safety) panel.host.append(safety.header);
      if (!builtNarrow) {
        stage = doc.createElement('section');
        stage.className = 'studio-stage';
        stage.setAttribute('aria-label', '素材とプレビュー');
        stage.innerHTML = `<div class="preview-link"><strong>ライブキャンバス</strong><p>作品は${hostName}のタブで動きます。並べて見ると、パネルと作品を同時に確かめながら編集できます。</p><button class="stage-focus" type="button">${hostName}を表示</button>${ports.sidePanel ? '' : '<button class="stage-sidepanel" type="button">サイドパネルで開く</button>'}</div>`;
        panel.host.shadowRoot!.querySelector('.canvas-slot')!.append(stage);
        // A wide side panel shows the stage too; it is already the side panel.
        stage.querySelector('.stage-sidepanel')?.addEventListener('click', () => {
          void connection.openWorkspace('sidepanel').catch((error: unknown) => {
            message.textContent = error instanceof Error ? error.message : 'サイドパネルを開けませんでした。';
          });
        });
        stage.querySelector('.stage-focus')!.addEventListener('click', focusTarget);
      }
    }
    const ready = value.connected && value.state.active;
    panel.host.toggleAttribute('data-disconnected', !ready);
    panel.render({
      ...value.state.view,
      saving: value.state.view.saving || !ready || Boolean(value.state.recoveryPending),
      ...(importError ? { status: importError, error: true } : {}),
    });
  }
  async function refreshTargets() {
    const epoch = ++refreshEpoch;
    try {
      const list = (await connection.targets()).filter(
        (item) => !ports.sidePanel || connection.target === undefined || item.id === connection.target,
      );
      if (!alive || epoch !== refreshEpoch) return;
      const previous = connection.target ?? Number(targetSelect.value);
      targets = list;
      targetSelect.replaceChildren(new Option('対象を選ぶ', ''));
      for (const target of list) {
        const option = doc.createElement('option');
        option.value = String(target.id);
        option.textContent = `${target.enabled ? '' : 'OFF · '}#${target.id} ${target.title || target.siteId}`;
        targetSelect.append(option);
      }
      if (list.some((target) => target.id === previous)) targetSelect.value = String(previous);
      if (!list.length)
        message.textContent = `対応する編集対象がありません。${ports.hostName}を開いて一覧を更新してください。`;
    } catch {
      if (alive) message.textContent = 'タブ一覧を取得できませんでした。';
    }
  }
  async function selectTarget(target: number) {
    const epoch = ++switchEpoch;
    persist();
    try {
      const checkpoint = await ports.recovery.read(target);
      if (!alive || epoch !== switchEpoch) return;
      await connection.select(target, checkpoint);
    } catch (error) {
      if (alive) message.textContent = error instanceof Error ? error.message : '接続できませんでした。';
    }
  }
  function focusTarget() {
    void connection.focusTarget().catch(() => {
      if (alive) message.textContent = '編集対象が閉じられました。一覧を更新してください。';
    });
  }
  get('.refresh-targets').addEventListener('click', () => {
    void refreshTargets();
  });
  targetSelect.addEventListener('change', () => {
    if (targetSelect.value) void selectTarget(Number(targetSelect.value));
    else {
      persist();
      connection.stop();
    }
  });
  get('.connect-target').addEventListener('click', () => {
    if (targetSelect.value) {
      if (connection.target === Number(targetSelect.value)) connection.reconnect();
      else void selectTarget(Number(targetSelect.value));
    }
  });
  get('.disconnect-target').addEventListener('click', () => {
    persist();
    connection.stop();
  });
  get('.focus-target').addEventListener('click', focusTarget);
  const consumedKeys = new Set<string>();
  const keydown = (event: KeyboardEvent) => {
    if (
      !connection.isConnected ||
      !connection.state?.active ||
      connection.state.recoveryPending ||
      panel?.host.hasAttribute('data-around-scrubbing') ||
      event.isComposing ||
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.hasAttribute('data-around-timeline-control') ||
              node.matches('input,textarea,select,summary,dialog,[role="tab"],[role="separator"],[role="menuitem"]') ||
              node.isContentEditable),
        )
    )
      return;
    const command = shortcutCommand(event, connection.state.view, true);
    if (!command) return;
    dispatch(command);
    consumedKeys.add(event.code || event.key);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const keyup = (event: KeyboardEvent) => {
    if (consumedKeys.delete(event.code || event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const dragover = (event: DragEvent) => {
    if (connection.isConnected && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };
  const drop = (event: DragEvent) => {
    if (connection.isConnected && event.dataTransfer?.files.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const files = [...event.dataTransfer.files];
      // Skin drop zones name their slot; while dressing parts, a drop is never a new image layer.
      const zone = event
        .composedPath()
        .find((node): node is HTMLElement => node instanceof HTMLElement && Boolean(node.dataset.skinSlot));
      if (zone || connection.state?.view.tool === 'skin')
        importSkin(files, (zone?.dataset.skinSlot as SkinSlot | undefined) ?? 'normal');
      else importFiles(files);
    }
  };
  // Bubble phase lets menus and focused input controls own their shortcuts first.
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('keyup', keyup, true);
  doc.addEventListener('dragover', dragover);
  doc.addEventListener('drop', drop, true);
  return {
    async start(target?: number) {
      await refreshTargets();
      if (!alive) return;
      const selected =
        targets.find((item) => item.id === target) ??
        (!ports.sidePanel && targets.length === 1 ? targets[0] : undefined);
      if (selected) {
        targetSelect.value = String(selected.id);
        await selectTarget(selected.id);
      }
    },
    destroy() {
      safety?.destroy();
      unsubscribeSkinPage?.();
      doc.defaultView?.removeEventListener('resize', onResize);
      persist();
      alive = false;
      connection.destroy();
      panel?.destroy();
      doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('keyup', keyup, true);
      doc.removeEventListener('dragover', dragover);
      doc.removeEventListener('drop', drop, true);
    },
  };
}
