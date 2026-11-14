/**
 * YouTube's side of the room behind the UI (docs/depth-foundation.md). Only YouTube's own page
 * background turns transparent (the app shell; the masthead, the guide and every part keep their
 * looks), its ambient glow around the player stops while the room is shown (Around's video light
 * takes its place), and the regions are the parts with text or controls, each with its importance.
 */
import type { SiteBackdrop } from './types';
import type { RegionImportance, UiRegion } from '../world/space';
import { SPACE_BREAK } from '../host/world-options';

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
const STYLE_ID = 'around-backdrop';

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
/** The watch page's own element: its `theater` attribute is YouTube's theater mode. */
const WATCH: RegionSource = { selector: 'ytd-watch-flexy:not([hidden])', importance: 'free' };
/**
 * The readability's way out (docs/depth-foundation.md): when YouTube renames a part, its text no
 * longer gets a small plate and would sit bare on the room. The page is walked now and then for
 * visible text that no known part covers; the column it is in gets one large plate, the way the
 * first version plated whole columns (the room shows less there, the text always reads).
 */
const COLUMNS =
  'ytd-watch-flexy #below, ytd-watch-flexy #secondary-inner, ytd-watch-flexy #secondary, ' +
  'ytd-browse #primary, ytd-search #primary, #masthead-container, ytd-mini-guide-renderer';
/**
 * Where the walk looks (docs/living-room.md, 逃げ道の範囲): the columns above, each found by one
 * cached query like any known part, never a document-wide scan per page change. Text outside them
 * (menus, dialogs) paints its own background. If YouTube renames the columns themselves (none is
 * found), the walk falls back to the whole app: the way out is never narrower than its need.
 */
const COLUMN_SOURCES: readonly RegionSource[] = [
  'ytd-watch-flexy:not([hidden]) #below',
  'ytd-watch-flexy:not([hidden]) #secondary',
  'ytd-browse:not([hidden]) #primary',
  'ytd-search:not([hidden]) #primary',
  '#masthead-container',
  'ytd-mini-guide-renderer',
].map((selector) => ({ selector, importance: 'free' as const }));
/** Text on a picture is read against the picture, not the room: the player, thumbnails, images. */
const OVER_PICTURE =
  '#movie_player, #player, ytd-thumbnail, yt-thumbnail-view-model, ytd-playlist-thumbnail, ' +
  'yt-collection-thumbnail-view-model, yt-image, img, video, canvas';
const NOT_TEXT = new Set(['script', 'style', 'template', 'noscript', 'svg', 'iron-iconset-svg', 'dom-module']);
/** Nodes the walk takes in one read: a few while the page moves, a whole pass in a still read. */
const WALK_ACTIVE = 400;
const WALK_IDLE = 6000;
/** Smaller than this is not readable text (screen-reader-only text is clipped to a pixel). */
const TEXT_MIN_W = 4;
const TEXT_MIN_H = 6;
/** Where no named column holds the text, the plate is its nearest box at least this wide. */
const BLOCK_MIN_W = 240;
/** A part painted at least this opaque hides the room behind its text by itself. */
const OPAQUE_ALPHA = 0.95;
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

/** The known parts, or none in a build that stands in for YouTube renaming them (AROUND_SPACE_BREAK=names):
 * the picture stays (it lights the room), the text parts go. */
const singles = SPACE_BREAK === 'names' ? SINGLES.filter((s) => s.video) : SINGLES;
const lists = SPACE_BREAK === 'names' ? [] : LISTS;

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
    for (const source of lists) {
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
  // --- The fallback: visible text no known part covers -----------------------------------------
  // The known parts now: the single parts found in the last read and every list item found (live,
  // so items scrolled in after a walk started still count as known).
  const knownSingles = new Set<Element>();
  interface Pass {
    root: Element;
    /** The roots still to walk after this one (the columns), in order. */
    rest: Element[];
    walker: TreeWalker;
    /** Columns this walk found bare text in (plated at once, before the walk ends). */
    plated: Set<Element>;
    opaque: Map<Element, boolean>;
    visited: number;
  }
  let pass: Pass | undefined;
  /** The last finished walk's columns: kept until the next walk finishes (never a gap between). */
  let plated: Element[] = [];
  let passAt = -Infinity;
  const textRange = doc.createRange();
  /** Whether a part between the text and the page root paints an opaque background of its own. */
  const overOpaque = (e: Element, state: Pass) => {
    const seen: Element[] = [];
    let result = false;
    for (let n: Element | null = e; n && n !== state.root; n = n.parentElement) {
      const known = state.opaque.get(n);
      if (known !== undefined) {
        result = known;
        break;
      }
      seen.push(n);
      // rgb() is opaque, rgba() by its alpha; anything else (a newer colour syntax) counts as
      // see-through, which plates more, never less.
      const m = /^rgba?\(([^)]*)\)$/.exec(view.getComputedStyle(n).backgroundColor);
      const parts = m ? m[1]!.split(/[\s,/]+/).filter(Boolean) : [];
      const alpha = parts.length === 3 ? 1 : parts.length === 4 ? Number(parts[3]) : 0;
      if (alpha >= OPAQUE_ALPHA) {
        result = true;
        break;
      }
    }
    for (const n of seen) state.opaque.set(n, result);
    return result;
  };
  const columnOf = (e: Element, root: Element) => {
    const named = e.closest(COLUMNS);
    if (named && root.contains(named)) return named;
    // Not in a column YouTube still names: the nearest box wide enough to read as a column.
    for (let n: Element | null = e; n && n !== root; n = n.parentElement)
      if (n.getBoundingClientRect().width >= BLOCK_MIN_W) return n;
    return e;
  };
  const walkerFor = (state: Pass, root: Element) =>
    doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        state.visited++;
        if (node.nodeType === Node.TEXT_NODE)
          return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        const e = node as Element;
        // A known part has its own plate; hidden pages, pictures and non-text are not walked.
        if (
          items.has(e) ||
          knownSingles.has(e) ||
          NOT_TEXT.has(e.localName) ||
          e.hasAttribute('hidden') ||
          e.matches(OVER_PICTURE)
        )
          return NodeFilter.FILTER_REJECT;
        // A column already plated needs no more looking in.
        for (const c of state.plated) if (c.contains(e)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      },
    });
  const startPass = (): Pass | undefined => {
    const app = doc.querySelector('ytd-app') ?? doc.body;
    if (!app) return undefined;
    // The columns found (a column inside another is walked with it), or the whole app.
    const found = COLUMN_SOURCES.map(element).filter((e): e is Element => Boolean(e?.isConnected));
    // A walker never filters its own root: a column that is itself a known part (the masthead bar
    // has its own plate) is left out here, as the filter would leave it out of a wider walk.
    const skipped = (e: Element) =>
      knownSingles.has(e) || items.has(e) || e.hasAttribute('hidden') || e.matches(OVER_PICTURE);
    const columns = found.filter(
      (e) => !skipped(e) && !found.some((other) => other !== e && other.contains(e) && !skipped(other)),
    );
    // Every column skipped (all known): nothing of them to walk. None found at all: the whole app.
    if (found.length && !columns.length) return undefined;
    const [root, ...rest] = columns.length ? columns : [app];
    const state: Pass = { root: root!, rest, plated: new Set(), opaque: new Map(), visited: 0, walker: undefined! };
    state.walker = walkerFor(state, root!);
    return state;
  };
  /**
   * A part of the walk: `limit` nodes, then on in the next read. A walk starts at most once a
   * RETRY_MS and after every page change. Text counts when it has a readable size and is on
   * screen or within a screen of it (so a column is plated before its text scrolls in).
   */
  const walk = (now: number, limit: number) => {
    if (!pass) {
      if (now - passAt < RETRY_MS) return;
      pass = startPass();
      if (!pass) {
        // Nothing to walk now (every column is a known part): no column plates until the next try.
        passAt = now;
        plated = [];
        return;
      }
    }
    // The page removed the node the walk stood on: walk again from the top next read.
    if (!pass.walker.currentNode.isConnected) {
      pass = undefined;
      passAt = -Infinity;
      return;
    }
    const w = view.innerWidth,
      h = view.innerHeight;
    pass.visited = 0;
    while (pass.visited < limit) {
      const node = pass.walker.nextNode();
      if (!node && pass.rest.length) {
        // The next column: same pass, same plated set.
        pass.root = pass.rest.shift()!;
        pass.walker = walkerFor(pass, pass.root);
        continue;
      }
      if (!node) {
        plated = [...pass.plated];
        pass = undefined;
        passAt = now;
        return;
      }
      const parent = node.parentElement;
      if (!parent) continue;
      textRange.selectNodeContents(node);
      const r = textRange.getBoundingClientRect();
      if (r.width < TEXT_MIN_W || r.height < TEXT_MIN_H) continue;
      if (r.bottom < -h || r.top > 2 * h || r.right < 0 || r.left > w) continue;
      // Text not shown (a tooltip waiting, opacity 0) needs no plate.
      if (!parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (overOpaque(parent, pass)) continue;
      pass.plated.add(columnOf(parent, pass.root));
    }
  };
  /** The columns last reported on the console (development builds only). */
  let loggedColumns = '';
  const fallbackColumns = () => {
    const out = new Set<Element>();
    for (const e of plated) if (e.isConnected) out.add(e);
    if (pass) for (const e of pass.plated) out.add(e);
    return out;
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
          pass = undefined;
          plated = [];
          passAt = -Infinity;
        },
      };
    },
    refresh() {
      // The page changed (the adapter's notice): look for parts and list items again next read,
      // and measure the text bounds again (the old ones serve until then).
      listsAt = -Infinity;
      generation++;
      for (const [source, cached] of found) if (!cached.element) found.delete(source);
      // A new walk over the changed page; the columns plated now stay until it finishes.
      passAt = -Infinity;
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
      knownSingles.clear();
      for (const source of singles) {
        const e = element(source);
        if (!e) continue;
        knownSingles.add(e);
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
      // After the known parts are looked up, so the walk sees this read's parts as known.
      walk(now, budget === Infinity ? WALK_IDLE : WALK_ACTIVE);
      const columns = fallbackColumns();
      for (const column of columns) {
        const r = column.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          out.push({ left: r.left, top: r.top, width: r.width, height: r.height, importance: 'read', fallback: true });
      }
      AROUND_DEV_LOG: {
        // The way out working means a known part's name no longer matches YouTube's page: the
        // small plates were lost silently. Said once per change of the plated columns.
        const names = [...columns].map((e) => `${e.localName}${e.id ? `#${e.id}` : ''}`);
        const key = names.join(' ');
        if (key !== loggedColumns) {
          loggedColumns = key;
          if (names.length)
            console.info(
              `[Around] 読みやすさの逃げ道：名前の分からない部品の文字に、列ごとの板を敷きました（列 ${names.length} 本: ${key}）`,
            );
        }
      }
      return out;
    },
    scheme: () => (doc.documentElement.hasAttribute('dark') ? 'dark' : 'light'),
    video: () => element(VIDEO) as HTMLVideoElement | undefined,
    theater: () => element(WATCH)?.hasAttribute('theater') ?? false,
  };
}
