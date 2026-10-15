import { OPEN_CREATOR_EDITOR, type OpenEditorResponse } from './messages';

/** Only the active tab ID is needed, so no tabs/activeTab permission is added. */
export function mountCreatorLauncher(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const section = doc.createElement('section');
  section.className = 'creator-launcher';
  const button = doc.createElement('button');
  button.id = 'creator-editor-open';
  button.type = 'button';
  button.textContent = 'カードをデザイン（実験）';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.id = 'creator-launch-status';
  status.textContent = 'YouTube上のカードを選択して編集します。';
  section.append(button, status);
  container.append(section);
  let alive = true;
  const open = async () => {
    button.disabled = true;
    status.textContent = '編集モードを開いています…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('タブが見つかりません。');
      const response = await chrome.tabs.sendMessage<{ type: string }, OpenEditorResponse>(tab.id, { type: OPEN_CREATOR_EDITOR });
      if (!alive) return;
      status.textContent = response?.ok ? 'YouTubeで動画カードをクリックしてください。' : response?.error ?? '編集モードを開けませんでした。';
    } catch {
      if (alive) status.textContent = 'デスクトップ版YouTubeを開いてください。拡張を更新した後はYouTubeを再読み込みしてください。';
    } finally {
      if (alive) button.disabled = false;
    }
  };
  const onClick = () => { void open(); };
  button.addEventListener('click', onClick);
  return () => { alive = false; button.removeEventListener('click', onClick); section.remove(); };
}
