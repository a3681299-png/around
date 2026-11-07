// Packs a baked room (scripts/room/build_room.py) into the one .glb the engine reads
// (docs/depth-foundation.md, "部屋の素材"). The light layers, baked to 16-bit EXR, go into the
// .glb as embedded PNG textures in a square-root encoding with one scale per layer, listed in the
// root's extras under `wwtRoom`. The engine never reads EXR: the room is one model asset, checked
// by the same GLB inspection as any other.
//
//   node scripts/room/pack-room.mjs <room.glb> <lightmap dir> <size> <out.glb>
//
// The room's files are private (docs/product-design-snapshot.md, 部屋の素材の約束): the inputs and
// the output stay outside the repository (WW_ROOM_OUT, wwt-private-assets).
import fs from 'node:fs';
import path from 'node:path';
import { zlibSync } from 'fflate';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { FloatType } from 'three';

export const ROOM_LAYERS = ['sun_night', 'room_desk', 'room_pendant', 'screen', 'screen_monitor'];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** An 8-bit RGB PNG (no filtering: the encoder stays a few lines). */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Linear light to 8 bits: sqrt(v / scale). The scale is the layer's 99.9th percentile, so a few
 * hot texels (the lamp's own bulb) clip instead of crushing the rest of the layer. */
export function encodeLayer(width, height, rgba, flipRows = true) {
  const values = [];
  for (let i = 0; i < rgba.length; i += 4) values.push(Math.max(rgba[i], rgba[i + 1], rgba[i + 2]));
  values.sort((a, b) => a - b);
  const scale = Math.max(1e-4, values[Math.floor(values.length * 0.999)]);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    // EXR rows from three's loader start at the bottom; a glTF image's first row is v = 0 (the top).
    const from = flipRows ? height - 1 - y : y;
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        const v = Math.max(0, rgba[(from * width + x) * 4 + c]);
        rgb[(y * width + x) * 3 + c] = Math.min(255, Math.round(Math.sqrt(v / scale) * 255));
      }
  }
  return { png: encodePng(width, height, rgb), scale };
}

function readGlb(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binAt = 20 + jsonLength;
  const bin = bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt));
  return { json, bin };
}
function writeGlb(json, bin) {
  const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
  const jsonBytes = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binBytes = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  const head = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([
    header,
    head(jsonBytes.length, 0x4e4f534a),
    jsonBytes,
    head(binBytes.length, 0x004e4942),
    binBytes,
  ]);
}

export function packRoom(glbBytes, layers) {
  const { json, bin } = readGlb(glbBytes);
  const parts = [bin];
  let length = bin.length;
  const align = () => {
    const extra = (4 - (length % 4)) % 4;
    if (extra) {
      parts.push(Buffer.alloc(extra));
      length += extra;
    }
  };
  json.images ??= [];
  json.textures ??= [];
  json.samplers ??= [];
  const sampler = json.samplers.push({ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }) - 1;
  const listed = [];
  for (const layer of layers) {
    align();
    const view = json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: layer.png.length }) - 1;
    parts.push(layer.png);
    length += layer.png.length;
    const image = json.images.push({ name: `light_${layer.name}`, mimeType: 'image/png', bufferView: view }) - 1;
    const texture = json.textures.push({ name: `light_${layer.name}`, source: image, sampler }) - 1;
    listed.push({ name: layer.name, texture, scale: Number(layer.scale.toPrecision(6)) });
  }
  align();
  json.buffers = [{ byteLength: length }];
  json.extras = { ...(json.extras ?? {}), wwtRoom: { version: 1, layers: listed } };
  return writeGlb(json, Buffer.concat(parts));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
) {
  const [glb, dir, size = '1024', out] = process.argv.slice(2);
  if (!glb || !dir || !out) {
    console.error('usage: node scripts/room/pack-room.mjs <room.glb> <lightmap dir> <size> <out.glb>');
    process.exit(2);
  }
  const loader = new EXRLoader().setDataType(FloatType);
  const layers = ROOM_LAYERS.map((name) => {
    const file = fs.readFileSync(path.join(dir, `${name}-${size}.exr`));
    const exr = loader.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    const { png, scale } = encodeLayer(exr.width, exr.height, exr.data);
    console.log(
      `${name}: ${exr.width}x${exr.height}, scale ${scale.toFixed(3)}, ${(png.length / 1024).toFixed(0)} KiB`,
    );
    return { name, png, scale };
  });
  fs.writeFileSync(out, packRoom(fs.readFileSync(glb), layers));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MiB)`);
}
