import { requestStudioSurface } from '../browser/side-panel';
import {
  OPEN_CREATOR_EDITOR,
  OPEN_INPAGE_STUDIO,
  OPEN_SIDE_PANEL,
  PREPARE_SIDE_PANEL,
  type OpenEditorResponse,
} from './messages';

/** Only the active tab ID is needed, so no tabs/activeTab permission is added. */
export function mountCreatorLauncher(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const section = doc.createElement('section');
  section.className = 'creator-launcher';
  const button = doc.createElement('button');
  button.id = 'creator-editor-open';
  button.type = 'button';
  button.textContent = 'デザインを編集（実験）';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.id = 'creator-launch-status';
  status.textContent = 'YouTube上でカードと画像素材を編集します。';
  const studio = doc.createElement('button');
  studio.id = 'creator-studio-open';
  studio.type = 'button';
  studio.textContent = 'Studioを開く（別ウィンドウ）';
  const inpage = doc.createElement('button');
  inpage.id = 'creator-studio-inpage';
  inpage.type = 'button';
  inpage.textContent = 'Studioを開く（このタブ）';
  const sidepanel = doc.createElement('button');
  sidepanel.id = 'creator-studio-sidepanel';
  sidepanel.type = 'button';
  sidepanel.textContent = 'Studioを開く（Chromeサイドパネル）';
  sidepanel.disabled = true;
  inpage.textContent = '従来のインページStudio（切り戻し）';
  section.append(sidepanel, inpage, studio, button, status);
  container.querySelector('.ww-editor-body')!.append(section);
  const direct = container.querySelector<HTMLButtonElement>('#creator-editor-direct')!;
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
        if (alive) direct.disabled = sidepanel.disabled = !result?.ok;
      }
    })
    .catch(() => {
      if (alive) status.textContent = 'サイドパネルの準備に失敗しました。拡張を再読み込みしてください。';
    });
  const onSidePanel = () => {
    void requestStudioSurface(OPEN_SIDE_PANEL, targetTab).then(
      () => {
        if (alive) status.textContent = 'Chromeサイドパネルで編集中です。';
      },
      (error: unknown) => {
        if (alive) status.textContent = error instanceof Error ? error.message : 'サイドパネルを開けませんでした。';
      },
    );
  };
  sidepanel.addEventListener('click', onSidePanel);
  direct.addEventListener('click', onSidePanel);
  const open = async (message = OPEN_CREATOR_EDITOR) => {
    button.disabled = true;
    status.textContent = '編集モードを開いています…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = requestedTarget ?? tab?.id;
      if (id === undefined) throw new Error('タブが見つかりません。');
      const response = await chrome.tabs.sendMessage<{ type: string }, OpenEditorResponse>(id, { type: message });
      if (!alive) return;
      status.textContent = response?.ok
        ? 'YouTubeでカードを選ぶか、画像を追加してください。'
        : (response?.error ?? '編集モードを開けませんでした。');
    } catch {
      if (alive)
        status.textContent =
          'デスクトップ版YouTubeを開いてください。拡張を更新した後はYouTubeを再読み込みしてください。';
    } finally {
      if (alive) button.disabled = false;
    }
  };
  const openStudio = async () => {
    studio.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.windows.create({
        url:
          chrome.runtime.getURL('studio/index.html') +
          ((requestedTarget ?? tab?.id) === undefined ? '' : '?target=' + (requestedTarget ?? tab?.id)),
        type: 'popup',
        width: 1440,
        height: 900,
      });
      if (alive) status.textContent = 'Studioを開きました。実際のYouTubeタブと並べて編集できます。';
    } catch {
      if (alive) status.textContent = 'Studioを開けませんでした。拡張を再読み込みしてください。';
    } finally {
      if (alive) studio.disabled = false;
    }
  };
  const onStudio = () => {
    void openStudio();
  };
  studio.addEventListener('click', onStudio);
  const onClick = () => {
    void open();
  };
  const onInpage = () => {
    void open(OPEN_INPAGE_STUDIO);
  };
  inpage.addEventListener('click', onInpage);
  button.addEventListener('click', onClick);
  return () => {
    alive = false;
    sidepanel.removeEventListener('click', onSidePanel);
    direct.removeEventListener('click', onSidePanel);
    button.removeEventListener('click', onClick);
    inpage.removeEventListener('click', onInpage);
    studio.removeEventListener('click', onStudio);
    section.remove();
  };
}
