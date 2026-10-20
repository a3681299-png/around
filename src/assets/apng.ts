import { RASTER_LIMITS } from './motion-types';
import type { AssetInfo } from './validation';

const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const invalid = () => new Error('APNGのチャンク・連番・フレーム寸法が不正です。');
export function inspectApng(data: Uint8Array): AssetInfo | undefined {
  if (data.length < 33 || String.fromCharCode(...data.subarray(0, 8)) !== '\x89PNG\r\n\x1a\n') return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8,
    chunks = 0,
    width = 0,
    height = 0,
    declared = 0,
    loopCount = 0,
    sequence = 0,
    seenData = false,
    ended = false,
    frameData = false;
  const durations: number[] = [];
  while (offset + 12 <= data.length && ++chunks <= RASTER_LIMITS.chunks) {
    const length = view.getUint32(offset),
      type = String.fromCharCode(...data.subarray(offset + 4, offset + 8)),
      p = offset + 8;
    if (length > data.length - offset - 12) throw invalid();
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw invalid();
      width = view.getUint32(p);
      height = view.getUint32(p + 4);
    } else if (type === 'acTL') {
      if (declared || seenData || length !== 8) throw invalid();
      declared = view.getUint32(p);
      loopCount = view.getUint32(p + 4);
      if (!declared || declared > RASTER_LIMITS.frames) throw invalid();
    } else if (type === 'fcTL') {
      if (!declared || length !== 26 || view.getUint32(p) !== sequence++ || (durations.length && !frameData))
        throw invalid();
      const w = view.getUint32(p + 4),
        h = view.getUint32(p + 8),
        x = view.getUint32(p + 12),
        y = view.getUint32(p + 16);
      if (!w || !h || x + w > width || y + h > height || data[p + 24]! > 2 || data[p + 25]! > 1) throw invalid();
      durations.push(Math.max(1, (view.getUint16(p + 20) * 1000) / (view.getUint16(p + 22) || 100)));
      frameData = false;
    } else if (type === 'IDAT') {
      seenData = true;
      if (durations.length) frameData = true;
    } else if (type === 'fdAT') {
      if (!declared || !durations.length || length < 5 || view.getUint32(p) !== sequence++) throw invalid();
      frameData = true;
    }
    if (declared) {
      let crc = 0xffffffff;
      for (let i = offset + 4; i < p + length; i++) crc = table[(crc ^ data[i]!) & 255]! ^ (crc >>> 8);
      if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(p + length)) throw invalid();
    }
    offset += length + 12;
    if (type === 'IEND') {
      ended = length === 0 && offset === data.length;
      break;
    }
  }
  if (!declared) return;
  if (
    !ended ||
    !frameData ||
    !seenData ||
    durations.length !== declared ||
    width < 1 ||
    height < 1 ||
    width > RASTER_LIMITS.edge ||
    height > RASTER_LIMITS.edge ||
    width * height > RASTER_LIMITS.pixels
  )
    throw invalid();
  return {
    mime: 'image/png',
    width,
    height,
    animation: {
      format: 'apng',
      frameCount: durations.length,
      durationMs: durations.reduce((total, value) => total + value, 0),
      frameDurationsMs: durations,
      loopCount,
    },
  };
}
