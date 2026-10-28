import stylesheet from './youtube.css';
import chromeStylesheet from './youtube-chrome.css';
import type { SiteAdapter, SitePageChange } from './types';
import { mountYouTubeSettings } from './youtube-player';
import { mountYouTubeChrome } from './youtube-chrome';
import { mountYouTubeDetails, mountYouTubeFocus } from './youtube-details';
import { mountYouTubeComments } from './youtube-comments';
import { videoCardContainer } from './youtube-cards';
import { youtubePlaybackSource } from './youtube-signals';
import { youtubeOperations } from './youtube-operations';
import { mountYouTubeStudio, protectYouTubeStudioToolbar } from './youtube-studio';
import { YOUTUBE_DESIGN_TARGETS, YOUTUBE_SKIN_CONTROLS, YOUTUBE_SKIN_MARKS } from './youtube-targets';
import { createSelectorIndex } from './surface-index';
import { surfacesFor, YOUTUBE_BASE_INDEX, YOUTUBE_BASE_SELECTORS, YOUTUBE_SURFACE_TARGETS } from './youtube-surfaces';

const SURFACE_ATTRIBUTE = 'data-ww-surface';

const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated'] as const;
const durationSelector =
  'ytd-thumbnail-overlay-time-status-renderer, yt-thumbnail-badge-view-model .badge-shape-wiz, yt-thumbnail-overlay-badge-view-model .badge-shape-wiz, yt-thumbnail-badge-view-model badge-shape, yt-thumbnail-overlay-badge-view-model badge-shape';

export function supportsYouTube(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === 'www.youtube.com' &&
    !url.pathname.startsWith('/embed/') &&
    !url.pathname.startsWith('/live_chat')
  );
}

export function createYouTubeAdapter(doc: Document, view: Window): SiteAdapter {
  // Parts an author can dress (see youtube-targets.ts) join the scan only while in use.
  let partMarks: typeof YOUTUBE_SKIN_MARKS = [],
    index = YOUTUBE_BASE_INDEX,
    allSelectors = YOUTUBE_BASE_SELECTORS,
    partsChanged: ((added: typeof YOUTUBE_SKIN_MARKS, removed: boolean) => void) | undefined;
  return {
    id: 'youtube',
    stylesheet: `${stylesheet}\n${chromeStylesheet}`,
    designTargets: YOUTUBE_DESIGN_TARGETS,
    skinControls: YOUTUBE_SKIN_CONTROLS,
    decorationAnchors: [{ id: 'video-player', surface: 'player-window', label: '動画プレイヤー' }],
    signals: { videoPlayback: youtubePlaybackSource(doc) },
    operationSurfaces: () => youtubeOperations(doc),
    mountSettings: (entry) => mountYouTubeSettings(doc, view, entry),
    protectStudioToolbar: (toolbar) => protectYouTubeStudioToolbar(doc, toolbar),
    mountStudio: (changed) => mountYouTubeStudio(doc, changed),
    features: {
      'window-chrome': { mount: () => mountYouTubeChrome(doc) },
      'daily-details': { mount: () => mountYouTubeDetails(doc) },
      'focus-titlebars': { mount: () => mountYouTubeFocus(doc) },
      'bbs-comments': { mount: () => mountYouTubeComments(doc) },
    },
    setDesignParts(ids) {
      const next = YOUTUBE_SKIN_MARKS.filter((mark) => ids.has(mark.part));
      if (next.length === partMarks.length && next.every((mark, position) => mark === partMarks[position])) return;
      const added = next.filter((mark) => !partMarks.includes(mark));
      const removed = partMarks.some((mark) => !next.includes(mark));
      partMarks = next;
      const active = [...YOUTUBE_SURFACE_TARGETS, ...next];
      index = createSelectorIndex(active);
      allSelectors = active.map((row) => row.selector).join(', ');
      // Before connect() the first scan already covers the parts. Afterwards only the parts that
      // changed are looked up; the rest of the page is not scanned again.
      partsChanged?.(added, removed);
    },
    connect(onPageChange) {
      const root = doc.documentElement;
      const marked = new Set<Element>();
      const pending = new Set<Element>();
      let fresh: Element[] = [];
      let frame: number | undefined;
      let needsFullScan = false;
      let needsPrune = false;
      let partSelectors: string | undefined;
      let partsRemoved = false;
      let change: SitePageChange = 'content';
      const owned = (node: Node) =>
        Boolean((node instanceof Element ? node : node.parentElement)?.closest('[id^="web-world-themes-"]'));

      const setMode = () => {
        root.setAttribute('data-ww-mode', root.hasAttribute('dark') ? 'dark' : 'light');
        root.toggleAttribute(
          'data-ww-fullscreen',
          Boolean(doc.fullscreenElement || doc.querySelector('ytd-watch-flexy[fullscreen]')),
        );
      };

      const mark = (element: Element) => {
        const surfaces = surfacesFor(element, index.candidates(element));
        if (surfaces.size > 0) {
          const value = [...surfaces].join(' ');
          if (element.getAttribute(SURFACE_ATTRIBUTE) !== value) {
            element.setAttribute(SURFACE_ATTRIBUTE, value);
            fresh.push(element);
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
        else {
          for (const element of pending) {
            if (!element.isConnected) continue;
            // A queued ancestor already covers this subtree.
            let ancestor = element.parentElement;
            while (ancestor && !pending.has(ancestor)) ancestor = ancestor.parentElement;
            if (!ancestor) scan(element);
          }
          // Parts that left the design lose their marks; parts that joined are looked up on their own.
          if (partsRemoved) for (const element of marked) mark(element);
          if (partSelectors) doc.querySelectorAll(partSelectors).forEach(mark);
        }
        partsRemoved = false;
        partSelectors = undefined;
        pending.clear();
        needsFullScan = false;
        needsPrune = false;
        setMode();
        const notification = change,
          changed = fresh;
        change = 'content';
        fresh = [];
        onPageChange(notification, changed);
      };

      const schedule = () => {
        if (frame === undefined) frame = view.requestAnimationFrame(flush);
      };

      const refresh = () => {
        needsFullScan = true;
        change = 'navigation';
        schedule();
      };
      const fullscreen = () => {
        needsFullScan = true;
        change = 'fullscreen';
        schedule();
      };
      partsChanged = (added, removed) => {
        if (added.length)
          partSelectors = [partSelectors, ...added.map((part) => part.selector)].filter(Boolean).join(', ');
        if (removed) partsRemoved = true;
        if (change === 'content') change = 'structure';
        schedule();
      };

      root.setAttribute('data-ww-site', 'youtube');
      setMode();
      scan(doc);

      // Only added subtrees / changed IDs are scanned on ordinary DOM updates.
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (!owned(record.target)) {
            const structural =
              record.type === 'attributes' ||
              (record.type === 'childList' &&
                ([...record.addedNodes].some((node) => node instanceof Element && !owned(node)) ||
                  // Detached top-level feature UI must be restored too. Changes
                  // inside an owned region (clock/title text) still stay content-only.
                  [...record.removedNodes].some((node) => node instanceof Element)));
            if (record.attributeName === 'fullscreen') change = 'fullscreen';
            else if (structural && change === 'content') change = 'structure';
          }
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
        attributeFilter: [
          'id',
          'href',
          'content-type',
          'active',
          'selected',
          'aria-selected',
          'aria-pressed',
          'fullscreen',
        ],
      });

      const modeObserver = new MutationObserver(() => {
        setMode();
        onPageChange('mode');
      });
      modeObserver.observe(root, { attributes: true, attributeFilter: ['dark'] });
      navigationEvents.forEach((event) => doc.addEventListener(event, refresh));
      doc.addEventListener('fullscreenchange', fullscreen);
      view.addEventListener('popstate', refresh);
      view.addEventListener('pageshow', refresh);

      return () => {
        partsChanged = undefined;
        observer.disconnect();
        modeObserver.disconnect();
        navigationEvents.forEach((event) => doc.removeEventListener(event, refresh));
        doc.removeEventListener('fullscreenchange', fullscreen);
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
