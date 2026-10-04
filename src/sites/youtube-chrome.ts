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
      <a href="/">ホーム</a><a href="/feed/subscriptions">登録チャンネル</a><a href="/feed/history">履歴</a>
      <span class="ww-window-status" aria-hidden="true">RETRO MODE : ON (・ω・)</span>
    </nav>`;
  return chrome;
}

function createPaneTitlebar(doc: Document, id: string, kind: string): HTMLElement {
  const bar = doc.createElement('div');
  bar.id = `web-world-themes-${id}-titlebar`;
  bar.className = 'ww-pane-titlebar';
  // The original accessible title remains untouched; this is a decorative duplicate.
  bar.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('span');
  label.className = 'ww-pane-kind';
  label.textContent = kind;
  const title = doc.createElement('span');
  title.className = 'ww-pane-title';
  const grip = doc.createElement('span');
  grip.className = 'ww-pane-grip';
  bar.append(label, title, grip);
  return bar;
}

/** Every added node, title observer, and clock timer belongs to this one feature. */
export function mountYouTubeChrome(doc: Document): SiteFeatureInstance {
  const root = doc.documentElement;
  const view = doc.defaultView!;
  const chrome = createYouTubeChrome(doc);
  const playerBar = createPaneTitlebar(doc, 'player', 'PLAYER');
  const playlistBar = createPaneTitlebar(doc, 'playlist', 'PLAYLIST');
  const status = doc.createElement('div');
  status.id = 'web-world-themes-statusbar';
  status.setAttribute('aria-live', 'off');
  status.innerHTML = '<span class="ww-status-message ww-status-cell">YouTube.exe / Ready</span><span class="ww-status-cell ww-status-detail" aria-hidden="true">SILVER DESKTOP</span><time id="web-world-themes-clock" aria-label="現在時刻"></time>';
  const clock = status.querySelector<HTMLTimeElement>('time')!;
  let timer: number | undefined;
  let masthead: HTMLElement | null = null;
  let titleNodes: Element[] = [];
  let destroyed = false;

  const updateClock = () => {
    const now = new Date();
    const text = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (clock.textContent !== text) {
      clock.textContent = text;
      clock.dateTime = now.toISOString();
    }
  };
  const syncClock = () => {
    if (timer !== undefined) { view.clearInterval(timer); timer = undefined; }
    if (destroyed || !status.isConnected) return;
    updateClock();
    if (doc.hidden) return;
    timer = view.setInterval(updateClock, 1000);
  };
  const setTitle = (bar: HTMLElement, text: string) => {
    const label = bar.querySelector<HTMLElement>('.ww-pane-title')!;
    if (label.textContent !== text) { label.textContent = text; bar.title = text; }
  };
  const playerTitle = () => doc.querySelector('ytd-watch-metadata h1')
    ?? doc.querySelector('ytd-video-primary-info-renderer h1')
    ?? doc.querySelector('.ytp-title-link');
  const playlistTitle = () => doc.querySelector('ytd-playlist-panel-renderer #title, ytd-playlist-panel-renderer .title');
  const refreshTitles = () => {
    setTitle(playerBar, playerTitle()?.textContent?.trim() || doc.title.replace(/\s*[-–]\s*YouTube\s*$/, '') || 'YouTube');
    setTitle(playlistBar, playlistTitle()?.textContent?.trim() || '再生リスト');
  };
  const titleObserver = new MutationObserver(refreshTitles);
  const refresh = () => {
    if (destroyed) return;
    const next = doc.querySelector<HTMLElement>('ytd-masthead');
    if (!next) {
      chrome.remove(); status.remove(); playerBar.remove(); playlistBar.remove();
      masthead = null;
      titleObserver.disconnect(); titleNodes = [];
      root.removeAttribute('data-ww-window-chrome');
      root.style.removeProperty('--ww-native-header-height');
      syncClock();
      return;
    }
    if (next !== masthead) {
      const height = next.querySelector('#container')?.getBoundingClientRect().height ?? 56;
      root.style.setProperty('--ww-native-header-height', `${height >= 40 && height <= 80 ? height : 56}px`);
      masthead = next;
    }
    if (next.firstElementChild !== chrome) next.prepend(chrome);
    root.setAttribute('data-ww-window-chrome', '');
    if (!status.isConnected) { (doc.body ?? root).append(status); syncClock(); }
    chrome.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      if (new URL(link.href, doc.URL).pathname === doc.location.pathname) {
        if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page');
      } else link.removeAttribute('aria-current');
    });
    // Insert beside the native player wrapper; never reparent or resize the video.
    const player = doc.querySelector('#movie_player');
    const anchor = player?.closest('#player-container-outer') ?? player?.closest('ytd-player') ?? player;
    if (anchor?.parentElement && doc.location.pathname === '/watch') {
      if (anchor.previousElementSibling !== playerBar) anchor.before(playerBar);
    } else playerBar.remove();
    const playlist = doc.querySelector('ytd-playlist-panel-renderer');
    if (playlist) {
      if (playlist.firstElementChild !== playlistBar) playlist.prepend(playlistBar);
    } else playlistBar.remove();
    const nodes = [playerTitle(), playlistTitle(), doc.querySelector('head > title')].filter((node): node is Element => Boolean(node));
    if (nodes.length !== titleNodes.length || nodes.some((node, index) => node !== titleNodes[index])) {
      titleObserver.disconnect();
      nodes.forEach(node => titleObserver.observe(node, { childList: true, characterData: true, subtree: true }));
      titleNodes = nodes;
    }
    refreshTitles();
  };
  doc.addEventListener('visibilitychange', syncClock);
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      if (timer !== undefined) view.clearInterval(timer);
      timer = undefined;
      titleObserver.disconnect(); titleNodes = [];
      doc.removeEventListener('visibilitychange', syncClock);
      chrome.remove(); playerBar.remove(); playlistBar.remove(); status.remove();
      masthead = null;
      root.removeAttribute('data-ww-window-chrome');
      root.style.removeProperty('--ww-native-header-height');
    },
  };
}
