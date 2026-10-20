import { deflateSync } from 'node:zlib';
/** Original test rig, authored here; no downloaded or generated character assets. */
export function modelFixture(mutate?: (json: Record<string, any>) => void): Buffer {
  const chunks: Buffer[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const data = (bytes: Buffer) => {
    const index = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return index;
  };
  const floats = (v: number[], type: string, count: number, extra = {}) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((n, i) => b.writeFloatLE(n, i * 4));
    const index = accessors.length;
    accessors.push({ bufferView: data(b), componentType: 5126, count, type, ...extra });
    return index;
  };
  const position = floats(
    [
      -0.35, -0.5, -0.2, 0.35, -0.5, -0.2, 0.35, 0.5, -0.2, -0.35, 0.5, -0.2, -0.35, -0.5, 0.2, 0.35, -0.5, 0.2, 0.35,
      0.5, 0.2, -0.35, 0.5, 0.2,
    ],
    'VEC3',
    8,
    { min: [-0.35, -0.5, -0.2], max: [0.35, 0.5, 0.2] },
  );
  const indices = accessors.length;
  accessors.push({
    bufferView: data(
      Buffer.from([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7,
      ]),
    ),
    componentType: 5121,
    count: 36,
    type: 'SCALAR',
  });
  const joints = accessors.length;
  accessors.push({
    bufferView: data(
      Buffer.from(Array.from({ length: 32 }, (_, i) => (i % 4 ? 0 : [2, 3, 6, 7].includes(Math.floor(i / 4)) ? 1 : 0))),
    ),
    componentType: 5121,
    count: 8,
    type: 'VEC4',
  });
  const weights = floats(
    Array.from({ length: 32 }, (_, i) => (i % 4 ? 0 : 1)),
    'VEC4',
    8,
  );
  const uv = floats([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 'VEC2', 8);
  const bind = floats(
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.25, 0, 1],
    'MAT4',
    2,
  );
  const times = floats([0, 1, 2], 'SCALAR', 3, { min: [0], max: [2] });
  const idle = floats([0, 0, 0, 1, 0, 0, 0.08, 0.996795, 0, 0, 0, 1], 'VEC4', 3);
  const walk = floats([0, 0, 0, 1, 0, 0, 2, 0, 0], 'VEC3', 3);
  const run = floats([0, 0, 0, 1, 0, 0, -0.25, 0.968246, 0, 0, 0, 1], 'VEC4', 3);
  const pngChunk = (kind: string, bytes: Buffer) => {
    const input = Buffer.concat([Buffer.from(kind), bytes]);
    let crc = 0xffffffff;
    for (const b of input) {
      crc ^= b;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, input, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 255, 0, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const imageView = data(png);
  const json: Record<string, any> = {
    asset: { version: '2.0', generator: 'Web World Themes original test rig' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Character', children: [1, 2] },
      { name: 'Body', mesh: 0, skin: 0 },
      { name: 'Hips', children: [3] },
      { name: 'Head', translation: [0, 0.25, 0] },
    ],
    skins: [{ joints: [2, 3], skeleton: 2, inverseBindMatrices: bind }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights, TEXCOORD_0: uv },
            indices,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        doubleSided: true,
        alphaMode: 'BLEND',
        pbrMetallicRoughness: {
          baseColorFactor: [0.65, 0.4, 1, 0.9],
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: imageView, mimeType: 'image/png' }],
    extensionsUsed: ['KHR_materials_unlit'],
    animations: [
      {
        name: 'Rest / 待機',
        samplers: [{ input: times, output: idle }],
        channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
      },
      {
        name: 'Stride',
        samplers: [{ input: times, output: walk }],
        channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }],
      },
      {
        name: 'Sprint',
        samplers: [{ input: times, output: run }],
        channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
      },
    ],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  mutate?.(json);
  let headerJson = Buffer.from(JSON.stringify(json));
  headerJson = Buffer.concat([headerJson, Buffer.alloc((4 - (headerJson.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks),
    result = Buffer.alloc(12 + 8 + headerJson.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(headerJson.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  headerJson.copy(result, 20);
  const at = 20 + headerJson.length;
  result.writeUInt32LE(bin.length, at);
  result.writeUInt32LE(0x004e4942, at + 4);
  bin.copy(result, at + 8);
  return result;
}
