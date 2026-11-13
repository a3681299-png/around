import { test, expect } from '@playwright/test';
// @ts-expect-error -- a plain .mjs Worker without type declarations
import worker, { keyOf } from '../scripts/living-room/host/worker.mjs';

// The room served from R2 by a Cloudflare Worker (docs/living-room-hosting.md). The Worker is the
// only code on the public side, so its path handling is what is checked: nothing outside the
// bucket's own files, only reading, and never a page for a search engine.

type Fetch = (request: Request, env: unknown) => Promise<Response>;
const handle = (worker as { fetch: Fetch }).fetch;

/** A bucket with a few files; `asked` records every key the Worker looked up. */
function bucket(files: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    env: {
      ROOM: {
        async get(key: string) {
          asked.push(key);
          const body = files[key];
          return body === undefined ? null : { body, size: body.length, httpEtag: '"v1"', writeHttpMetadata() {} };
        },
      },
    },
  };
}
const files = {
  'index.html': '<!doctype html>',
  'app.js': 'console.log(1)',
  'content/room.glb': 'glb',
  'style.css': 'a{}',
};
const get = (path: string, init?: RequestInit) => new Request(`https://living-room.example.test${path}`, init);

test('the page is at the root, and each file is given its own kind', async () => {
  const { env } = bucket(files);
  const root = await handle(get('/'), env);
  expect(root.status).toBe(200);
  expect(root.headers.get('content-type')).toContain('text/html');
  expect(await root.text()).toBe('<!doctype html>');
  expect((await handle(get('/app.js'), env)).headers.get('content-type')).toContain('text/javascript');
  expect((await handle(get('/style.css'), env)).headers.get('content-type')).toContain('text/css');
  expect((await handle(get('/content/room.glb'), env)).headers.get('content-type')).toBe('model/gltf-binary');
});

test('a path cannot leave the room: dots, encoded slashes, backslashes and nulls never reach the bucket as such', async () => {
  // (A key that looks like a way out, present in the bucket, to catch a Worker that would pass it on.)
  const { env, asked } = bucket({ ...files, '../secret': 'x', 'a\\..\\secret': 'x', '\0': 'x', '/secret': 'x' });
  // (The platform's URL parser folds plain `/../` and `%2e%2e` into the path before the Worker
  // sees it, so those land on ordinary keys of the bucket, which holds nothing but the room.)
  for (const path of [
    '/..%2fsecret',
    '/a%5c..%5csecret',
    '/%00',
    '//secret',
    '/content//room.glb',
    '/content%2f..%2f..%2fsecret',
  ])
    expect((await handle(get(path), env)).status, path).toBe(404);
  for (const path of ['/../secret', '/%2e%2e/secret', '/content/../../secret']) await handle(get(path), env);
  expect(
    asked.filter((key) => key.includes('..') || key.includes('\\') || key.includes('\0') || key.startsWith('/')),
  ).toEqual([]);
  expect(keyOf('/%E3%81%82')).toBe('あ');
  expect(keyOf('/%E0%A4%A')).toBeUndefined();
});

test('it only reads: other methods are refused, HEAD gives the headers without the body', async () => {
  const { env } = bucket(files);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
    expect((await handle(get('/', { method }), env)).status, method).toBe(405);
  const head = await handle(get('/app.js', { method: 'HEAD' }), env);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
});

test('what is not there is not found, and no answer invites a search engine or a guess at the type', async () => {
  const { env } = bucket(files);
  const missing = await handle(get('/nothing.png'), env);
  expect(missing.status).toBe(404);
  for (const response of [missing, await handle(get('/'), env), await handle(get('/content/room.glb'), env)]) {
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }
});
