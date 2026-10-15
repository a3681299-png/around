/** All native component and navigation knowledge stays in the site adapter. */
export const VIDEO_CARD_SELECTOR = 'yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer';

export function videoCardContainer(element: Element): Element | null {
  let card = element.closest(VIDEO_CARD_SELECTOR);
  let parent = card?.parentElement?.closest(VIDEO_CARD_SELECTOR);
  while (parent) { card = parent; parent = card.parentElement?.closest(VIDEO_CARD_SELECTOR); }
  return card;
}

export function isYouTubeVideoCard(element: Element): boolean {
  if (!element.matches(VIDEO_CARD_SELECTOR) || element.parentElement?.closest(VIDEO_CARD_SELECTOR)) return false;
  if (element.closest('ytm-shorts-lockup-view-model, ytd-playlist-panel-renderer, ytd-ad-slot-renderer, ytd-display-ad-renderer')) return false;
  if (element.querySelector('yt-collection-thumbnail-view-model')) return false;
  const contentType = element.getAttribute('content-type');
  if (contentType && contentType.toLowerCase() !== 'video') return false;
  return [...element.querySelectorAll<HTMLAnchorElement>('a[href]')].some((link) => {
    try {
      const url = new URL(link.getAttribute('href') ?? '', element.ownerDocument.location.href);
      return url.origin === 'https://www.youtube.com'
        && ((url.pathname === '/watch' && Boolean(url.searchParams.get('v'))) || /^\/live\/[^/]+$/.test(url.pathname));
    } catch { return false; }
  });
}
