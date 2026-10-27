// Deliberately plain 9-slice test art, with a different solid colour in every region.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../../tests/fixtures/skins/', import.meta.url));
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(type, bytes) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
await mkdir(directory, { recursive: true });
for (const [name, center] of [
  ['frame-light', [245, 245, 245]],
  ['frame-dark', [17, 17, 17]],
]) {
  const width = 96,
    height = 96,
    rows = Buffer.alloc(height * (1 + width * 4));
  const colours = [
    [224, 48, 48],
    [0, 112, 192],
    [255, 128, 0],
    [128, 64, 192],
    center,
    [0, 144, 96],
    [192, 48, 144],
    [208, 160, 0],
    [0, 160, 192],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const column = x < 24 ? 0 : x < 72 ? 1 : 2;
      const row = y < 24 ? 0 : y < 72 ? 1 : 2;
      const offset = y * (1 + width * 4) + 1 + x * 4;
      rows.set([...colours[row * 3 + column], 255], offset);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    path.join(directory, `${name}.png`),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
