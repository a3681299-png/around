import { RASTER_LIMITS, type AnimationInfo } from './motion-types';
import type { AssetInfo } from './validation';

const invalid = () => new Error('GIF／アニメーションWebPの形式が不正です。');
const text = (data: Uint8Array, start: number, length: number) => String.fromCharCode(...data.subarray(start, start + length));
const delay = (ms: number) => ms === 0 ? 100 : Math.max(20, ms);

function result(mime: 'image/gif' | 'image/webp', width: number, height: number, durations: number[], loopCount: number): AssetInfo {
  const durationMs = durations.reduce((total, ms) => total + ms, 0);
  if (!durations.length || durations.length > RASTER_LIMITS.frames || !Number.isFinite(durationMs)
    || width < 1 || height < 1 || width > RASTER_LIMITS.edge || height > RASTER_LIMITS.edge
    || width * height > RASTER_LIMITS.pixels) throw new Error('アニメーションの1フレームは4096px・16M画素以内にしてください。');
  const animation: AnimationInfo = { format: mime === 'image/gif' ? 'gif' : 'animated-webp', frameCount: durations.length, durationMs, frameDurationsMs: durations, loopCount };
  return { mime, width, height, animation };
}

export function inspectGif(data: Uint8Array): AssetInfo {
  if (data.length < 14 || !['GIF87a', 'GIF89a'].includes(text(data, 0, 6))) throw invalid();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(6, true), height = view.getUint16(8, true);
  let offset = 13 + (data[10]! & 128 ? 3 * 2 ** ((data[10]! & 7) + 1) : 0), pendingDelay = 100, loopCount = 1, blocks = 0;
  const durations: number[] = [];
  const skipBlocks = () => {
    while (offset < data.length) { const size = data[offset++]!; if (size === 0) return; offset += size; if (offset > data.length) throw invalid(); }
    throw invalid();
  };
  while (offset < data.length && ++blocks <= RASTER_LIMITS.chunks) {
    const block = data[offset++]!;
    if (block === 0x3b) { if (offset !== data.length) throw invalid(); return result('image/gif', width, height, durations, loopCount); }
    if (block === 0x21) {
      const type = data[offset++];
      if (type === 0xf9) {
        if (offset + 6 > data.length || data[offset] !== 4 || data[offset + 5] !== 0) throw invalid();
        pendingDelay = delay(view.getUint16(offset + 2, true) * 10); offset += 6;
      } else {
        if (type === 0xff && data[offset] === 11 && text(data, offset + 1, 11) === 'NETSCAPE2.0' && data[offset + 12] === 3 && data[offset + 13] === 1 && offset + 16 < data.length) loopCount = view.getUint16(offset + 14, true);
        skipBlocks();
      }
    } else if (block === 0x2c) {
      if (offset + 10 > data.length) throw invalid();
      const x = view.getUint16(offset, true), y = view.getUint16(offset + 2, true), w = view.getUint16(offset + 4, true), h = view.getUint16(offset + 6, true), flags = data[offset + 8]!;
      if (!w || !h || x + w > width || y + h > height) throw invalid();
      offset += 9 + (flags & 128 ? 3 * 2 ** ((flags & 7) + 1) : 0);
      const codeSize = data[offset++]; if (codeSize === undefined || codeSize < 2 || codeSize > 8) throw invalid();
      skipBlocks(); durations.push(pendingDelay); pendingDelay = 100;
      if (durations.length > RASTER_LIMITS.frames) throw invalid();
    } else throw invalid();
  }
  throw invalid();
}

export function inspectAnimatedWebp(data: Uint8Array): AssetInfo | undefined {
  if (data.length < 30 || text(data, 0, 4) !== 'RIFF' || text(data, 8, 4) !== 'WEBP' || text(data, 12, 4) !== 'VP8X' || !(data[20]! & 2)) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(4, true) + 8 !== data.length) throw invalid();
  const u24 = (p: number) => data[p]! + (data[p + 1]! << 8) + (data[p + 2]! << 16);
  let offset = 12, width = 0, height = 0, hasHeader = false, hasAnimation = false, chunks = 0, loopCount = 1;
  const durations: number[] = [];
  while (offset + 8 <= data.length && ++chunks <= RASTER_LIMITS.chunks) {
    const kind = text(data, offset, 4), length = view.getUint32(offset + 4, true), p = offset + 8;
    if (length > data.length - p) throw invalid();
    if (kind === 'VP8X') { if (hasHeader || length !== 10) throw invalid(); width = u24(p + 4) + 1; height = u24(p + 7) + 1; hasHeader = true; }
    if (kind === 'ANIM') { if (!hasHeader || hasAnimation || length !== 6) throw invalid(); hasAnimation = true; loopCount = view.getUint16(p + 4, true); }
    if (kind === 'ANMF') {
      if (!hasAnimation || length < 24 || u24(p) * 2 + u24(p + 6) + 1 > width || u24(p + 3) * 2 + u24(p + 9) + 1 > height) throw invalid();
      durations.push(delay(u24(p + 12)));
      if (durations.length > RASTER_LIMITS.frames) throw invalid();
    }
    offset = p + length + length % 2;
  }
  if (offset !== data.length || !hasAnimation) throw invalid();
  return result('image/webp', width, height, durations, loopCount);
}
