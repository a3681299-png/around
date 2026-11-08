import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** The static preview and browser tests use the same byte ranges for native video seeking. */
export function createPlaygroundServer(directory) {
  const root = realpathSync(directory);
  return createServer((request, response) => {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host ?? '')) return response.writeHead(403).end();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      return response.writeHead(400).end();
    }
    const requested = resolve(root, '.' + pathname.replace(/\/$/, '/index.html'));
    if (!requested.startsWith(root + sep)) return response.writeHead(404).end();
    let file;
    try {
      file = realpathSync(requested);
    } catch {
      return response.writeHead(404).end();
    }
    if (!file.startsWith(root + sep)) return response.writeHead(404).end();
    const size = statSync(file, { throwIfNoEntry: false });
    if (!size?.isFile()) return response.writeHead(404).end();

    const ext = extname(file);
    const headers = {
      'content-type': types[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      ...(ext === '.webm' ? { 'accept-ranges': 'bytes' } : {}),
    };
    const range = ext === '.webm' ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '') : null;
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), size.size - 1) : size.size - 1;
    if (range && start > end) return response.writeHead(416, { 'content-range': `bytes */${size.size}` }).end();
    response.writeHead(range ? 206 : 200, {
      ...headers,
      'content-length': Math.max(0, end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size.size}` } : {}),
    });
    if (request.method === 'HEAD' || size.size === 0) return response.end();
    const stream = createReadStream(file, { start, end });
    response.once('close', () => stream.destroy());
    stream.once('error', () => response.destroy());
    stream.pipe(response);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? 'dist-playground');
  if (!statSync(resolve(directory, 'index.html'), { throwIfNoEntry: false })?.isFile())
    throw new Error('Build the Playground and pass its output folder.');
  const port = Number(process.argv[3] ?? 4173);
  createPlaygroundServer(directory).listen(port, '127.0.0.1', () =>
    console.log(`Playground preview: http://127.0.0.1:${port}/`),
  );
}
