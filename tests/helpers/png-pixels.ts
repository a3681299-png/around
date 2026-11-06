import { inflateSync } from 'node:zlib';

/**
 * Decodes a screenshot PNG in the test process (no page, so nothing on the page under test changes
 * while we count). Enough for Chrome's screenshots: 8-bit RGB or RGBA, not interlaced.
 */
export function pngPixels(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG.');
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset),
      type = png.toString('latin1', offset + 4, offset + 8),
      body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8],
        color = body[9],
        interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6))
        throw new Error(`Unsupported PNG (depth ${depth}, color ${color}, interlace ${interlace}).`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)),
    stride = width * channels,
    rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!,
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels]! : 0,
        b = previous[i]!,
        c = i >= channels ? previous[i - channels]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : ((p) => {
                    const pa = Math.abs(p - a),
                      pb = Math.abs(p - b),
                      pc = Math.abs(p - c);
                    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                  })(a + b - c);
      out[i] = (line[i]! + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = out[x * channels]!;
      rgba[at + 1] = out[x * channels + 1]!;
      rgba[at + 2] = out[x * channels + 2]!;
      rgba[at + 3] = channels === 4 ? out[x * channels + 3]! : 255;
    }
    previous = out;
  }
  return { width, height, rgba };
}
