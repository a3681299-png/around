import type { Surface } from './types';
import { isYouTubeVideoCard } from './youtube-cards';
import { createSelectorIndex, type IndexedSelector } from './surface-index';

export interface SurfaceRow {
  readonly selector: string;
  readonly surfaces: readonly Surface[];
}

// All YouTube selectors live here. Prefer custom-element names over generated classes.
export const YOUTUBE_SURFACE_TARGETS: ReadonlyArray<SurfaceRow> = [
  { selector: 'body, ytd-app, ytd-page-manager', surfaces: ['page'] },
  // Native watch/ambient components can own their colors below the app boundary.
  // Keep the media subtree untouched; only its surrounding content is a page.
  {
    selector:
      'ytd-watch-flexy, ytd-watch-flexy #columns, ytd-watch-flexy #primary, ytd-watch-flexy #secondary, ytd-watch-flexy #below, ytd-watch-metadata, ytd-comments, ytd-watch-flexy[elevated-watch-ambient] .box',
    surfaces: ['page'],
  },
  { selector: 'ytd-masthead #country-code', surfaces: ['metadata'] },
  { selector: 'ytd-masthead [id^="youtube-paths"]', surfaces: ['wordmark'] },
  {
    selector:
      'ytd-masthead yt-icon, ytd-guide-renderer yt-icon, ytd-mini-guide-renderer yt-icon, ytd-comments-header-renderer yt-icon',
    surfaces: ['icon'],
  },
  { selector: 'ytd-masthead', surfaces: ['window', 'panel', 'frame'] },
  {
    selector: 'ytd-guide-renderer, ytd-mini-guide-renderer',
    surfaces: ['panel', 'frame', 'sidebar'],
  },
  { selector: 'ytd-masthead > #container', surfaces: ['panel', 'toolbar'] },
  {
    selector: 'ytd-watch-metadata #description',
    surfaces: ['panel', 'frame', 'rounded', 'text'],
  },
  {
    selector: 'ytd-searchbox #container, yt-searchbox #search-input, yt-searchbox .ytSearchboxComponentInputBox',
    surfaces: ['input', 'frame', 'rounded'],
  },
  {
    selector:
      'ytd-app button:not(.html5-video-player button), ytd-app a[role="button"]:not(.html5-video-player a), ytd-masthead button, ytd-masthead a[role="button"], ytd-masthead yt-button-shape a, ytd-masthead yt-button-view-model a, ytd-searchbox #search-icon-legacy, yt-chip-cloud-chip-renderer:not(:has(button)), yt-chip-cloud-chip-renderer button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer .ytChipShapeChip, ytd-watch-metadata yt-button-shape button',
    surfaces: ['button', 'rounded'],
  },
  {
    selector:
      'yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytm-shorts-lockup-view-model, ytd-feed-nudge-renderer',
    surfaces: ['card', 'rounded'],
  },
  {
    selector:
      'ytd-rich-grid-renderer, ytd-guide-section-renderer, ytd-item-section-renderer, ytd-rich-section-renderer',
    surfaces: ['panel', 'frame', 'section'],
  },
  { selector: 'ytd-feed-filter-chip-bar-renderer #chips-wrapper', surfaces: ['panel', 'toolbar'] },
  {
    selector:
      'ytd-guide-entry-renderer #endpoint, ytd-guide-entry-renderer tp-yt-paper-item, ytd-mini-guide-entry-renderer',
    surfaces: ['navigation', 'rounded'],
  },
  {
    selector: 'ytd-guide-entry-renderer[active] tp-yt-paper-item, ytd-mini-guide-entry-renderer[active]',
    surfaces: ['selected'],
  },
  {
    selector: 'yt-chip-cloud-chip-renderer',
    surfaces: ['chip'],
  },
  {
    selector:
      'yt-chip-cloud-chip-renderer[selected]:not(:has(button)), yt-chip-cloud-chip-renderer[selected] button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer[selected] .ytChipShapeChip, yt-chip-cloud-chip-renderer[aria-selected="true"]:not(:has(button)), yt-chip-cloud-chip-renderer[aria-selected="true"] button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer[aria-selected="true"] .ytChipShapeChip, yt-chip-cloud-chip-renderer button[aria-selected="true"]:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer button[aria-selected="true"] .ytChipShapeChip, yt-chip-cloud-chip-renderer button[aria-pressed="true"]:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer button[aria-pressed="true"] .ytChipShapeChip',
    surfaces: ['selected'],
  },
  {
    selector:
      'ytd-app h1, ytd-app h2, ytd-app h3, ytd-rich-grid-media #video-title, ytd-grid-video-renderer #video-title, ytd-video-renderer #video-title, ytd-compact-video-renderer #video-title, yt-lockup-view-model #video-title, yt-lockup-metadata-view-model h3, ytd-watch-metadata h1',
    surfaces: ['heading'],
  },
  {
    selector: 'ytd-video-meta-block #metadata-line, yt-content-metadata-view-model',
    surfaces: ['metadata'],
  },
  { selector: 'ytd-comments', surfaces: ['comments'] },
  // Current native CSS uses opaque/hashed color tokens. Style semantic text
  // directly instead of depending on the retired --yt-spec-* token names.
  {
    selector:
      'ytd-watch-metadata #owner, ytd-comments-header-renderer, ytd-comment-simplebox-renderer, ytd-comments #author-text, ytd-comments #published-time-text',
    surfaces: ['text'],
  },
  {
    selector:
      'ytd-playlist-panel-video-renderer #byline, ytd-playlist-panel-video-renderer #index, ytd-video-meta-block #channel-name, ytd-video-meta-block #metadata-line',
    surfaces: ['metadata'],
  },
  { selector: 'ytd-watch-metadata h1', surfaces: ['primary-heading'] },
  { selector: 'ytd-watch-metadata', surfaces: ['reading-panel'] },
  {
    selector:
      'ytd-comments #vote-count-middle, ytd-comments #vote-count-left, ytd-comment-engagement-bar #vote-count-middle, ytd-comment-action-buttons-renderer #vote-count-middle',
    surfaces: ['comment-vote'],
  },
  {
    selector: 'ytd-comments #content-text, ytd-comment-thread-renderer p, ytd-comments #contenteditable-root',
    surfaces: ['comment-text'],
  },
  {
    selector:
      'ytd-guide-section-renderer #guide-section-title, ytd-comments #title, ytd-comments h2, ytd-watch-metadata #owner #channel-name',
    surfaces: ['label'],
  },
  { selector: '#movie_player', surfaces: ['player-window', 'rounded'] },
  { selector: 'ytd-playlist-panel-renderer', surfaces: ['playlist-window', 'rounded'] },
  {
    selector: 'ytd-playlist-panel-renderer .header, ytd-playlist-panel-renderer #header',
    surfaces: ['toolbar', 'label'],
  },
  { selector: 'ytd-playlist-panel-renderer #items, ytd-playlist-panel-renderer > #container', surfaces: ['panel'] },
  { selector: 'ytd-playlist-panel-video-renderer', surfaces: ['playlist-row', 'rounded'] },
  {
    selector: 'ytd-playlist-panel-video-renderer[selected], ytd-playlist-panel-video-renderer[aria-selected="true"]',
    surfaces: ['selected'],
  },
  { selector: 'ytd-playlist-panel-video-renderer #video-title', surfaces: ['heading'] },
  {
    selector:
      'ytd-thumbnail-overlay-time-status-renderer, yt-thumbnail-badge-view-model .badge-shape-wiz, yt-thumbnail-overlay-badge-view-model .badge-shape-wiz, yt-thumbnail-badge-view-model badge-shape, yt-thumbnail-overlay-badge-view-model badge-shape',
    surfaces: ['duration', 'rounded'],
  },
  {
    selector: 'ytm-shorts-lockup-view-model .shortsLockupViewModelHostThumbnailParentContainer',
    surfaces: ['rounded'],
  },
  { selector: 'ytd-thumbnail #thumbnail, yt-thumbnail-view-model', surfaces: ['rounded'] },
];

/** The index and joined selector list of the always-on rows. */
export const YOUTUBE_BASE_INDEX = createSelectorIndex(YOUTUBE_SURFACE_TARGETS);
export const YOUTUBE_BASE_SELECTORS = YOUTUBE_SURFACE_TARGETS.map((row) => row.selector).join(', ');

function isDuration(element: Element): boolean {
  // A badge can also mean LIVE, premiere, or new. Never make those look like a timer.
  const value = (
    element.querySelector('.ytBadgeShapeText, .badge-shape-wiz__text, #text')?.textContent ??
    element.textContent ??
    ''
  ).trim();
  return /^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/.test(value);
}

/** The surfaces an element gets from the selector entries that can match it. `candidates` is the
 * index's list for the element; passing every entry gives the same result, only slower. */
export function surfacesFor(element: Element, candidates: readonly IndexedSelector<SurfaceRow>[]): Set<Surface> {
  const surfaces = new Set<Surface>();
  for (const { source, selector } of candidates) {
    if (!element.matches(selector)) continue;
    source.surfaces.forEach((surface) => {
      if (
        surface !== 'duration' ||
        (isDuration(element) && !element.parentElement?.closest('ytd-thumbnail-overlay-time-status-renderer'))
      )
        surfaces.add(surface);
    });
  }
  if (isYouTubeVideoCard(element)) surfaces.add('video-card');
  return surfaces;
}
