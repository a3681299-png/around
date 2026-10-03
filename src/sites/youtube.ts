import stylesheet from './youtube.css';
import type { SiteAdapter, Surface } from './types';
import { mountYouTubeSettings } from './youtube-player';
import { createYouTubeChrome } from './youtube-chrome';

const SURFACE_ATTRIBUTE = 'data-ww-surface';

// All YouTube selectors live here. Prefer custom-element names over generated classes.
const targets: ReadonlyArray<{ selector: string; surfaces: readonly Surface[] }> = [
  { selector: 'body, ytd-app, ytd-page-manager', surfaces: ['page'] },
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
    selector: 'ytd-masthead button, ytd-masthead a[role="button"], ytd-masthead yt-button-shape a, ytd-masthead yt-button-view-model a, ytd-searchbox #search-icon-legacy, yt-chip-cloud-chip-renderer:not(:has(button)), yt-chip-cloud-chip-renderer button, ytd-watch-metadata yt-button-shape button',
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
  { selector: 'ytm-shorts-lockup-view-model .shortsLockupViewModelHostThumbnailParentContainer', surfaces: ['rounded'] },
  { selector: 'ytd-thumbnail #thumbnail, yt-thumbnail-view-model', surfaces: ['rounded'] },
];

const allSelectors = targets.map((target) => target.selector).join(', ');
const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated'] as const;

export function supportsYouTube(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === 'www.youtube.com'
    && !url.pathname.startsWith('/embed/') && !url.pathname.startsWith('/live_chat');
}

export function createYouTubeAdapter(doc: Document, view: Window): SiteAdapter {
  return {
    id: 'youtube',
    stylesheet,
    mountSettings: (entry) => mountYouTubeSettings(doc, view, entry),
    connect(onPageChange) {
      const root = doc.documentElement;
      const chrome = createYouTubeChrome(doc);
      let masthead: HTMLElement | null = null;
      const marked = new Set<Element>();
      const pending = new Set<Element>();
      let frame: number | undefined;
      let needsFullScan = false;
      let needsPrune = false;

      const setMode = () => {
        root.setAttribute('data-ww-mode', root.hasAttribute('dark') ? 'dark' : 'light');
      };

      const ensureWindowChrome = () => {
        const next = doc.querySelector<HTMLElement>('ytd-masthead');
        if (!next) {
          chrome.remove();
          masthead = null;
          root.removeAttribute('data-ww-window-chrome');
          return;
        }
        if (next !== masthead) {
          // Read the native toolbar before expanding its outer window frame.
          const height = next.querySelector('#container')?.getBoundingClientRect().height ?? 56;
          root.style.setProperty('--ww-native-header-height', `${height >= 40 && height <= 80 ? height : 56}px`);
          masthead = next;
        }
        if (next.firstElementChild !== chrome) next.prepend(chrome);
        root.setAttribute('data-ww-window-chrome', '');
      };

      const mark = (element: Element) => {
        const surfaces = new Set<Surface>();
        for (const target of targets) {
          if (element.matches(target.selector)) {
            target.surfaces.forEach((surface) => surfaces.add(surface));
          }
        }
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
        ensureWindowChrome();
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
      ensureWindowChrome();

      // Only added subtrees / changed IDs are scanned on ordinary DOM updates.
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes') pending.add(record.target as Element);
          for (const node of record.addedNodes) {
            if (node.nodeType === 1) pending.add(node as Element);
          }
          if (record.removedNodes.length > 0) needsPrune = true;
        }
        schedule();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['id', 'active'],
      });

      const modeObserver = new MutationObserver(() => {
        setMode();
        onPageChange();
      });
      modeObserver.observe(root, { attributes: true, attributeFilter: ['dark'] });
      navigationEvents.forEach((event) => doc.addEventListener(event, refresh));
      view.addEventListener('popstate', refresh);
      view.addEventListener('pageshow', refresh);

      return () => {
        observer.disconnect();
        modeObserver.disconnect();
        navigationEvents.forEach((event) => doc.removeEventListener(event, refresh));
        view.removeEventListener('popstate', refresh);
        view.removeEventListener('pageshow', refresh);
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        pending.clear();
        marked.forEach((element) => element.removeAttribute(SURFACE_ATTRIBUTE));
        marked.clear();
        chrome.remove();
        root.removeAttribute('data-ww-window-chrome');
        root.style.removeProperty('--ww-native-header-height');
        root.removeAttribute('data-ww-site');
        root.removeAttribute('data-ww-mode');
      };
    },
  };
}
