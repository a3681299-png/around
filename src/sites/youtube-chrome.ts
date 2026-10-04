import type { SiteFeatureInstance } from './types';

/** This adapter owns navigation, site labels, and header geometry. Themes style it. */
export function createYouTubeChrome(doc: Document): HTMLElement {
  const chrome = doc.createElement('div');
  chrome.id = 'web-world-themes-window-chrome';
  chrome.innerHTML = `
    <div class="ww-titlebar" data-ww-surface="titlebar">
      <span class="ww-app-icon" aria-hidden="true">▶</span>
      <span class="ww-window-title">YouTube.exe</span>
      <span class="ww-display-led" aria-hidden="true"></span>
      <span class="ww-display-tag" aria-hidden="true">PERSONAL CHANNEL / 2003</span>
      <span class="ww-window-controls" aria-hidden="true"><span>─</span><span>□</span><span>×</span></span>
    </div>
    <nav class="ww-menubar" data-ww-surface="menubar" aria-label="YouTube ナビゲーション">
      <a href="/">ホーム</a>
      <a href="/feed/subscriptions">登録チャンネル</a>
      <a href="/feed/history">履歴</a>
      <span class="ww-window-status" aria-hidden="true">RETRO MODE : ON (・ω・)</span>
    </nav>`;
  return chrome;
}

/** The optional feature can be removed without disconnecting the base theme. */
export function mountYouTubeChrome(doc: Document): SiteFeatureInstance {
  const root = doc.documentElement;
  const chrome = createYouTubeChrome(doc);
  let masthead: HTMLElement | null = null;
  const refresh = () => {
    const next = doc.querySelector<HTMLElement>('ytd-masthead');
    if (!next) {
      chrome.remove();
      masthead = null;
      root.removeAttribute('data-ww-window-chrome');
      root.style.removeProperty('--ww-native-header-height');
      return;
    }
    if (next !== masthead) {
      // Measure only the native toolbar, never our added rows.
      const height = next.querySelector('#container')?.getBoundingClientRect().height ?? 56;
      root.style.setProperty('--ww-native-header-height', `${height >= 40 && height <= 80 ? height : 56}px`);
      masthead = next;
    }
    if (next.firstElementChild !== chrome) next.prepend(chrome);
    root.setAttribute('data-ww-window-chrome', '');
    chrome.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      if (new URL(link.href, doc.URL).pathname === doc.location.pathname) {
        if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page');
      } else link.removeAttribute('aria-current');
    });
  };
  refresh();
  return {
    refresh,
    destroy() {
      chrome.remove();
      masthead = null;
      root.removeAttribute('data-ww-window-chrome');
      root.style.removeProperty('--ww-native-header-height');
    },
  };
}
