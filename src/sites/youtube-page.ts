/**
 * YouTube's page identity (SiteAdapter.signals.page): the kind of page and what it shows, never
 * the whole address. A video's page stays the same page through `t=`, a playlist or other query
 * changes on the same video, so a character's autonomy is not dropped there (src/world/models.ts
 * startPage); another video, a new search, Shorts and other pages are new pages.
 */
export function youtubePage(url: URL): string {
  const path = url.pathname;
  if (path === '/watch') return `watch:${url.searchParams.get('v') ?? ''}`;
  const short = /^\/shorts\/([^/]+)/.exec(path);
  if (short) return `shorts:${short[1]}`;
  if (path === '/results') return `results:${url.searchParams.get('search_query') ?? ''}`;
  if (path === '/playlist') return `playlist:${url.searchParams.get('list') ?? ''}`;
  return `path:${path}`;
}
