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
      <span class="ww-window-status" aria-hidden="true">RETRO MODE : ON</span>
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
  let geometryFrame: number | undefined;
  let watchedGeometry: Element[] = [];
  let obstacles: Element[] = [];
  let collisionObserver: IntersectionObserver | undefined;
  let observedObstacles: Element[] = [];
  let collisionKey = '';
  // Keep this reservation stable even when the footer yields. Otherwise hiding
  // it could enlarge the player, retrigger a collision, and create a layout loop.
  let reservedHeight = 0;

  const setProperty = (name: string, value: string) => {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };
  const clearGeometry = () => {
    if (geometryFrame !== undefined) view.cancelAnimationFrame(geometryFrame);
    geometryFrame = undefined;
    geometryObserver.disconnect();
    collisionObserver?.disconnect(); collisionObserver = undefined;
    observedObstacles = []; collisionKey = '';
    watchedGeometry = []; obstacles = []; reservedHeight = 0;
    root.style.removeProperty('--ww-statusbar-reserved-height');
    root.style.removeProperty('--ww-player-viewport-height');
    status.removeAttribute('data-ww-obstructed');
  };
  const measureGeometry = () => {
    geometryFrame = undefined;
    if (destroyed || !status.isConnected || !masthead) return;
    const fullscreen = Boolean(doc.fullscreenElement || doc.querySelector('ytd-watch-flexy[fullscreen]'));
    if (fullscreen) {
      status.setAttribute('data-ww-obstructed', '');
      return;
    }
    const rect = status.getBoundingClientRect();
    if (rect.height > 0) reservedHeight = Math.ceil(rect.height);
    setProperty('--ww-statusbar-reserved-height', `${reservedHeight}px`);
    const viewport = view.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : view.innerHeight;
    const headerBottom = Math.max(0, masthead.getBoundingClientRect().bottom);
    const paneHeight = playerBar.isConnected ? playerBar.getBoundingClientRect().height : 0;
    // Native YouTube layout consumes these budgets while retaining its own
    // aspect-ratio machinery. Unknown layouts are handled by collision yielding.
    const budget = Math.max(0, Math.floor(viewportBottom - headerBottom - paneHeight - reservedHeight - 24));
    setProperty('--ww-player-viewport-height', `${budget}px`);
    const top = Math.min(rect.top, viewportBottom - reservedHeight);
    const stripTop = Math.max(0, Math.floor(top));
    const stripBottom = Math.max(0, Math.floor(view.innerHeight - viewportBottom));
    const key = `${stripTop}:${stripBottom}`;
    if (key !== collisionKey || obstacles.length !== observedObstacles.length
      || obstacles.some((element, index) => element !== observedObstacles[index])) {
      collisionObserver?.disconnect();
      // Browser-managed intersection catches geometry-only native transitions
      // (theater classes, menus, animated miniplayers) with no polling loop.
      collisionObserver = new IntersectionObserver(scheduleGeometry, {
        rootMargin: `-${stripTop}px 0px -${stripBottom}px 0px`,
      });
      obstacles.forEach(element => collisionObserver!.observe(element));
      observedObstacles = [...obstacles]; collisionKey = key;
    }
    const intersects = (element: Element) => {
      if (!element.isConnected || status.contains(element) || chrome.contains(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > top && box.top < viewportBottom
        && box.right > rect.left && box.left < rect.right;
    };
    // A decorative footer must never win over native interaction. Checking whole
    // players also protects currently faded-out controls and floating miniplayers.
    const obstruction = obstacles.some(intersects)
      || Boolean(doc.activeElement && intersects(doc.activeElement) && doc.activeElement !== doc.body && doc.activeElement !== root);
    status.toggleAttribute('data-ww-obstructed', obstruction);
  };
  const scheduleGeometry = () => {
    if (destroyed || geometryFrame !== undefined) return;
    geometryFrame = view.requestAnimationFrame(measureGeometry);
  };
  const yieldThenMeasure = () => {
    // Hide immediately on scroll/resize, before the next paint or hit test.
    status.setAttribute('data-ww-obstructed', '');
    scheduleGeometry();
  };
  const geometryObserver = new ResizeObserver(yieldThenMeasure);
  const refreshGeometry = () => {
    obstacles = [...doc.querySelectorAll(
      '#movie_player, .html5-video-player, ytd-miniplayer, video, iframe, button, input, select, textarea, a[href], [role="button"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )];
    const nodes = [status, masthead, playerBar, doc.querySelector('#movie_player'), doc.querySelector('ytd-page-manager')]
      .filter((node): node is Element => Boolean(node));
    if (nodes.length !== watchedGeometry.length || nodes.some((node, index) => node !== watchedGeometry[index])) {
      geometryObserver.disconnect();
      nodes.forEach(node => geometryObserver.observe(node));
      watchedGeometry = nodes;
    }
    scheduleGeometry();
  };

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
      clearGeometry();
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
    // Stay outside the complete native player boundary, including its absolute
    // error/ad overlays. Never reparent or resize the player or video.
    const player = doc.querySelector('#movie_player');
    const anchor = player?.closest('#player') ?? player?.closest('#player-container-outer') ?? player?.closest('ytd-player') ?? player;
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
    refreshGeometry();
  };
  doc.addEventListener('visibilitychange', syncClock);
  doc.addEventListener('scroll', yieldThenMeasure, { capture: true, passive: true });
  doc.addEventListener('focusin', yieldThenMeasure);
  doc.addEventListener('fullscreenchange', yieldThenMeasure);
  view.addEventListener('resize', yieldThenMeasure, { passive: true });
  view.visualViewport?.addEventListener('resize', yieldThenMeasure, { passive: true });
  view.visualViewport?.addEventListener('scroll', yieldThenMeasure, { passive: true });
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      if (timer !== undefined) view.clearInterval(timer);
      timer = undefined;
      titleObserver.disconnect(); titleNodes = [];
      doc.removeEventListener('visibilitychange', syncClock);
      doc.removeEventListener('scroll', yieldThenMeasure, true);
      doc.removeEventListener('focusin', yieldThenMeasure);
      doc.removeEventListener('fullscreenchange', yieldThenMeasure);
      view.removeEventListener('resize', yieldThenMeasure);
      view.visualViewport?.removeEventListener('resize', yieldThenMeasure);
      view.visualViewport?.removeEventListener('scroll', yieldThenMeasure);
      clearGeometry();
      chrome.remove(); playerBar.remove(); playlistBar.remove(); status.remove();
      masthead = null;
      root.removeAttribute('data-ww-window-chrome');
      root.style.removeProperty('--ww-native-header-height');
    },
  };
}
