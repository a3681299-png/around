export const ASSET_LIMITS = Object.freeze({ fileBytes: 4 * 1024 * 1024, batchBytes: 12 * 1024 * 1024, batchCount: 8, totalBytes: 48 * 1024 * 1024, count: 128, edge: 4096, pixels: 16 * 1024 * 1024 });
export interface ImageInfo { mime: 'image/png' | 'image/webp'; width: number; height: number }
export interface AssetMetadata extends ImageInfo { id: string; name: string; byteLength: number }

const text = (data: Uint8Array, start: number, length: number) => String.fromCharCode(...data.subarray(start, start + length));
const invalid = () => new Error('静止PNG・WebP画像を選択してください。');

/** Bound dimensions before decoding; never trust an extension or MIME label alone. */
export function inspectImage(data: Uint8Array, declaredMime = ''): ImageInfo {
  if (data.byteLength === 0 || data.byteLength > ASSET_LIMITS.fileBytes) throw new Error('画像は1枚4MBまでです。');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let info: ImageInfo | undefined;
  if (data.length >= 33 && text(data, 0, 8) === '\x89PNG\r\n\x1a\n' && text(data, 12, 4) === 'IHDR' && view.getUint32(8) === 13) {
    info = { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    let offset = 8, ended = false, chunks = 0;
    while (offset + 12 <= data.length && ++chunks <= 4096) {
      const length = view.getUint32(offset);
      const kind = text(data, offset + 4, 4);
      if (kind === 'acTL') throw invalid();
      if (length > data.length - offset - 12) throw invalid();
      offset += length + 12;
      if (kind === 'IEND') { ended = length === 0 && offset === data.length; break; }
    }
    if (!ended) throw invalid();
  } else if (data.length >= 20 && text(data, 0, 4) === 'RIFF' && text(data, 8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === data.length) {
    let offset = 12, chunks = 0;
    while (offset + 8 <= data.length && ++chunks <= 4096) {
      const kind = text(data, offset, 4), length = view.getUint32(offset + 4, true), p = offset + 8;
      if (length > data.length - p || kind === 'ANIM' || kind === 'ANMF') throw invalid();
      if (kind === 'VP8X' && length >= 10) {
        if (data[p]! & 2) throw invalid();
        info = { mime: 'image/webp', width: 1 + data[p + 4]! + (data[p + 5]! << 8) + (data[p + 6]! << 16), height: 1 + data[p + 7]! + (data[p + 8]! << 8) + (data[p + 9]! << 16) };
      } else if (!info && kind === 'VP8L' && length >= 5 && data[p] === 0x2f) {
        info = { mime: 'image/webp', width: 1 + data[p + 1]! + ((data[p + 2]! & 63) << 8), height: 1 + (data[p + 2]! >> 6) + (data[p + 3]! << 2) + ((data[p + 4]! & 15) << 10) };
      } else if (!info && kind === 'VP8 ' && length >= 10 && text(data, p + 3, 3) === '\x9d\x01\x2a') {
        info = { mime: 'image/webp', width: view.getUint16(p + 6, true) & 0x3fff, height: view.getUint16(p + 8, true) & 0x3fff };
      }
      offset = p + length + (length % 2);
    }
    if (offset !== data.length) throw invalid();
  }
  if (!info || (declaredMime !== '' && declaredMime !== info.mime)) throw invalid();
  if (info.width < 1 || info.height < 1 || info.width > ASSET_LIMITS.edge || info.height > ASSET_LIMITS.edge || info.width * info.height > ASSET_LIMITS.pixels) {
    throw new Error('画像の大きさは4096×4096px以内にしてください。');
  }
  return info;
}

export function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 16_384) binary += String.fromCharCode(...data.subarray(offset, offset + 16_384));
  return btoa(binary);
}

export function base64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(ASSET_LIMITS.fileBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw invalid();
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
