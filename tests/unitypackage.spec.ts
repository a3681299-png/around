import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
// @ts-expect-error The script is plain ESM without types.
import { readUnityPackage, extractUnityPackage } from '../scripts/characters/unitypackage.mjs';

/** One ustar entry (name split into prefix/name when longer than 100 bytes). */
function tarEntry(name: string, body: Buffer | string, type = '0') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const header = Buffer.alloc(512);
  let prefix = '',
    rest = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut);
    rest = name.slice(cut + 1);
  }
  header.write(rest, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}
/** A GNU long name entry ('L') followed by the entry it names. */
const longName = (name: string, body: string) =>
  Buffer.concat([tarEntry('././@LongLink', name + '\0', 'L'), tarEntry(name.slice(0, 99), body)]);
const pack = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

const guidA = '0123456789abcdef0123456789abcdef',
  guidB = 'fedcba9876543210fedcba9876543210',
  guidC = '11111111111111111111111111111111';

test('reads each GUID folder: its pathname, asset and meta', () => {
  const entries = readUnityPackage(
    pack(
      tarEntry(`${guidA}/`, '', '5'),
      tarEntry(`${guidA}/pathname`, 'Assets/Mirdo/FBX/mirdo.fbx\n00'),
      tarEntry(`${guidA}/asset`, 'FBXDATA'),
      tarEntry(`${guidA}/asset.meta`, 'guid: a'),
      tarEntry(`${guidB}/pathname`, 'Assets/Mirdo/Textures'),
      // A folder entry: a pathname and meta, no asset.
      tarEntry(`${guidB}/asset.meta`, 'folderAsset: yes'),
    ),
  );
  expect(entries).toEqual([
    { guid: guidA, pathname: 'Assets/Mirdo/FBX/mirdo.fbx', size: 7, hasMeta: true },
    { guid: guidB, pathname: 'Assets/Mirdo/Textures', size: 0, hasMeta: true },
  ]);
});

test('extracts the assets under their original names and filters by extension', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'ww-unitypackage-'));
  try {
    const source = path.join(out, 'in.unitypackage');
    await writeFile(
      source,
      pack(
        tarEntry(`${guidA}/pathname`, 'Assets/Mirdo/FBX/mirdo.fbx'),
        tarEntry(`${guidA}/asset`, 'FBXDATA'),
        tarEntry(`${guidB}/pathname`, 'Assets/Mirdo/Textures/body.png'),
        tarEntry(`${guidB}/asset`, 'PNG'),
        tarEntry(`${guidC}/pathname`, 'Assets/Mirdo/Scripts/x.cs'),
        tarEntry(`${guidC}/asset`, 'class X {}'),
      ),
    );
    const target = path.join(out, 'extracted');
    const written = await extractUnityPackage(source, target, { extensions: ['.fbx', '.png'] });
    expect(written.map((w: { pathname: string }) => w.pathname)).toEqual([
      'Assets/Mirdo/FBX/mirdo.fbx',
      'Assets/Mirdo/Textures/body.png',
    ]);
    expect(await readFile(path.join(target, 'Assets/Mirdo/FBX/mirdo.fbx'), 'utf8')).toBe('FBXDATA');
    expect(existsSync(path.join(target, 'Assets/Mirdo/Scripts/x.cs'))).toBe(false);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('tar names written as ./GUID/file, in ustar prefix form or as GNU long names, keep their GUID folder', () => {
  const long = 'Assets/' + 'very-long-folder-name/'.repeat(8) + 'mirdo.fbx';
  const entries = readUnityPackage(
    pack(
      tarEntry(`./${guidA}/pathname`, long),
      longName(`./${guidA}/asset`, 'X'),
      tarEntry(`${guidB}/pathname`, 'Assets/b.png'),
      tarEntry(`./${guidB}/asset`, 'PNG'),
    ),
  );
  expect(entries).toEqual([
    { guid: guidA, pathname: long, size: 1, hasMeta: false },
    { guid: guidB, pathname: 'Assets/b.png', size: 3, hasMeta: false },
  ]);
});

test('a pathname that leaves the target folder is refused, not written', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'ww-unitypackage-'));
  try {
    for (const bad of [
      '../evil.fbx',
      'Assets/../../evil.fbx',
      'C:/Windows/evil.fbx',
      '/etc/evil.fbx',
      'Assets\\..\\..\\evil.fbx',
    ]) {
      const source = path.join(out, 'bad.unitypackage');
      await writeFile(source, pack(tarEntry(`${guidA}/pathname`, bad), tarEntry(`${guidA}/asset`, 'X')));
      await expect(extractUnityPackage(source, path.join(out, 'extracted')), bad).rejects.toThrow(/outside/);
    }
    expect(existsSync(path.join(out, 'evil.fbx'))).toBe(false);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
