#!/usr/bin/env node
// Reads a Unity package (.unitypackage) without Unity: it is a gzip'd tar with one folder per asset
// GUID, holding `pathname` (the asset's path in the Unity project), `asset` (its bytes, absent for
// folders) and `asset.meta`. The assets are written under their original paths, so FBX files find
// their textures by the names the author gave them. Kept free of dependencies so the product's
// character import (R7) can use the same reader.
//
//   node scripts/characters/unitypackage.mjs <package> --list
//   node scripts/characters/unitypackage.mjs <package> <out-dir> [--ext .fbx,.png,...]
//
// A package is someone else's file: a pathname that would leave <out-dir> (.., an absolute path,
// a drive letter) stops the extraction before anything is written, and only regular files are read
// (links in the tar are ignored).
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUID = /^[0-9a-f]{32}$/i;

/** The NUL-terminated text of a header field. */
const field = (block, start, length) => {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
};

/** Every regular file in a tar, by its full name (ustar prefix, GNU long names and pax paths). */
function* tarFiles(tar) {
  let offset = 0,
    longName,
    paxPath;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`Broken tar header at ${offset}`);
    const type = String.fromCharCode(header[156] || 48);
    const bodyStart = offset + 512;
    const body = tar.subarray(bodyStart, bodyStart + size);
    if (body.length !== size) throw new Error(`Truncated tar entry at ${offset}`);
    offset = bodyStart + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = field(body, 0, body.length);
      continue;
    }
    if (type === 'x') {
      // pax: "<len> path=<value>\n" records.
      for (const record of body.toString('utf8').split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(record);
        if (match) paxPath = match[1];
      }
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(header, 345, 155);
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = paxPath = undefined;
    if (type === '0' || type === '\0' || type === '7') yield { name, body };
  }
}

/** The package's assets, one per GUID folder, in tar order, with their bytes kept apart. */
function parse(buffer) {
  const folders = new Map();
  for (const { name, body } of tarFiles(gunzipSync(buffer))) {
    const parts = name.replace(/^\.\//, '').split('/');
    if (parts.length !== 2 || !GUID.test(parts[0])) continue;
    const [guid, file] = parts;
    const folder = folders.get(guid) ?? {};
    folders.set(guid, folder);
    if (file === 'pathname') folder.pathname = body.toString('utf8').split('\n')[0].trim();
    else if (file === 'asset') folder.asset = body;
    else if (file === 'asset.meta') folder.meta = true;
  }
  return [...folders].filter(([, f]) => f.pathname).map(([guid, f]) => ({ guid, ...f }));
}

/** The package's entries: GUID, original path, asset size (0 for a folder) and whether it has a meta. */
export function readUnityPackage(buffer) {
  return parse(buffer).map(({ guid, pathname, asset, meta }) => ({
    guid,
    pathname,
    size: asset?.length ?? 0,
    hasMeta: Boolean(meta),
  }));
}

/** Where a package path lands under `out`; throws when it would land outside. */
function inside(out, pathname) {
  const normal = pathname.replace(/\\/g, '/');
  if (/^[a-z]:/i.test(normal) || normal.startsWith('/') || normal.split('/').includes('..'))
    throw new Error(`Package path outside the target folder: ${pathname}`);
  const target = path.resolve(out, normal);
  const relative = path.relative(path.resolve(out), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Package path outside the target folder: ${pathname}`);
  return target;
}

/**
 * Writes the package's assets under `out` at their original paths. `extensions` (lower case, with
 * the dot) keeps only those files. Every path is checked before the first write.
 */
export async function extractUnityPackage(file, out, { extensions } = {}) {
  const assets = parse(await readFile(file)).filter((entry) => entry.asset);
  const wanted = assets.filter(
    (entry) => !extensions || extensions.includes(path.extname(entry.pathname).toLowerCase()),
  );
  const targets = wanted.map((entry) => inside(out, entry.pathname));
  const written = [];
  for (const [i, entry] of wanted.entries()) {
    await mkdir(path.dirname(targets[i]), { recursive: true });
    await writeFile(targets[i], entry.asset);
    written.push({ guid: entry.guid, pathname: entry.pathname, size: entry.asset.length });
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, second, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: unitypackage.mjs <package> (--list | <out-dir> [--ext .fbx,.png])');
    process.exit(2);
  }
  if (second === '--list' || !second) {
    for (const e of readUnityPackage(await readFile(file)))
      console.log(`${String(e.size).padStart(10)}  ${e.pathname}`);
  } else {
    const ext = rest[rest.indexOf('--ext') + 1];
    const written = await extractUnityPackage(file, second, {
      extensions: rest.includes('--ext') ? ext.split(',').map((s) => s.trim().toLowerCase()) : undefined,
    });
    for (const w of written) console.log(`${String(w.size).padStart(10)}  ${w.pathname}`);
    console.log(`${written.length} files -> ${path.resolve(second)}`);
  }
}
