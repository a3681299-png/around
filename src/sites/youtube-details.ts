import type { SiteFeatureInstance } from './types';

const DETAILS = ['(・ω・)  .:*:.', '(^_^)  [::]', '(o_o)  +--+', '( -_- )  ...', '(=^.^=)  ~*~', '(^-^)  <[]>', '(・_・)  *.+'];

/** A local-calendar-day choice: no storage, randomness, network, or user tracking. */
export function dailyYouTubeDetail(date: Date): string {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return DETAILS[((day % DETAILS.length) + DETAILS.length) % DETAILS.length]!;
}

/** Only decorate owned chrome or measured empty header space, never the video. */
export function mountYouTubeDetails(doc: Document): SiteFeatureInstance {
  const view = doc.defaultView!;
  const detail = doc.createElement('span');
  detail.id = 'web-world-themes-daily-detail';
  detail.setAttribute('aria-hidden', 'true');
  let timer: number | undefined;
  let frame: number | undefined;
  let destroyed = false;

  const updateText = () => {
    const text = dailyYouTubeDetail(new Date());
    if (detail.textContent !== text) detail.textContent = text;
  };
  const clearTimer = () => {
    if (timer !== undefined) view.clearTimeout(timer);
    timer = undefined;
  };
  const scheduleDay = () => {
    if (timer !== undefined || destroyed || doc.hidden) return;
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = view.setTimeout(() => {
      timer = undefined;
      updateText();
      scheduleDay();
    }, Math.max(1000, nextDay.getTime() - now.getTime()));
  };
  const place = () => {
    frame = undefined;
    if (destroyed) return;
    const status = doc.querySelector<HTMLElement>('.ww-window-status');
    if (status && view.getComputedStyle(status).display !== 'none') {
      detail.classList.remove('ww-detail-in-header');
      detail.style.removeProperty('left'); detail.style.removeProperty('top');
      if (detail.parentElement !== status) status.append(detail);
      return;
    }
    // With window chrome OFF this feature remains independent. Use an actual
    // gap in the native masthead only if there is room; never squeeze controls.
    const masthead = doc.querySelector('ytd-masthead');
    const container = masthead?.querySelector(':scope > #container');
    if (!masthead || !container) { detail.remove(); return; }
    const bounds = container.getBoundingClientRect();
    const occupied = [...container.children].filter(child => child !== detail)
      .map(child => child.getBoundingClientRect()).filter(box => box.width && box.height)
      .sort((a, b) => a.left - b.left);
    let left = bounds.left + 8;
    let gap: { left: number; width: number } | undefined;
    for (const box of [...occupied, { left: bounds.right - 8, right: bounds.right }]) {
      if (box.left - left >= 140 && (!gap || box.left - left > gap.width)) gap = { left, width: box.left - left };
      left = Math.max(left, box.right + 8);
    }
    if (!gap || bounds.height < 20) { detail.remove(); return; }
    detail.classList.add('ww-detail-in-header');
    const x = `${Math.round(gap.left + (gap.width - 132) / 2)}px`;
    const y = `${Math.round(bounds.top + (bounds.height - 12) / 2)}px`;
    if (detail.style.left !== x) detail.style.left = x;
    if (detail.style.top !== y) detail.style.top = y;
    if (detail.parentElement !== masthead) masthead.append(detail);
  };
  const schedulePlacement = () => {
    if (!destroyed && frame === undefined) frame = view.requestAnimationFrame(place);
  };
  const syncVisibility = () => {
    clearTimer();
    if (destroyed) return;
    updateText();
    scheduleDay();
    schedulePlacement();
  };
  const refresh = () => {
    if (destroyed) return;
    updateText();
    scheduleDay();
    schedulePlacement();
  };
  doc.addEventListener('visibilitychange', syncVisibility);
  view.addEventListener('resize', schedulePlacement, { passive: true });
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      clearTimer();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
      doc.removeEventListener('visibilitychange', syncVisibility);
      view.removeEventListener('resize', schedulePlacement);
      detail.remove();
    },
  };
}

type Pane = 'player' | 'playlist' | 'header';

/** Focus is real document focus plus the pane last focused or pointer-activated. */
export function mountYouTubeFocus(doc: Document): SiteFeatureInstance {
  const root = doc.documentElement;
  const view = doc.defaultView!;
  let destroyed = false;
  const paneFor = (target: EventTarget | null): Pane | undefined => {
    if (!(target instanceof Element)) return undefined;
    if (target.closest('ytd-playlist-panel-renderer, #web-world-themes-playlist-titlebar')) return 'playlist';
    if (target.closest('#movie_player, #player, #player-container-outer, #web-world-themes-player-titlebar')) return 'player';
    if (target.closest('ytd-masthead')) return 'header';
    return undefined;
  };
  let pane = paneFor(doc.activeElement);
  const refresh = () => {
    if (destroyed) return;
    const active = doc.hasFocus() && !doc.hidden;
    root.toggleAttribute('data-ww-document-active', active);
    const paneExists = pane === 'player' ? doc.querySelector('#movie_player')
      : pane === 'playlist' ? doc.querySelector('ytd-playlist-panel-renderer')
        : pane === 'header' ? doc.querySelector('ytd-masthead') : null;
    if (!paneExists) pane = undefined;
    if (active && pane) {
      if (root.getAttribute('data-ww-active-pane') !== pane) root.setAttribute('data-ww-active-pane', pane);
    } else root.removeAttribute('data-ww-active-pane');
  };
  const activate = (event: Event) => {
    if (!event.isTrusted) return;
    pane = paneFor(event.composedPath()[0] ?? event.target);
    refresh();
  };
  const focusOut = () => view.queueMicrotask(() => {
    if (!destroyed && doc.activeElement !== doc.body) {
      pane = paneFor(doc.activeElement);
      refresh();
    }
  });
  doc.addEventListener('pointerdown', activate, true);
  doc.addEventListener('focusin', activate, true);
  doc.addEventListener('focusout', focusOut, true);
  doc.addEventListener('visibilitychange', refresh);
  view.addEventListener('focus', refresh);
  view.addEventListener('blur', refresh);
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      doc.removeEventListener('pointerdown', activate, true);
      doc.removeEventListener('focusin', activate, true);
      doc.removeEventListener('focusout', focusOut, true);
      doc.removeEventListener('visibilitychange', refresh);
      view.removeEventListener('focus', refresh);
      view.removeEventListener('blur', refresh);
      root.removeAttribute('data-ww-document-active');
      root.removeAttribute('data-ww-active-pane');
    },
  };
}
