import stylesheet from './youtube.css';
import chromeStylesheet from './youtube-chrome.css';
import type { SiteAdapter, Surface } from './types';
import { mountYouTubeSettings } from './youtube-player';
import { mountYouTubeChrome } from './youtube-chrome';
import { mountYouTubeDetails, mountYouTubeFocus } from './youtube-details';
import { mountYouTubeComments } from './youtube-comments';
import { isYouTubeVideoCard, videoCardContainer } from './youtube-cards';
import { youtubePlaybackSource } from './youtube-signals';
import { mountYouTubeStudio } from './youtube-studio';

const SURFACE_ATTRIBUTE = 'data-ww-surface';

// All YouTube selectors live here. Prefer custom-element names over generated classes.
const targets: ReadonlyArray<{ selector: string; surfaces: readonly Surface[] }> = [
  { selector: 'body, ytd-app, ytd-page-manager', surfaces: ['page'] },
  // Native watch/ambient components can own their colors below the app boundary.
  // Keep the media subtree untouched; only its surrounding content is a page.
  { selector: 'ytd-watch-flexy, ytd-watch-flexy #columns, ytd-watch-flexy #primary, ytd-watch-flexy #secondary, ytd-watch-flexy #below, ytd-watch-metadata, ytd-comments, ytd-watch-flexy[elevated-watch-ambient] .box', surfaces: ['page'] },
  { selector: 'ytd-masthead #country-code', surfaces: ['metadata'] },
  { selector: 'ytd-masthead [id^="youtube-paths"]', surfaces: ['wordmark'] },
  { selector: 'ytd-masthead yt-icon, ytd-guide-renderer yt-icon, ytd-mini-guide-renderer yt-icon, ytd-comments-header-renderer yt-icon', surfaces: ['icon'] },
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
    selector: 'ytd-app button:not(.html5-video-player button), ytd-app a[role="button"]:not(.html5-video-player a), ytd-masthead button, ytd-masthead a[role="button"], ytd-masthead yt-button-shape a, ytd-masthead yt-button-view-model a, ytd-searchbox #search-icon-legacy, yt-chip-cloud-chip-renderer:not(:has(button)), yt-chip-cloud-chip-renderer button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer .ytChipShapeChip, ytd-watch-metadata yt-button-shape button',
    surfaces: ['button', 'rounded'],
  },
  {
    selector: 'yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytm-shorts-lockup-view-model, ytd-feed-nudge-renderer',
    surfaces: ['card', 'rounded'],
  },
  {
    selector: 'ytd-rich-grid-renderer, ytd-guide-section-renderer, ytd-item-section-renderer, ytd-rich-section-renderer',
    surfaces: ['panel', 'frame', 'section'],
  },
  { selector: 'ytd-feed-filter-chip-bar-renderer #chips-wrapper', surfaces: ['panel', 'toolbar'] },
  {
    selector: 'ytd-guide-entry-renderer #endpoint, ytd-guide-entry-renderer tp-yt-paper-item, ytd-mini-guide-entry-renderer',
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
    selector: 'yt-chip-cloud-chip-renderer[selected]:not(:has(button)), yt-chip-cloud-chip-renderer[selected] button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer[selected] .ytChipShapeChip, yt-chip-cloud-chip-renderer[aria-selected="true"]:not(:has(button)), yt-chip-cloud-chip-renderer[aria-selected="true"] button:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer[aria-selected="true"] .ytChipShapeChip, yt-chip-cloud-chip-renderer button[aria-selected="true"]:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer button[aria-selected="true"] .ytChipShapeChip, yt-chip-cloud-chip-renderer button[aria-pressed="true"]:not(:has(.ytChipShapeChip)), yt-chip-cloud-chip-renderer button[aria-pressed="true"] .ytChipShapeChip',
    surfaces: ['selected'],
  },
  {
    selector: 'ytd-app h1, ytd-app h2, ytd-app h3, ytd-rich-grid-media #video-title, ytd-grid-video-renderer #video-title, ytd-video-renderer #video-title, ytd-compact-video-renderer #video-title, yt-lockup-view-model #video-title, yt-lockup-metadata-view-model h3, ytd-watch-metadata h1',
    surfaces: ['heading'],
  },
  {
    selector: 'ytd-video-meta-block #metadata-line, yt-content-metadata-view-model',
    surfaces: ['metadata'],
  },
  { selector: 'ytd-comments', surfaces: ['comments'] },
  // Current native CSS uses opaque/hashed color tokens. Style semantic text
  // directly instead of depending on the retired --yt-spec-* token names.
  { selector: 'ytd-watch-metadata #owner, ytd-comments-header-renderer, ytd-comment-simplebox-renderer, ytd-comments #author-text, ytd-comments #published-time-text', surfaces: ['text'] },
  { selector: 'ytd-playlist-panel-video-renderer #byline, ytd-playlist-panel-video-renderer #index, ytd-video-meta-block #channel-name, ytd-video-meta-block #metadata-line', surfaces: ['metadata'] },
  { selector: 'ytd-watch-metadata h1', surfaces: ['primary-heading'] },
  { selector: 'ytd-watch-metadata', surfaces: ['reading-panel'] },
  { selector: 'ytd-comments #vote-count-middle, ytd-comments #vote-count-left, ytd-comment-engagement-bar #vote-count-middle, ytd-comment-action-buttons-renderer #vote-count-middle', surfaces: ['comment-vote'] },
  { selector: 'ytd-comments #content-text, ytd-comment-thread-renderer p, ytd-comments #contenteditable-root', surfaces: ['comment-text'] },
  { selector: 'ytd-guide-section-renderer #guide-section-title, ytd-comments #title, ytd-comments h2, ytd-watch-metadata #owner #channel-name', surfaces: ['label'] },
  { selector: '#movie_player', surfaces: ['player-window', 'rounded'] },
  { selector: 'ytd-playlist-panel-renderer', surfaces: ['playlist-window', 'rounded'] },
  { selector: 'ytd-playlist-panel-renderer .header, ytd-playlist-panel-renderer #header', surfaces: ['toolbar', 'label'] },
  { selector: 'ytd-playlist-panel-renderer #items, ytd-playlist-panel-renderer > #container', surfaces: ['panel'] },
  { selector: 'ytd-playlist-panel-video-renderer', surfaces: ['playlist-row', 'rounded'] },
  { selector: 'ytd-playlist-panel-video-renderer[selected], ytd-playlist-panel-video-renderer[aria-selected="true"]', surfaces: ['selected'] },
  { selector: 'ytd-playlist-panel-video-renderer #video-title', surfaces: ['heading'] },
  { selector: 'ytd-thumbnail-overlay-time-status-renderer, yt-thumbnail-badge-view-model .badge-shape-wiz, yt-thumbnail-overlay-badge-view-model .badge-shape-wiz, yt-thumbnail-badge-view-model badge-shape, yt-thumbnail-overlay-badge-view-model badge-shape', surfaces: ['duration', 'rounded'] },
  { selector: 'ytm-shorts-lockup-view-model .shortsLockupViewModelHostThumbnailParentContainer', surfaces: ['rounded'] },
  { selector: 'ytd-thumbnail #thumbnail, yt-thumbnail-view-model', surfaces: ['rounded'] },
];

const allSelectors = targets.map((target) => target.selector).join(', ');
const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated'] as const;
const durationSelector = 'ytd-thumbnail-overlay-time-status-renderer, yt-thumbnail-badge-view-model .badge-shape-wiz, yt-thumbnail-overlay-badge-view-model .badge-shape-wiz, yt-thumbnail-badge-view-model badge-shape, yt-thumbnail-overlay-badge-view-model badge-shape';

function isDuration(element: Element): boolean {
  // A badge can also mean LIVE, premiere, or new. Never make those look like a timer.
  const value = (element.querySelector('.ytBadgeShapeText, .badge-shape-wiz__text, #text')?.textContent ?? element.textContent ?? '').trim();
  return /^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/.test(value);
}

export function supportsYouTube(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === 'www.youtube.com'
    && !url.pathname.startsWith('/embed/') && !url.pathname.startsWith('/live_chat');
}

export function createYouTubeAdapter(doc: Document, view: Window): SiteAdapter {
  return {
    id: 'youtube',
    stylesheet: `${stylesheet}\n${chromeStylesheet}`,
    designTargets: [{ id: 'video-card', surface: 'video-card', label: '動画カード' }],
    decorationAnchors: [{ id: 'video-player', surface: 'player-window', label: '動画プレイヤー' }],
    signals: { videoPlayback: youtubePlaybackSource(doc) },
    mountSettings: (entry) => mountYouTubeSettings(doc, view, entry),
    mountStudio: (changed) => mountYouTubeStudio(doc, changed),
    features: {
      'window-chrome': { mount: () => mountYouTubeChrome(doc) },
      'daily-details': { mount: () => mountYouTubeDetails(doc) },
      'focus-titlebars': { mount: () => mountYouTubeFocus(doc) },
      'bbs-comments': { mount: () => mountYouTubeComments(doc) },
    },
    connect(onPageChange) {
      const root = doc.documentElement;
      const marked = new Set<Element>();
      const pending = new Set<Element>();
      let frame: number | undefined;
      let needsFullScan = false;
      let needsPrune = false;

      const setMode = () => {
        root.setAttribute('data-ww-mode', root.hasAttribute('dark') ? 'dark' : 'light');
        root.toggleAttribute('data-ww-fullscreen', Boolean(doc.fullscreenElement || doc.querySelector('ytd-watch-flexy[fullscreen]')));
      };

      const mark = (element: Element) => {
        const surfaces = new Set<Surface>();
        for (const target of targets) {
          if (element.matches(target.selector)) {
            target.surfaces.forEach((surface) => {
              if (surface !== 'duration' || (isDuration(element)
                && !element.parentElement?.closest('ytd-thumbnail-overlay-time-status-renderer'))) surfaces.add(surface);
            });
          }
        }
        if (isYouTubeVideoCard(element)) surfaces.add('video-card');
        if (surfaces.size > 0) {
          const value = [...surfaces].join(' ');
          if (element.getAttribute(SURFACE_ATTRIBUTE) !== value) {
            element.setAttribute(SURFACE_ATTRIBUTE, value);
          }
          marked.add(element);
        } else if (marked.delete(element)) {
          element.removeAttribute(SURFACE_ATTRIBUTE);
        }
      };

      const scan = (scope: Document | Element) => {
        if (scope.nodeType === 1) mark(scope as Element);
        scope.querySelectorAll(allSelectors).forEach(mark);
      };

      const flush = () => {
        frame = undefined;
        if (needsPrune || needsFullScan) {
          for (const element of marked) {
            if (!element.isConnected) {
              element.removeAttribute(SURFACE_ATTRIBUTE);
              marked.delete(element);
            } else if (needsFullScan) mark(element);
          }
        }
        if (needsFullScan) scan(doc);
        else for (const element of pending) {
          if (!element.isConnected) continue;
          // A queued ancestor already covers this subtree.
          let ancestor = element.parentElement;
          while (ancestor && !pending.has(ancestor)) ancestor = ancestor.parentElement;
          if (!ancestor) scan(element);
        }
        pending.clear();
        needsFullScan = false;
        needsPrune = false;
        setMode();
        onPageChange();
      };

      const schedule = () => {
        if (frame === undefined) frame = view.requestAnimationFrame(flush);
      };

      const refresh = () => {
        needsFullScan = true;
        schedule();
      };

      root.setAttribute('data-ww-site', 'youtube');
      setMode();
      scan(doc);

      // Only added subtrees / changed IDs are scanned on ordinary DOM updates.
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          // A delayed/recycled link can change eligibility without replacing the card.
          const owner = record.target instanceof Element ? record.target : record.target.parentElement;
          const card = owner && videoCardContainer(owner);
          if (card) pending.add(card);
          if (record.type === 'characterData') {
            const badge = record.target.parentElement?.closest(durationSelector);
            if (badge) pending.add(badge.closest('ytd-thumbnail-overlay-time-status-renderer') ?? badge);
            continue;
          }
          if (record.type === 'attributes') pending.add(record.target as Element);
          if (record.type === 'childList' && record.target instanceof Element) {
            const badge = record.target.closest(durationSelector);
            if (badge) pending.add(badge.closest('ytd-thumbnail-overlay-time-status-renderer') ?? badge);
          }
          for (const node of record.addedNodes) {
            if (node.nodeType === 1) pending.add(node as Element);
          }
          if (record.removedNodes.length > 0) needsPrune = true;
        }
        schedule();
      });
      observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['id', 'href', 'content-type', 'active', 'selected', 'aria-selected', 'aria-pressed', 'fullscreen'],
      });

      const modeObserver = new MutationObserver(() => {
        setMode();
        onPageChange();
      });
      modeObserver.observe(root, { attributes: true, attributeFilter: ['dark'] });
      navigationEvents.forEach((event) => doc.addEventListener(event, refresh));
      doc.addEventListener('fullscreenchange', refresh);
      view.addEventListener('popstate', refresh);
      view.addEventListener('pageshow', refresh);

      return () => {
        observer.disconnect();
        modeObserver.disconnect();
        navigationEvents.forEach((event) => doc.removeEventListener(event, refresh));
        doc.removeEventListener('fullscreenchange', refresh);
        view.removeEventListener('popstate', refresh);
        view.removeEventListener('pageshow', refresh);
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        pending.clear();
        marked.forEach((element) => element.removeAttribute(SURFACE_ATTRIBUTE));
        marked.clear();
        root.removeAttribute('data-ww-site');
        root.removeAttribute('data-ww-mode');
        root.removeAttribute('data-ww-fullscreen');
      };
    },
  };
}
