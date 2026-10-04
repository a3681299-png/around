import type { SiteFeatureInstance } from './types';

const BOARD = 'ytd-comments';
const COMMENT = 'ytd-comment-view-model, ytd-comment-renderer';
const THREAD = 'ytd-comment-thread-renderer';
const REPLIES = 'ytd-comment-replies-renderer, #replies';
const OWNED = 'data-ww-bbs-owned';
const MARKERS = ['data-ww-bbs', 'data-ww-bbs-board', 'data-ww-bbs-row', 'data-ww-bbs-index', 'data-ww-bbs-reply', 'data-ww-bbs-header'] as const;
const MARKED = MARKERS.map(name => `[${name}]`).join(', ');
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** Only an explicit full timestamp with a timezone can supply an exact clock time.
 * Keep its source timezone rather than silently replacing it with the viewer's.
 * Never parse relative labels, tooltip prose, date-only values, or video metadata.
 */
export function formatExactCommentTimestamp(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] ?? 0);
  const zone = match[8]!;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!
    || hour > 23 || minute > 59 || second > 59
    || zone === '-00:00' // RFC 3339's unknown-offset marker is not a known timezone.
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) return null;
  // setUTCFullYear avoids Date.UTC's special interpretation of years below 100.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return `${match[1]}/${match[2]}/${match[3]}(${WEEKDAYS[date.getUTCDay()]}) ${match[4]}:${match[5]}`;
}

function owner(element: Element): Element | null {
  return element.closest(COMMENT) ?? element.closest(THREAD);
}

function ownElements(row: Element, selector: string): Element[] {
  return [...row.querySelectorAll(selector)].filter(element => owner(element) === row && !element.closest(`[${OWNED}]`));
}

function exactDate(row: Element, header: Element | null): { source: Element; raw: string; formatted: string } | null {
  // Scope ordinary <time> elements to the native publication slot/header. A time
  // quoted in the comment body, a reply, or page metadata is never its post date.
  const published = ownElements(row, '#published-time-text')[0];
  const candidates = ownElements(row, '[itemprop~="datePublished"]').filter(source =>
    source.parentElement === row || header?.contains(source) || published?.contains(source));
  if (published) {
    if (published.matches('time[datetime]')) candidates.push(published);
    candidates.push(...ownElements(row, '#published-time-text time[datetime]'));
  }
  if (header) candidates.push(...ownElements(row, 'time[datetime]').filter(element => header.contains(element)));
  for (const source of candidates) {
    const raw = source.getAttribute('datetime') ?? source.getAttribute('content');
    if (!raw) continue;
    const formatted = formatExactCommentTimestamp(raw);
    if (formatted) return { source, raw, formatted };
  }
  return null;
}


function isDisplayed(row: Element, view: Window): boolean {
  // Collapsed reply DOM is often retained. Count only currently displayed rows,
  // while keeping off-screen (but laid-out) comments in the same sequence.
  if (row.closest('[hidden], [aria-hidden="true"]')) return false;
  if (row.closest('ytd-comment-replies-renderer[collapsed], #replies[collapsed], ytd-comment-replies-renderer[aria-expanded="false"], #replies[aria-expanded="false"]')) return false;
  const visibility = view.getComputedStyle(row).visibility;
  return visibility !== 'hidden' && visibility !== 'collapse' && row.getClientRects().length > 0;
}

type RowState = { number: HTMLElement; date: HTMLElement | null };
type AttributeMap = Map<Element, Map<string, string>>;

/** Add only reversible annotations; native comments, dates, links, and controls
 * retain their nodes, text, event handlers, DOM order, and accessibility content.
 */
export function mountYouTubeComments(doc: Document): SiteFeatureInstance {
  const root = doc.documentElement;
  const view = doc.defaultView!;
  const rows = new Map<Element, RowState>();
  const attributes: AttributeMap = new Map();
  let frame: number | undefined;
  let destroyed = false;
  let navigating = false;

  const syncAttributes = (wanted: AttributeMap) => {
    // Native virtualization may clone a decorated row. Adopt copied annotations
    // as our own too, so they never survive OFF or a changed reply/header role.
    for (const element of doc.querySelectorAll(MARKED)) {
      let values = attributes.get(element);
      if (!values) { values = new Map(); attributes.set(element, values); }
      for (const name of MARKERS) {
        const value = element.getAttribute(name);
        if (value !== null && !values.has(name)) values.set(name, value);
      }
    }
    for (const [element, values] of attributes) {
      for (const name of values.keys()) {
        if (wanted.get(element)?.has(name)) continue;
        element.removeAttribute(name);
        values.delete(name);
      }
      if (values.size === 0) attributes.delete(element);
    }
    for (const [element, values] of wanted) {
      let saved = attributes.get(element);
      if (!saved) { saved = new Map(); attributes.set(element, saved); }
      for (const [name, value] of values) {
        saved.set(name, value);
        if (element.getAttribute(name) !== value) element.setAttribute(name, value);
      }
    }
  };
  const cleanRows = () => {
    for (const state of rows.values()) { state.number.remove(); state.date?.remove(); }
    rows.clear();
    doc.querySelectorAll(`[${OWNED}]`).forEach(node => node.remove());
    syncAttributes(new Map());
  };
  const decoration = (kind: 'number' | 'date') => {
    const span = doc.createElement('span');
    span.setAttribute(OWNED, '');
    span.setAttribute(`data-ww-bbs-${kind}`, '');
    span.setAttribute('aria-hidden', 'true');
    return span;
  };
  const flush = () => {
    frame = undefined;
    if (destroyed || navigating) return;
    const knownNodes = new Set([...rows.values()].flatMap(state => state.date ? [state.number, state.date] : [state.number]));
    doc.querySelectorAll<HTMLElement>(`[${OWNED}]`).forEach(node => { if (!knownNodes.has(node)) node.remove(); });
    const wanted: AttributeMap = new Map();
    const mark = (element: Element, name: string, value = '') => {
      let values = wanted.get(element);
      if (!values) { values = new Map(); wanted.set(element, values); }
      values.set(name, value);
    };
    const present = new Set<Element>();
    // Read visibility before changing any row, avoiding a read/write layout loop.
    const displayed = new Set([...doc.querySelectorAll(`${COMMENT}, ${THREAD}`)].filter(row => isDisplayed(row, view)));
    for (const board of doc.querySelectorAll(BOARD)) {
      mark(board, 'data-ww-bbs-board');
      let index = 0;
      for (const row of board.querySelectorAll(`${COMMENT}, ${THREAD}`)) {
        if (row.closest(BOARD) !== board || !displayed.has(row)) continue;
        if (row.matches(THREAD)) {
          // Legacy fixtures/markup can have the main comment directly in a thread.
          // Replies alone must not prevent that main comment getting a number.
          if ([...row.querySelectorAll(COMMENT)].some(comment =>
            comment.closest(THREAD) === row && !comment.closest(REPLIES))) continue;
        } else if ([...row.querySelectorAll(COMMENT)].some(child => child.closest(REPLIES) === row.closest(REPLIES))) continue; // nested renderer wrapper
        if (ownElements(row, '#content-text, #author-text').length === 0) continue; // not loaded yet
        present.add(row);
        const header = ownElements(row, '#header-author')[0] ?? ownElements(row, '#header')[0] ?? null;
        const author = ownElements(row, '#author-text')[0];
        // An adjacent span is safe even when no native header is available.
        const mount = header ?? author?.parentElement ?? row;
        let state = rows.get(row);
        if (!state) { state = { number: decoration('number'), date: null }; rows.set(row, state); }
        const number = String(++index);
        if (state.number.textContent !== number) state.number.textContent = number;
        if (mount.firstChild !== state.number) mount.prepend(state.number);
        mark(row, 'data-ww-bbs-row');
        mark(row, 'data-ww-bbs-index', number);
        if (row.closest(REPLIES)) mark(row, 'data-ww-bbs-reply');
        if (header) mark(header, 'data-ww-bbs-header');
        const stamp = exactDate(row, ownElements(row, '#header')[0] ?? header);
        if (stamp) {
          if (!state.date) state.date = decoration('date');
          if (state.date.textContent !== stamp.formatted) state.date.textContent = stamp.formatted;
          if (state.date.title !== stamp.raw) state.date.title = stamp.raw;
          // Keep the original publication link and relative label available.
          const nativeDate = ownElements(row, '#published-time-text')[0];
          const anchor = nativeDate ?? (stamp.source.tagName === 'META' ? null : stamp.source);
          if (anchor?.parentElement) {
            if (anchor.nextSibling !== state.date) anchor.after(state.date);
          } else if (state.date.parentElement !== mount) mount.append(state.date);
        } else { state.date?.remove(); state.date = null; }
      }
    }
    for (const [row, state] of rows) {
      if (present.has(row)) continue;
      state.number.remove(); state.date?.remove(); rows.delete(row);
    }
    if (present.size > 0) mark(root, 'data-ww-bbs');
    syncAttributes(wanted);
  };
  const refresh = () => {
    if (!destroyed && !navigating && frame === undefined) frame = view.requestAnimationFrame(flush);
  };
  const isOwned = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest(`[${OWNED}]`);
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      if (isOwned(record.target)) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(isOwned)) return false;
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      if (element?.closest(BOARD)) return true;
      if (record.type === 'attributes' && element?.querySelector(BOARD)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
        && ((node as Element).matches(BOARD) || (node as Element).querySelector(BOARD)));
    })) refresh();
  });
  const startNavigation = () => {
    navigating = true;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    cleanRows();
  };
  const finishNavigation = () => { navigating = false; refresh(); };
  observer.observe(root, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['id', 'datetime', 'content', 'itemprop', 'hidden', 'aria-hidden', 'aria-expanded', 'collapsed', 'class', 'style'],
  });
  doc.addEventListener('yt-navigate-start', startNavigation);
  doc.addEventListener('yt-navigate-finish', finishNavigation);
  doc.addEventListener('yt-page-data-updated', refresh);
  view.addEventListener('popstate', finishNavigation);
  view.addEventListener('pageshow', finishNavigation);
  flush();
  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
      doc.removeEventListener('yt-navigate-start', startNavigation);
      doc.removeEventListener('yt-navigate-finish', finishNavigation);
      doc.removeEventListener('yt-page-data-updated', refresh);
      view.removeEventListener('popstate', finishNavigation);
      view.removeEventListener('pageshow', finishNavigation);
      cleanRows();
    },
  };
}
