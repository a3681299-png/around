/**
 * An original humanoid mannequin VRM and one-frame .vrma poses, authored here in code. No
 * downloaded, generated or third-party character, texture or motion (no Mixamo). Every body part
 * is a box rigidly skinned to one humanoid bone, so computed motion on any bone is visible: the
 * Playground and the R3-2 tests use it until a redistributable VRM is chosen.
 */
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** VRM 1.0 bone, parent, local rest translation (metres; the model faces +Z, its left is +X). */
const BONES: readonly [string, string | null, Vec3][] = [
  ['hips', null, [0, 0.6, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.14, 0]],
  ['neck', 'chest', [0, 0.17, 0]],
  ['head', 'neck', [0, 0.06, 0]],
  ['leftEye', 'head', [0.05, 0.12, 0.1]],
  ['rightEye', 'head', [-0.05, 0.12, 0.1]],
  ['leftUpperArm', 'chest', [0.11, 0.13, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.19, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.17, 0, 0]],
  ['rightUpperArm', 'chest', [-0.11, 0.13, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.19, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.17, 0, 0]],
  ['leftUpperLeg', 'hips', [0.07, -0.05, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0, -0.25, 0]],
  ['leftFoot', 'leftLowerLeg', [0, -0.25, 0]],
  ['rightUpperLeg', 'hips', [-0.07, -0.05, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [0, -0.25, 0]],
  ['rightFoot', 'rightLowerLeg', [0, -0.25, 0]],
];
const SKIN: Vec3 = [0.98, 0.84, 0.72],
  SHIRT: Vec3 = [0.36, 0.62, 0.86],
  PANTS: Vec3 = [0.2, 0.3, 0.52],
  HAIR: Vec3 = [0.32, 0.22, 0.16],
  DARK: Vec3 = [0.12, 0.12, 0.16];
/** Box centre (world, rest pose), size, bone, colour; `blink` boxes collapse with the blink morph. */
const BOXES: readonly { at: Vec3; size: Vec3; bone: string; color: Vec3; blink?: true }[] = [
  { at: [0, 0.6, 0], size: [0.2, 0.12, 0.13], bone: 'hips', color: PANTS },
  { at: [0, 0.71, 0], size: [0.18, 0.12, 0.11], bone: 'spine', color: SHIRT },
  { at: [0, 0.88, 0], size: [0.24, 0.2, 0.13], bone: 'chest', color: SHIRT },
  { at: [0, 1.03, 0], size: [0.06, 0.06, 0.06], bone: 'neck', color: SKIN },
  { at: [0, 1.17, 0], size: [0.24, 0.26, 0.22], bone: 'head', color: SKIN },
  { at: [0, 1.29, -0.02], size: [0.26, 0.07, 0.25], bone: 'head', color: HAIR },
  { at: [0, 1.2, -0.12], size: [0.25, 0.2, 0.03], bone: 'head', color: HAIR },
  { at: [0, 1.14, 0.12], size: [0.035, 0.04, 0.03], bone: 'head', color: [0.92, 0.7, 0.6] },
  { at: [0.05, 1.19, 0.112], size: [0.04, 0.05, 0.01], bone: 'head', color: DARK, blink: true },
  { at: [-0.05, 1.19, 0.112], size: [0.04, 0.05, 0.01], bone: 'head', color: DARK, blink: true },
  ...([1, -1] as const).flatMap((s) => {
    const side = s > 0 ? 'left' : 'right';
    return [
      { at: [0.205 * s, 0.97, 0] as Vec3, size: [0.19, 0.065, 0.065] as Vec3, bone: `${side}UpperArm`, color: SHIRT },
      { at: [0.385 * s, 0.97, 0] as Vec3, size: [0.17, 0.055, 0.055] as Vec3, bone: `${side}LowerArm`, color: SKIN },
      { at: [0.5 * s, 0.97, 0] as Vec3, size: [0.06, 0.05, 0.04] as Vec3, bone: `${side}Hand`, color: SKIN },
      { at: [0.07 * s, 0.425, 0] as Vec3, size: [0.085, 0.25, 0.085] as Vec3, bone: `${side}UpperLeg`, color: PANTS },
      { at: [0.07 * s, 0.175, 0] as Vec3, size: [0.075, 0.25, 0.075] as Vec3, bone: `${side}LowerLeg`, color: PANTS },
      { at: [0.07 * s, 0.025, 0.03] as Vec3, size: [0.08, 0.05, 0.14] as Vec3, bone: `${side}Foot`, color: DARK },
    ];
  }),
];

function worldPositions(): Map<string, Vec3> {
  const world = new Map<string, Vec3>();
  for (const [name, parent, t] of BONES) {
    const p = parent ? world.get(parent)! : ([0, 0, 0] as Vec3);
    world.set(name, [p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
  }
  return world;
}

/** Packs a glTF JSON and its binary chunks as a GLB. */
function glb(json: Record<string, unknown>, chunks: Buffer[]): Buffer {
  let header = Buffer.from(JSON.stringify(json));
  header = Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks),
    out = Buffer.alloc(12 + 8 + header.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(header.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  header.copy(out, 20);
  const at = 20 + header.length;
  out.writeUInt32LE(bin.length, at);
  out.writeUInt32LE(0x004e4942, at + 4);
  bin.copy(out, at + 8);
  return out;
}

function writer() {
  const chunks: Buffer[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const view = (bytes: Buffer) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes);
    offset += bytes.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return views.length - 1;
  };
  const floats = (values: number[], type: string, count: number, extra: Record<string, unknown> = {}) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((n, i) => bytes.writeFloatLE(n, i * 4));
    accessors.push({ bufferView: view(bytes), componentType: 5126, count, type, ...extra });
    return accessors.length - 1;
  };
  const bounds = (values: number[]) => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < values.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, values[i]!);
      max[i % 3] = Math.max(max[i % 3]!, values[i]!);
    }
    return { min, max };
  };
  return { chunks, views, accessors, view, floats, bounds, size: () => offset };
}

/** The mannequin as a VRM 1.0 (about 1.3 m, 4.5 heads tall). */
export function mannequinVrm(): Buffer {
  const w = writer(),
    world = worldPositions(),
    joints = BONES.map(([name]) => name);
  const position: number[] = [],
    normal: number[] = [],
    color: number[] = [],
    joint: number[] = [],
    weight: number[] = [],
    blink: number[] = [],
    index: number[] = [];
  // Unlit faces: the top is lighter and the sides darker, so the boxes read as solids.
  const faces: { n: Vec3; shade: number; corners: Vec3[] }[] = [
    {
      n: [0, 0, 1],
      shade: 1,
      corners: [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    },
    {
      n: [0, 0, -1],
      shade: 0.7,
      corners: [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    },
    {
      n: [1, 0, 0],
      shade: 0.8,
      corners: [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
      ],
    },
    {
      n: [-1, 0, 0],
      shade: 0.8,
      corners: [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
      ],
    },
    {
      n: [0, 1, 0],
      shade: 1.08,
      corners: [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
      ],
    },
    {
      n: [0, -1, 0],
      shade: 0.6,
      corners: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ],
    },
  ];
  for (const box of BOXES) {
    const j = joints.indexOf(box.bone);
    for (const face of faces) {
      const base = position.length / 3;
      for (const c of face.corners) {
        const p = c.map((k, axis) => box.at[axis]! + (k * box.size[axis]!) / 2);
        position.push(...p);
        normal.push(...face.n);
        color.push(...box.color.map((v) => Math.min(1, v * face.shade)));
        joint.push(j, 0, 0, 0);
        weight.push(1, 0, 0, 0);
        // Blink: the eye closes onto its lower half.
        blink.push(0, box.blink ? box.at[1] - box.size[1] / 2 + 0.006 - p[1]! : 0, 0);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const count = position.length / 3;
  const positionAt = w.floats(position, 'VEC3', count, w.bounds(position));
  const normalAt = w.floats(normal, 'VEC3', count);
  const colorAt = w.floats(color, 'VEC3', count);
  const weightAt = w.floats(weight, 'VEC4', count);
  w.accessors.push({ bufferView: w.view(Buffer.from(joint)), componentType: 5121, count, type: 'VEC4' });
  const jointAt = w.accessors.length - 1;
  const blinkAt = w.floats(blink, 'VEC3', count, w.bounds(blink));
  const indexBytes = Buffer.alloc(index.length * 2);
  index.forEach((n, i) => indexBytes.writeUInt16LE(n, i * 2));
  w.accessors.push({ bufferView: w.view(indexBytes), componentType: 5123, count: index.length, type: 'SCALAR' });
  const indexAt = w.accessors.length - 1;
  const bind = joints.flatMap((name) => {
    const p = world.get(name)!;
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1];
  });
  const bindAt = w.floats(bind, 'MAT4', joints.length);
  // Node 0 the root, node 1 the skinned mesh, then one node per bone in BONES order.
  const nodes: Record<string, unknown>[] = [
    { name: 'Mannequin', children: [1, 2] },
    { name: 'Body', mesh: 0, skin: 0 },
  ];
  for (const [name, , translation] of BONES) nodes.push({ name, translation, children: [] as number[] });
  BONES.forEach(([, parent], i) => {
    if (parent) (nodes[2 + joints.indexOf(parent)]!['children'] as number[]).push(2 + i);
  });
  for (const node of nodes) if (Array.isArray(node['children']) && !node['children'].length) delete node['children'];
  const humanBones = Object.fromEntries(joints.map((name, i) => [name, { node: 2 + i }]));
  const range = { inputMaxValue: 90, outputScale: 10 };
  const json = {
    asset: { version: '2.0', generator: 'Web World Themes original mannequin' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    skins: [{ joints: joints.map((_, i) => 2 + i), skeleton: 2, inverseBindMatrices: bindAt }],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: positionAt,
              NORMAL: normalAt,
              COLOR_0: colorAt,
              JOINTS_0: jointAt,
              WEIGHTS_0: weightAt,
            },
            indices: indexAt,
            material: 0,
            targets: [{ POSITION: blinkAt }],
          },
        ],
        weights: [0],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    extensionsUsed: ['KHR_materials_unlit', 'VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'WW original mannequin',
          version: '1',
          authors: ['Web World Themes tests'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
        },
        humanoid: { humanBones },
        lookAt: {
          type: 'bone',
          rangeMapHorizontalInner: range,
          rangeMapHorizontalOuter: range,
          rangeMapVerticalUp: range,
          rangeMapVerticalDown: range,
        },
        expressions: { preset: { blink: { morphTargetBinds: [{ node: 1, index: 0, weight: 1 }] } } },
      },
    },
    buffers: [{ byteLength: w.size() }],
    bufferViews: w.views,
    accessors: w.accessors,
  };
  return glb(json, w.chunks);
}

const axis = (x: number, y: number, z: number, degrees: number): Quat => {
  const half = (degrees * Math.PI) / 360,
    s = Math.sin(half);
  return [x * s, y * s, z * s, Math.cos(half)];
};
/** Rotations of the normalized bones (from the T-pose) and the hips position of one pose. */
export interface MannequinPose {
  hips?: Vec3;
  rotations: Partial<Record<string, Quat>>;
}
const armsDown = { leftUpperArm: axis(0, 0, 1, -72), rightUpperArm: axis(0, 0, 1, 72) };
/** The one-frame poses the Playground ships until Shota's Blender poses arrive (same roles). */
export const MANNEQUIN_POSES: Readonly<Record<'stand' | 'sit', MannequinPose>> = {
  stand: { rotations: { ...armsDown } },
  // Sitting on an edge: thighs forward, shins hanging down, hands resting near the knees.
  sit: {
    hips: [0, 0.6, 0],
    rotations: {
      ...armsDown,
      leftUpperArm: axis(0.35, 0, 0.94, -70),
      rightUpperArm: axis(0.35, 0, -0.94, -70),
      leftUpperLeg: axis(1, 0, 0, -88),
      rightUpperLeg: axis(1, 0, 0, -88),
      leftLowerLeg: axis(1, 0, 0, 80),
      rightLowerLeg: axis(1, 0, 0, 80),
      spine: axis(1, 0, 0, 6),
    },
  },
};

/** A one-frame VRM Animation (.vrma) of a pose, on the mannequin's own skeleton. */
export function mannequinPoseVrma(name: string, pose: MannequinPose): Buffer {
  const w = writer(),
    joints = BONES.map(([bone]) => bone);
  const input = w.floats([0], 'SCALAR', 1, { min: [0], max: [0] });
  const samplers: Record<string, unknown>[] = [],
    channels: Record<string, unknown>[] = [];
  const hips = pose.hips ?? BONES[0]![2];
  samplers.push({ input, output: w.floats([...hips], 'VEC3', 1), interpolation: 'LINEAR' });
  channels.push({ sampler: 0, target: { node: 1, path: 'translation' } });
  for (const [bone, rotation] of Object.entries(pose.rotations)) {
    const i = joints.indexOf(bone);
    if (i < 0 || !rotation) continue;
    const length = Math.hypot(...rotation);
    samplers.push({
      input,
      output: w.floats(
        rotation.map((v) => v / length),
        'VEC4',
        1,
      ),
      interpolation: 'LINEAR',
    });
    channels.push({ sampler: samplers.length - 1, target: { node: 1 + i, path: 'rotation' } });
  }
  const nodes: Record<string, unknown>[] = [{ name: 'Root', children: [1] }];
  for (const [bone, , translation] of BONES) nodes.push({ name: bone, translation, children: [] as number[] });
  BONES.forEach(([, parent], i) => {
    if (parent) (nodes[1 + joints.indexOf(parent)]!['children'] as number[]).push(1 + i);
  });
  for (const node of nodes) if (Array.isArray(node['children']) && !node['children'].length) delete node['children'];
  const json = {
    asset: { version: '2.0', generator: 'Web World Themes original mannequin pose' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    animations: [{ name, samplers, channels }],
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones: Object.fromEntries(joints.map((bone, i) => [bone, { node: 1 + i }])) },
        expressions: { preset: {}, custom: {} },
      },
    },
    buffers: [{ byteLength: w.size() }],
    bufferViews: w.views,
    accessors: w.accessors,
  };
  return glb(json, w.chunks);
}
