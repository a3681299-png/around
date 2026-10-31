import { requestStudioSurface } from '../browser/side-panel';
import { OPEN_SIDE_PANEL, OPEN_STUDIO_WINDOW, PREPARE_SIDE_PANEL, type OpenEditorResponse } from './messages';

/** The popup's two ways into the editor: the side panel (S) and the editor's own window (W).
 * Only the active tab ID is needed, so no tabs/activeTab permission is added. */
export function mountCreatorLauncher(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const direct = container.querySelector<HTMLButtonElement>('#creator-editor-direct')!,
    separate = container.querySelector<HTMLButtonElement>('#creator-editor-window')!,
    status = container.querySelector<HTMLElement>('#creator-launch-status')!;
  const requested = new URL(doc.URL).searchParams.get('target');
  const requestedTarget =
    requested && /^\d+$/.test(requested) && Number.isSafeInteger(Number(requested)) ? Number(requested) : undefined;
  let alive = true,
    targetTab: number | undefined;
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      targetTab = requestedTarget ?? tab?.id;
      if (targetTab !== undefined) {
        const result = (await chrome.runtime.sendMessage({
          type: PREPARE_SIDE_PANEL,
          tabId: targetTab,
        })) as OpenEditorResponse;
        if (alive) direct.disabled = separate.disabled = !result?.ok;
      }
    })
    .catch(() => {
      if (alive) status.textContent = 'サイドパネルの準備に失敗しました。拡張を再読み込みしてください。';
    });
  const open = (type: typeof OPEN_SIDE_PANEL | typeof OPEN_STUDIO_WINDOW) => {
    // The side panel opens only within the click, so its tab is the one found when the popup
    // opened; the window has no such limit and takes the tab active at the click.
    const tab =
      type === OPEN_SIDE_PANEL
        ? Promise.resolve(targetTab)
        : chrome.tabs
            .query({ active: true, currentWindow: true })
            .then(([active]) => requestedTarget ?? active?.id ?? targetTab);
    void tab
      .then((id) => requestStudioSurface(type, id))
      .then(
        () => {
          if (alive)
            status.textContent =
              type === OPEN_SIDE_PANEL ? 'サイドパネルで編集中です。' : 'エディターを別ウィンドウで開きました。';
        },
        (error: unknown) => {
          if (alive) status.textContent = error instanceof Error ? error.message : 'エディターを開けませんでした。';
        },
      );
  };
  const onDirect = () => open(OPEN_SIDE_PANEL);
  const onSeparate = () => open(OPEN_STUDIO_WINDOW);
  direct.addEventListener('click', onDirect);
  separate.addEventListener('click', onSeparate);
  return () => {
    alive = false;
    direct.removeEventListener('click', onDirect);
    separate.removeEventListener('click', onSeparate);
  };
}
