/**
 * YouTube's side of the room behind the UI (docs/depth-foundation.md). Only YouTube's own page
 * background turns transparent (the app shell; the masthead, the guide and every part keep their
 * looks), and the regions are a few known containers with their importance.
 */
import type { SiteBackdrop } from './types';
import type { RegionImportance, UiRegion } from '../world/space';

/** The page background YouTube paints: the app shell (and html/body, which carry it in some
 * themes). The masthead, chips bar and guide keep theirs: content scrolls under them. */
const BACKDROP_CSS = 'html,body,ytd-app{background:transparent!important}';
const STYLE_ID = 'web-world-themes-backdrop';

interface RegionSource {
  selector: string;
  importance: RegionImportance;
  video?: boolean;
}
/**
 * The containers, by page. Importance follows the design's table: the player is operated (its
 * plate is under the video and lights the room), the reading columns are read. The operation
 * parts inside them stay the G1 list's (src/sites/youtube-operations.ts); a container is the
 * widened region those parts sit in.
 */
const REGIONS: readonly RegionSource[] = [
  // The masthead's own background is transparent on the watch page (YouTube lets the page show
  // through it), so the search box and the buttons get an operation plate.
  { selector: '#masthead-container', importance: 'operate' },
  { selector: 'ytd-watch-flexy:not([hidden]) #movie_player', importance: 'operate', video: true },
  { selector: 'ytd-watch-flexy:not([hidden]) #secondary-inner', importance: 'read' },
  { selector: 'ytd-watch-flexy:not([hidden]) #below', importance: 'read' },
  { selector: 'ytd-watch-flexy:not([hidden]) #chat-container', importance: 'read' },
  { selector: 'ytd-browse:not([hidden]) ytd-rich-grid-renderer', importance: 'read' },
  { selector: 'ytd-browse:not([hidden]) ytd-section-list-renderer', importance: 'read' },
  { selector: 'ytd-search:not([hidden]) #contents', importance: 'read' },
  { selector: 'ytd-mini-guide-renderer', importance: 'operate' },
  { selector: 'ytd-miniplayer #video-container', importance: 'operate', video: true },
];
const VIDEO: RegionSource = { selector: '#movie_player video.html5-main-video', importance: 'free' };
/** A container not found is looked for again only this often: a missing one costs one query a second. */
const MISS_RETRY_MS = 1000;

export function youtubeBackdrop(doc: Document): SiteBackdrop {
  const view = doc.defaultView!;
  const found = new Map<RegionSource, { element?: Element; at: number }>();
  const element = (source: RegionSource) => {
    const now = view.performance.now();
    const cached = found.get(source);
    if (cached?.element?.isConnected) return cached.element;
    if (cached && !cached.element && now - cached.at < MISS_RETRY_MS) return undefined;
    // One query for one known container, not a scan: the result is kept while it is connected.
    const next = doc.querySelector(source.selector) ?? undefined;
    found.set(source, { ...(next ? { element: next } : {}), at: now });
    return next;
  };
  return {
    open() {
      let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = BACKDROP_CSS;
        (doc.head ?? doc.documentElement).append(style);
      }
      const parent = doc.body ?? doc.documentElement;
      return {
        parent,
        // Under ytd-app (not positioned with a level of its own) and over the transparent html.
        zIndex: -1,
        close() {
          style?.remove();
          found.clear();
        },
      };
    },
    regions() {
      const out: UiRegion[] = [];
      for (const source of REGIONS) {
        const e = element(source);
        if (!e) continue;
        const r = e.getBoundingClientRect();
        // A hidden page (YouTube keeps the last ones) or a closed miniplayer has no box: looked
        // for again after MISS_RETRY_MS, in case another one is shown now.
        if (r.width <= 0 || r.height <= 0) {
          const cached = found.get(source)!;
          if (view.performance.now() - cached.at >= MISS_RETRY_MS) found.set(source, { at: view.performance.now() });
          continue;
        }
        out.push({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          importance: source.importance,
          ...(source.video ? { video: true } : {}),
        });
      }
      return out;
    },
    scheme: () => (doc.documentElement.hasAttribute('dark') ? 'dark' : 'light'),
    video: () => element(VIDEO) as HTMLVideoElement | undefined,
  };
}
