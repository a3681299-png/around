// Serves the living room from an R2 bucket (docs/living-room-hosting.md). Cloudflare Pages stops
// at 25 MiB a file and the room's model is near that; a bucket has no such limit. This Worker is
// the only code on the public side, so it does as little as it can: it reads files, only the
// bucket's own, and answers nothing else. Who may open it is Cloudflare Access's affair (in front
// of this Worker), not this code's.

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  glb: 'model/gltf-binary',
  vrm: 'model/gltf-binary',
  vrma: 'model/gltf-binary',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
};
const SECURITY = {
  // A private room: not for a search engine, and a file is only ever what it says it is.
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/**
 * The bucket key for a request path, or undefined for a path that is not a file of the room:
 * anything with a dot-dot segment, an empty segment (`//`), a backslash or a null, however it is
 * written (percent-encoded too: the path is decoded before it is looked at).
 */
export function keyOf(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0')) return undefined;
  if (path === '/') return 'index.html';
  const parts = path.slice(1).split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;
  return parts.join('/');
}

const refuse = (status, text) =>
  new Response(text, { status, headers: { ...SECURITY, 'content-type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405, 'GET only');
    const key = keyOf(new URL(request.url).pathname);
    if (key === undefined) return refuse(404, 'not found');
    // (Ranges and "unchanged since" go to the bucket as the browser sent them.)
    const object = await env.ROOM.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) return refuse(404, 'not found');
    const headers = new Headers(SECURITY);
    object.writeHttpMetadata?.(headers);
    headers.set('etag', object.httpEtag);
    const type = TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()];
    // (Whatever the file was stored as, it is given the kind its name says, or plain bytes.)
    headers.set('content-type', type ?? 'application/octet-stream');
    // A private page is kept by the browser only, and checked again each time: the room is
    // changed by uploading a new build, and a visit should see it.
    headers.set('cache-control', 'private, no-cache');
    headers.set('accept-ranges', 'bytes');
    // The bucket answers "unchanged" with no body.
    if (!('body' in object)) return new Response(null, { status: 304, headers });
    const ranged = object.range && request.headers.has('range');
    if (ranged && object.range.offset !== undefined) {
      const start = object.range.offset,
        end = start + (object.range.length ?? object.size - start) - 1;
      headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { status: ranged ? 206 : 200, headers });
  },
};
