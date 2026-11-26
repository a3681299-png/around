/**
 * Original VRM Animation (.vrma) for tests, authored here: a few humanoid nodes and one clip.
 * No Mixamo or other third-party motion data. `mutate` edits the glTF JSON before packing.
 */
export function vrmaFixture(
  options: { times?: number[]; hips?: number[][]; rotations?: number[][] } = {},
  mutate?: (json: Record<string, any>) => void,
): Buffer {
  const chunks: Buffer[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const floats = (values: number[], type: string, count: number, extra = {}) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((n, i) => bytes.writeFloatLE(n, i * 4));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type, ...extra });
    return accessors.length - 1;
  };
  // A sit-down: the hips drop 0.4 m and move 0.1 m forward, the spine leans a little.
  const times = options.times ?? [0, 0.5, 1];
  const hips = options.hips ?? [
    [0, 0.9, 0],
    [0, 0.7, 0.05],
    [0, 0.5, 0.1],
  ];
  const rotations = options.rotations ?? times.map((_, i) => [0.1 * i, 0, 0, Math.sqrt(1 - (0.1 * i) ** 2)]);
  const input = floats(times, 'SCALAR', times.length, { min: [times[0]], max: [times.at(-1)] });
  const hipsOut = floats(hips.flat(), 'VEC3', hips.length);
  const spineOut = floats(rotations.flat(), 'VEC4', rotations.length);
  const json: Record<string, any> = {
    asset: { version: '2.0', generator: 'Around original test motion' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Root', children: [1] },
      { name: 'Hips', translation: [0, 0.9, 0], children: [2, 4, 6] },
      { name: 'Spine', translation: [0, 0.1, 0], children: [3] },
      { name: 'Head', translation: [0, 0.5, 0] },
      { name: 'LeftUpperLeg', translation: [0.1, -0.05, 0], children: [5] },
      { name: 'LeftLowerLeg', translation: [0, -0.4, 0] },
      { name: 'RightUpperLeg', translation: [-0.1, -0.05, 0] },
    ],
    animations: [
      {
        name: 'sit',
        samplers: [
          { input, output: hipsOut, interpolation: 'LINEAR' },
          { input, output: spineOut, interpolation: 'LINEAR' },
        ],
        channels: [
          { sampler: 0, target: { node: 1, path: 'translation' } },
          { sampler: 1, target: { node: 2, path: 'rotation' } },
        ],
      },
    ],
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: {
          humanBones: {
            hips: { node: 1 },
            spine: { node: 2 },
            head: { node: 3 },
            leftUpperLeg: { node: 4 },
            leftLowerLeg: { node: 5 },
            rightUpperLeg: { node: 6 },
          },
        },
        expressions: { preset: {}, custom: {} },
      },
    },
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  mutate?.(json);
  let header = Buffer.from(JSON.stringify(json));
  header = Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks),
    result = Buffer.alloc(12 + 8 + header.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(header.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  header.copy(result, 20);
  const at = 20 + header.length;
  result.writeUInt32LE(bin.length, at);
  result.writeUInt32LE(0x004e4942, at + 4);
  bin.copy(result, at + 8);
  return result;
}

/** Finite local values whose ancestor product overflows the measured world-space hips height. */
export function overflowingHipsVrma(): Buffer {
  return vrmaFixture({}, (j) => {
    j.nodes[1].translation[1] = 1e6;
    j.nodes[0].children = [];
    let parent = 0;
    for (let i = 0; i < 51; i++) {
      const index = j.nodes.length;
      j.nodes.push({ scale: [1e6, 1e6, 1e6], children: [] });
      j.nodes[parent].children = [index];
      parent = index;
    }
    j.nodes[parent].children = [1];
  });
}
