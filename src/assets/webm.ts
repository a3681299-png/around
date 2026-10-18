import { RASTER_LIMITS } from './motion-types';
import type { AssetInfo } from './validation';

const invalid = () => new Error('WebMの構造が不正です。長さが確定したVP8／VP9のWebMを書き出してください。');
interface Element { id: number; start: number; end: number }
/** Bounded metadata/container inspection, not a codec or a full-frame decode. */
export function inspectWebm(data: Uint8Array): AssetInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength); let count = 0;
  const vint = (p: number, id: boolean) => {
    if (p >= data.length || !data[p]) throw invalid();
    let length = 1, marker = 128; while (!(data[p]! & marker)) { marker >>= 1; length++; }
    if (length > (id ? 4 : 8) || p + length > data.length) throw invalid();
    let value = BigInt(id ? data[p]! : data[p]! & (marker - 1));
    for (let i = 1; i < length; i++) value = value * 256n + BigInt(data[p + i]!);
    const unknown = !id && value === (1n << BigInt(7 * length)) - 1n;
    if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
    return { length, value: Number(value), unknown };
  };
  function* elements(start: number, end: number): Generator<Element> {
    let p = start;
    while (p < end) {
      if (++count > RASTER_LIMITS.chunks) throw invalid();
      const id = vint(p, true), size = vint(p + id.length, false), payload = p + id.length + size.length;
      if (size.unknown && id.value !== 0x18538067) throw invalid();
      const next = size.unknown ? end : payload + size.value;
      if (payload > end || next > end || next < payload) throw invalid();
      yield { id: id.value, start: payload, end: next }; p = next;
    }
  }
  const uint = (e: Element) => {
    if (e.end - e.start < 1 || e.end - e.start > 6) throw invalid();
    let n = 0; for (let p = e.start; p < e.end; p++) n = n * 256 + data[p]!; return n;
  };
  const text = (e: Element) => { if (e.end - e.start > 128) throw invalid(); return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(e.start, e.end)); };
  let header = false, segment = false, docType = '', scale = 1_000_000, duration = 0, width = 0, height = 0, alpha = false, codec = '', videos = 0, clusters = 0;
  for (const top of elements(0, data.length)) {
    if (top.id === 0x1a45dfa3) {
      if (header || segment) throw invalid(); header = true;
      for (const e of elements(top.start, top.end)) if (e.id === 0x4282) docType = text(e);
    } else if (top.id === 0x18538067) {
      if (!header || segment || docType !== 'webm') throw invalid(); segment = true;
      for (const e of elements(top.start, top.end)) {
        if (e.id === 0x1549a966) for (const info of elements(e.start, e.end)) {
          if (info.id === 0x2ad7b1) scale = uint(info);
          if (info.id === 0x4489) { const length = info.end - info.start; if (length !== 4 && length !== 8) throw invalid(); duration = length === 4 ? view.getFloat32(info.start) : view.getFloat64(info.start); }
        }
        if (e.id === 0x1654ae6b) for (const track of elements(e.start, e.end)) {
          if (track.id !== 0xae) continue;
          let type = 0, trackCodec = '', w = 0, h = 0, a = false;
          for (const field of elements(track.start, track.end)) {
            if (field.id === 0x83) type = uint(field);
            if (field.id === 0x86) trackCodec = text(field);
            if (field.id === 0x6d80) throw new Error('暗号化・圧縮されたWebMトラックには対応していません。');
            if (field.id === 0xe0) for (const video of elements(field.start, field.end)) {
              if (video.id === 0xb0) w = uint(video);
              if (video.id === 0xba) h = uint(video);
              if (video.id === 0x53c0) a = uint(video) === 1;
            }
          }
          if (type === 1) { videos++; width = w; height = h; alpha = a; codec = trackCodec; }
          else if (type !== 2 || !['A_OPUS', 'A_VORBIS'].includes(trackCodec)) throw new Error('WebMには映像と対応する音声トラックだけを含めてください。音声は再生しません。');
        }
        if (e.id === 0x1f43b675) { clusters++; for (const block of elements(e.start, e.end)) if (block.id === 0xa0) for (const _field of elements(block.start, block.end)) { /* bounds only */ } }
      }
    } else if (top.id !== 0xec && top.id !== 0xbf) throw invalid();
  }
  const durationMs = duration * scale / 1_000_000;
  if (!segment || videos !== 1 || !clusters || !['V_VP8', 'V_VP9'].includes(codec) || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > Number.MAX_SAFE_INTEGER
    || !width || !height || width > RASTER_LIMITS.edge || height > RASTER_LIMITS.edge || width * height > RASTER_LIMITS.pixels) throw invalid();
  return { mime: 'video/webm', width, height, animation: { format: 'webm', durationMs, frameCount: 0, codec: codec === 'V_VP8' ? 'vp8' : 'vp9', alpha } };
}
