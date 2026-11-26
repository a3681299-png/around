/**
 * A YouTube address, read (docs/living-live.md). Whatever the viewer pastes is only ever turned
 * into a video id of YouTube's own shape (eleven letters, digits, - and _); the player's address
 * is then built from fixed text and that id. Nothing of the pasted text reaches the page as markup
 * or as an address.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);

export function youtubeId(text: string): string | undefined {
  const raw = text.trim();
  if (ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | undefined;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (HOSTS.has(host))
    id =
      url.pathname === '/watch'
        ? (url.searchParams.get('v') ?? undefined)
        : /^\/(?:embed|live|shorts|v)\/([^/]+)/.exec(url.pathname)?.[1];
  return id && ID.test(id) ? id : undefined;
}

/** The embedded player's address for a checked id (the privacy-enhanced host; no related videos
 * from elsewhere at the end; the player answers this page's own origin only). */
export const embedUrl = (id: string, origin: string) =>
  `https://www.youtube-nocookie.com/embed/${ID.test(id) ? id : ''}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(origin)}`;

export const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';
export const isVideoId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);
