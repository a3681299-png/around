import { encodePng, packRoom } from '../../scripts/room/pack-room.mjs';

/**
 * A tiny test room, authored here (no private room assets): the inside of a 4 × 2.6 × 4 m box,
 * camera_main at its front looking in, and the asset contract's light layers baked as simple
 * gradients, packed the way scripts/room/pack-room.mjs packs a real one. `bright` makes every
 * layer white (the readability worst case).
 */
export function roomFixture(options: { bright?: boolean } = {}): Buffer {
  const chunks: Buffer[] = [];
  const views: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const data = (bytes: Buffer) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) (chunks.push(Buffer.alloc(pad)), (offset += pad));
    return views.length - 1;
  };
  const floats = (v: number[], type: string, count: number, extra = {}) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((n, i) => b.writeFloatLE(n, i * 4));
    accessors.push({ bufferView: data(b), componentType: 5126, count, type, ...extra });
    return accessors.length - 1;
  };
  // Six inward faces: floor, ceiling, back, left, right, front (behind the camera).
  const [w, h, d] = [2, 2.6, 2];
  const faces = [
    [
      [-w, 0, d],
      [w, 0, d],
      [w, 0, -d],
      [-w, 0, -d],
    ],
    [
      [-w, h, -d],
      [w, h, -d],
      [w, h, d],
      [-w, h, d],
    ],
    [
      [-w, 0, -d],
      [w, 0, -d],
      [w, h, -d],
      [-w, h, -d],
    ],
    [
      [-w, 0, d],
      [-w, 0, -d],
      [-w, h, -d],
      [-w, h, d],
    ],
    [
      [w, 0, -d],
      [w, 0, d],
      [w, h, d],
      [w, h, -d],
    ],
    [
      [w, 0, d],
      [-w, 0, d],
      [-w, h, d],
      [w, h, d],
    ],
  ];
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  faces.forEach((quad, f) => {
    const base = f * 4;
    quad.forEach((p, i) => {
      positions.push(...p);
      // Each face takes its own strip of the light map (the second UV).
      const u = (i === 1 || i === 2 ? 1 : 0) * 0.9 + 0.05,
        v = (i >= 2 ? 1 : 0) * 0.12 + f / 6 + 0.02;
      uv.push(u, v);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const position = floats(positions, 'VEC3', 24, { min: [-w, 0, -d], max: [w, h, d] });
  const texcoord = floats(uv, 'VEC2', 24);
  const index = Buffer.alloc(indices.length * 2);
  indices.forEach((n, i) => index.writeUInt16LE(n, i * 2));
  accessors.push({ bufferView: data(index), componentType: 5123, count: indices.length, type: 'SCALAR' });
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'static_room', mesh: 0 },
      { name: 'camera_main', camera: 0, translation: [0, 1.3, 1.9] },
    ],
    cameras: [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, zfar: 100, aspectRatio: 16 / 9 } }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: position, TEXCOORD_0: texcoord, TEXCOORD_1: texcoord }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.75, 0.7, 1] } }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonPadded.length + bin.length, 8);
  header.writeUInt32LE(jsonPadded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header.subarray(0, 20), jsonPadded, binHead, bin]);
  glb.writeUInt32LE(glb.length, 8);
  // Light layers: a warm gradient for the lamp, a cool one for the window, a flat one for the screen.
  const layer = (name: string, color: [number, number, number], scale: number) => {
    const size = 32,
      rgb = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        for (let c = 0; c < 3; c++)
          rgb[(y * size + x) * 3 + c] = options.bright ? 255 : Math.round(255 * color[c]! * (0.4 + (0.6 * x) / size));
    return { name, png: encodePng(size, size, rgb), scale };
  };
  return packRoom(glb, [
    layer('room_desk', [0.9, 0.6, 0.3], 1),
    layer('sun_night', [0.3, 0.4, 0.8], 1),
    layer('screen', [1, 1, 1], 1),
  ]);
}
