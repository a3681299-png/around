/**
 * YouTube's side of the room behind the UI (docs/depth-foundation.md). Only YouTube's own page
 * background turns transparent (the app shell; the masthead, the guide and every part keep their
 * looks), its ambient glow around the player stops while the room is shown (WWT's video light
 * takes its place), and the regions are the parts with text or controls, each with its importance.
 */
import type { SiteBackdrop } from './types';
import type { RegionImportance, UiRegion } from '../world/space';

/** The page background YouTube paints (the app shell, and html/body in some themes), and its
 * ambient mode: a blurred copy of the video drawn around the player (a decoration, not a control).
 * The masthead, chips bar and guide keep their own backgrounds: content scrolls under them. */
const BACKDROP_CSS =
  // html keeps YouTube's base colour (under the room's canvas): the room fades in over it, not over
  // the browser's white.
  'html{background:var(--yt-spec-base-background)!important}body,ytd-app{background:transparent!important}' +
  'ytd-watch-flexy #cinematics,ytd-watch-flexy #cinematics-container{display:none!important}' +
  // The theater's black beside the picture is the player's own background (letterboxing, not a
  // control): the room shows there instead. The picture, the bars and their gradients stay.
  'ytd-watch-flexy[theater] #full-bleed-container,ytd-watch-flexy[theater] #player-full-bleed-container,' +
  'ytd-watch-flexy[theater] #movie_player,ytd-watch-flexy[theater] .html5-video-container{background:transparent!important}';
const STYLE_ID = 'web-world-themes-backdrop';

interface RegionSource {
  selector: string;
  importance: RegionImportance;
  video?: boolean;
  /** The plate hugs the part's text and buttons, not its (often full-width) box. */
  tight?: boolean;
  pad?: number;
}
/**
 * Parts that appear once. Importance follows the design's table: controls are operated, text is
 * read. The plates go under the parts with text or controls only, so the room shows between them
 * (thumbnails are opaque pictures and need none). The operation parts inside stay the G1 list's
 * (src/sites/youtube-operations.ts); these are the boxes those parts sit in.
 */
const SINGLES: readonly RegionSource[] = [
  // One bar: the masthead is transparent on the watch page and in the theater (the page shows
  // through it), and its parts read as one row.
  { selector: '#masthead-container', importance: 'operate', pad: 0 },
  // The picture itself, not the player's box: in the theater the room shows beside the picture.
  {
    selector: 'ytd-watch-flexy:not([hidden]) #movie_player video.html5-main-video',
    importance: 'operate',
    video: true,
  },
  // The player's control bar keeps YouTube's own dark gradient across the player's width, also
  // where the room shows beside the picture; no plate there, so the sides stay open.
  { selector: 'ytd-watch-flexy:not([hidden]) ytd-watch-metadata #title', importance: 'read', tight: true },
  { selector: 'ytd-watch-flexy:not([hidden]) ytd-watch-metadata #owner', importance: 'operate', tight: true },
  { selector: 'ytd-watch-flexy:not([hidden]) ytd-watch-metadata #actions', importance: 'operate', tight: true },
  { selector: 'ytd-watch-flexy:not([hidden]) ytd-watch-metadata #description', importance: 'read', tight: true },
  { selector: 'ytd-watch-flexy:not([hidden]) ytd-comments-header-renderer', importance: 'read', tight: true },
  { selector: 'ytd-watch-flexy:not([hidden]) #secondary yt-chip-cloud-renderer', importance: 'operate' },
  { selector: 'ytd-watch-flexy:not([hidden]) #chat-container', importance: 'read' },
  { selector: 'ytd-browse:not([hidden]) ytd-feed-filter-chip-bar-renderer', importance: 'operate' },
  { selector: 'ytd-mini-guide-renderer', importance: 'operate' },
  { selector: 'ytd-miniplayer #video-container', importance: 'operate', video: true },
];
/** Repeated parts, looked for inside their list only (never the whole document): each comment's
 * text, each recommendation's text beside its thumbnail. */
const LISTS: readonly { list: string; item: string; importance: RegionImportance }[] = [
  // The watch page, in either layout YouTube serves: comments below the player or in a side panel,
  // recommendations beside it or below it. One query inside the watch page a second.
  {
    list: 'ytd-watch-flexy:not([hidden])',
    item: 'ytd-comment-view-model #main, yt-lockup-metadata-view-model',
    importance: 'read',
  },
  {
    // The reply buttons between comments, and the comment box.
    list: 'ytd-watch-flexy:not([hidden])',
    item: 'ytd-comment-replies-renderer button, ytd-comment-simplebox-renderer',
    importance: 'operate',
  },
  {
    list: 'ytd-browse:not([hidden]) ytd-rich-grid-renderer',
    item: 'yt-lockup-metadata-view-model, ytd-rich-grid-media #details',
    importance: 'read',
  },
  {
    list: 'ytd-search:not([hidden]) #contents',
    item: 'yt-lockup-metadata-view-model, ytd-video-renderer #meta',
    importance: 'read',
  },
];
const VIDEO: RegionSource = { selector: '#movie_player video.html5-main-video', importance: 'free' };
/** A part not found is looked for again only this often; lists are re-read as often. */
const RETRY_MS = 1000;
/** Repeated parts read at most this many at once (the ones in view). */
const LIST_LIMIT = 36;
/** Nodes walked for one part's text bounds (a long comment has a few dozen). */
const TIGHT_NODES = 160;
/** Parts whose text bounds are measured in one read (the others wait for a later read). */
const TIGHT_PER_READ = 4;
/** A part's measured text bounds are trusted this long, then measured again. */
const TIGHT_TTL_MS = 1000;

export function youtubeBackdrop(doc: Document): SiteBackdrop {
  const view = doc.defaultView!;
  const found = new Map<RegionSource, { element?: Element; at: number }>();
  const element = (source: RegionSource) => {
    const now = view.performance.now();
    const cached = found.get(source);
    if (cached?.element?.isConnected) return cached.element;
    if (cached && !cached.element && now - cached.at < RETRY_MS) return undefined;
    // One query for one known part, not a scan: the result is kept while it is connected.
    const next = doc.querySelector(source.selector) ?? undefined;
    found.set(source, { ...(next ? { element: next } : {}), at: now });
    return next;
  };
  // Repeated parts: found inside their list now and then, and kept to the ones in view by an
  // IntersectionObserver, so a long comment section costs a few box reads a frame, not hundreds.
  const items = new Map<Element, { importance: RegionImportance; tight: boolean }>();
  const inView = new Set<Element>();
  let observer: IntersectionObserver | undefined;
  let listsAt = -Infinity;
  const readLists = (now: number) => {
    listsAt = now;
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.isIntersecting ? inView.add(entry.target) : inView.delete(entry.target);
      },
      { rootMargin: '200px 0px' },
    );
    const next = new Map<Element, { importance: RegionImportance; tight: boolean }>();
    for (const source of LISTS) {
      const list = doc.querySelector(source.list);
      if (!list) continue;
      // Text parts hug their text; buttons and boxes keep their own box.
      for (const item of list.querySelectorAll(source.item))
        next.set(item, { importance: source.importance, tight: source.importance === 'read' });
    }
    for (const item of items.keys())
      if (!next.has(item)) {
        observer.unobserve(item);
        inView.delete(item);
      }
    for (const item of next.keys()) if (!items.has(item)) observer.observe(item);
    items.clear();
    for (const [item, value] of next) items.set(item, value);
  };
  const range = doc.createRange();
  /**
   * The part's text and buttons only: the union of its text runs and of its buttons, images and
   * icons (taken whole). A comment's box is the column's width; its text is often a third of it,
   * and the room shows beside it. At most TIGHT_NODES nodes a part; past that, the part's box.
   */
  const tightBox = (e: Element) => {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity,
      nodes = 0;
    const add = (r: DOMRect) => {
      if (r.width <= 0 || r.height <= 0) return;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    };
    const walker = doc.createTreeWalker(e, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE)
          return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        const tag = (node as Element).localName;
        // A button, an image or an icon counts whole; its insides are not walked.
        if (tag === 'button' || tag === 'img' || tag === 'yt-icon' || tag === 'svg' || tag === 'a') {
          add((node as Element).getBoundingClientRect());
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++nodes > TIGHT_NODES) return e.getBoundingClientRect();
      range.selectNodeContents(node);
      add(range.getBoundingClientRect());
    }
    return left < right ? new DOMRect(left, top, right - left, bottom - top) : e.getBoundingClientRect();
  };
  /**
   * How far a part's text stops short of its box's right edge, kept between reads: walking the
   * text every frame of a scroll cost about a second in six (CPU profile). Only the right side is
   * trimmed (text starts at the box's left and fills it top to bottom), so a stale value can only
   * matter where a line grew longer. Re-measured when the box changes size, after TIGHT_TTL_MS,
   * and after every page change; a few parts a read, the rest use their whole box meanwhile (a
   * larger plate, never a smaller one).
   */
  const insets = new WeakMap<
    Element,
    { width: number; height: number; right: number; at: number; generation: number }
  >();
  let measures = 0,
    budget = TIGHT_PER_READ,
    lastRead = -Infinity,
    generation = 0;
  const tightRect = (e: Element, now: number) => {
    const whole = e.getBoundingClientRect();
    const known = insets.get(e);
    if (
      known &&
      known.width === whole.width &&
      known.height === whole.height &&
      ((now - known.at < TIGHT_TTL_MS && known.generation === generation) || measures >= budget)
    )
      return new DOMRect(whole.left, whole.top, whole.width - known.right, whole.height);
    if (measures >= budget || whole.width <= 0 || whole.height <= 0) return whole;
    measures++;
    const t = tightBox(e);
    const right = Math.max(0, whole.right - t.right);
    insets.set(e, { width: whole.width, height: whole.height, right, at: now, generation });
    return new DOMRect(whole.left, whole.top, whole.width - right, whole.height);
  };
  const box = (
    e: Element,
    importance: RegionImportance,
    video?: boolean,
    tight?: boolean,
    pad?: number,
  ): UiRegion | undefined => {
    const r = tight ? tightRect(e, view.performance.now()) : e.getBoundingClientRect();
    // A hidden page (YouTube keeps the last ones) or a closed miniplayer has no box.
    if (r.width <= 0 || r.height <= 0) return undefined;
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      importance,
      ...(video ? { video: true } : {}),
      ...(pad === undefined ? {} : { pad }),
    };
  };
  return {
    open() {
      let style: HTMLStyleElement | null = null;
      const parent = doc.body ?? doc.documentElement;
      return {
        parent,
        // Under ytd-app (not positioned with a level of its own) and over the transparent html.
        zIndex: -1,
        show() {
          style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
          if (style) return;
          style = doc.createElement('style');
          style.id = STYLE_ID;
          style.textContent = BACKDROP_CSS;
          (doc.head ?? doc.documentElement).append(style);
        },
        close() {
          style?.remove();
          found.clear();
          observer?.disconnect();
          observer = undefined;
          items.clear();
          inView.clear();
          listsAt = -Infinity;
        },
      };
    },
    refresh() {
      // The page changed (the adapter's notice): look for parts and list items again next read,
      // and measure the text bounds again (the old ones serve until then).
      listsAt = -Infinity;
      generation++;
      for (const [source, cached] of found) if (!cached.element) found.delete(source);
    },
    regions() {
      const now = view.performance.now();
      measures = 0;
      // While the page moves (reads every frame) a few parts are measured a read; a read after a
      // pause (the once-a-second read of a still page) measures every part that is due.
      budget = now - lastRead > 200 ? Infinity : TIGHT_PER_READ;
      lastRead = now;
      if (now - listsAt >= RETRY_MS) readLists(now);
      const out: UiRegion[] = [];
      for (const source of SINGLES) {
        const e = element(source);
        if (!e) continue;
        const region = box(e, source.importance, source.video, source.tight, source.pad);
        if (region) out.push(region);
        else {
          // Looked for again after RETRY_MS, in case another one is shown now.
          const cached = found.get(source)!;
          if (now - cached.at >= RETRY_MS) found.set(source, { at: now });
        }
      }
      // Only the parts on screen count toward the limit (the observer's margin brings a few more
      // in early, so their plates are ready as they scroll in).
      let listed = 0;
      const height = view.innerHeight;
      for (const item of inView) {
        if (listed >= LIST_LIMIT) break;
        const kind = items.get(item);
        const region = box(item, kind?.importance ?? 'read', false, kind?.tight);
        if (region && region.top < height && region.top + region.height > 0) (out.push(region), listed++);
      }
      return out;
    },
    scheme: () => (doc.documentElement.hasAttribute('dark') ? 'dark' : 'light'),
    video: () => element(VIDEO) as HTMLVideoElement | undefined,
  };
}
