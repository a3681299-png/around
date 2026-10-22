import type { SettingsEntry } from './types';

// Player selectors and YouTube's button class belong to the adapter, not the UI.
const controlsSelector = '#movie_player .ytp-right-controls';
const playerSelector = '.html5-video-player';
const refreshEvents = ['yt-navigate-finish', 'yt-page-data-updated'] as const;

export function mountYouTubeSettings(doc: Document, view: Window, entry: SettingsEntry): () => void {
  let controls: Element | null = null;
  let player: Element | null = null;
  let frame: number | undefined;
  entry.setAvoidRect?.(() => player?.getBoundingClientRect());
  entry.button.classList.add('ytp-button');

  const refresh = () => {
    frame = undefined;
    const container = doc.fullscreenElement ?? doc.body ?? doc.documentElement;
    if (
      player?.isConnected &&
      controls?.isConnected &&
      controls.firstElementChild === entry.button &&
      entry.panel.parentElement === container
    )
      return;

    const nextControls = doc.querySelector(controlsSelector);
    const nextPlayer = nextControls?.closest(playerSelector) ?? null;
    if (!nextControls || !nextPlayer) {
      entry.close();
      entry.button.remove();
      entry.panel.remove();
      controls = player = null;
      return;
    }
    if (nextControls !== controls || nextPlayer !== player || !entry.panel.isConnected) entry.close();
    controls = nextControls;
    player = nextPlayer;
    if (controls.firstElementChild !== entry.button) controls.prepend(entry.button);
    // Normal settings live outside the video. Fullscreen must use its top-layer subtree.
    if (entry.panel.parentElement !== container) {
      container.append(entry.panel);
      entry.reposition?.();
    }
  };

  const schedule = () => {
    if (frame === undefined) frame = view.requestAnimationFrame(refresh);
  };
  const onNavigation = () => {
    entry.close();
    schedule();
  };

  refresh();
  const observer = new MutationObserver(schedule);
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id'],
  });
  doc.addEventListener('yt-navigate-start', onNavigation);
  refreshEvents.forEach((event) => doc.addEventListener(event, schedule));
  view.addEventListener('popstate', onNavigation);
  view.addEventListener('pageshow', schedule);
  doc.addEventListener('fullscreenchange', schedule);

  return () => {
    observer.disconnect();
    doc.removeEventListener('yt-navigate-start', onNavigation);
    refreshEvents.forEach((event) => doc.removeEventListener(event, schedule));
    view.removeEventListener('popstate', onNavigation);
    view.removeEventListener('pageshow', schedule);
    doc.removeEventListener('fullscreenchange', schedule);
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    entry.close();
    entry.button.remove();
    entry.panel.remove();
  };
}
