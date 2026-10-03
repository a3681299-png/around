/** The adapter owns the site's title and navigation; the theme only styles this markup. */
export function createYouTubeChrome(doc: Document): HTMLElement {
  const chrome = doc.createElement('div');
  chrome.id = 'web-world-themes-window-chrome';
  chrome.innerHTML = `
    <div class="ww-titlebar" data-ww-surface="titlebar">
      <span class="ww-app-icon" aria-hidden="true">▶</span>
      <span class="ww-window-title">YouTube.exe</span>
      <span class="ww-window-controls" aria-hidden="true"><span>─</span><span>□</span><span>×</span></span>
    </div>
    <nav class="ww-menubar" data-ww-surface="menubar" aria-label="YouTube ナビゲーション">
      <a href="/">ホーム</a>
      <a href="/feed/subscriptions">登録チャンネル</a>
      <a href="/feed/history">履歴</a>
      <span class="ww-window-status">YouTube / retro</span>
    </nav>`;
  return chrome;
}
