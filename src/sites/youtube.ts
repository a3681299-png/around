import stylesheet from './youtube.css';
import type { SiteAdapter, Surface } from './types';
import { mountYouTubeSettings } from './youtube-player';

const SURFACE_ATTRIBUTE = 'data-ww-surface';

// All YouTube selectors live here. Prefer custom-element names over generated classes.
const targets: ReadonlyArray<{ selector: string; surfaces: readonly Surface[] }> = [
  { selector: 'body, ytd-app, ytd-page-manager', surfaces: ['page'] },
  {
    selector: 'ytd-masthead #container, ytd-guide-renderer, ytd-mini-guide-renderer',
    surfaces: ['panel'],
  },
  {
    selector: 'ytd-watch-metadata #description',
    surfaces: ['panel', 'frame', 'rounded'],
  },
  {
    selector: 'ytd-searchbox #container, yt-searchbox #search-input, yt-searchbox .ytSearchboxComponentInputBox',
    surfaces: ['panel', 'frame', 'rounded'],
  },
  { selector: 'ytd-thumbnail #thumbnail, yt-thumbnail-view-model', surfaces: ['rounded'] },
  { selector: 'yt-chip-cloud-chip-renderer', surfaces: ['rounded'] },
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
      const marked = new Set<Element>();
      const pending = new Set<Element>();
      let frame: number | undefined;
      let needsFullScan = false;
      let needsPrune = false;

      const setMode = () => {
        root.setAttribute('data-ww-mode', root.hasAttribute('dark') ? 'dark' : 'light');
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
        attributeFilter: ['id'],
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
        root.removeAttribute('data-ww-site');
        root.removeAttribute('data-ww-mode');
      };
    },
  };
}
