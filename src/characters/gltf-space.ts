import type { Vec3 } from './humanoid';

/** glTF node transforms without three.js, for import-time facts. Nodes must be validated first. */
type Obj = Record<string, any>;
export type Mat4 = Float64Array; // column-major, as glTF

export const identity = (): Mat4 => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  return out;
}
function local(node: Obj): Mat4 {
  if (Array.isArray(node['matrix'])) return new Float64Array(node['matrix'] as number[]);
  const [x, y, z, w] = (node['rotation'] as [number, number, number, number] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node['scale'] as Vec3 | undefined) ?? [1, 1, 1];
  const [tx, ty, tz] = (node['translation'] as Vec3 | undefined) ?? [0, 0, 0];
  return new Float64Array([
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}
export const transform = (m: Mat4, x: number, y: number, z: number): Vec3 => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
];
/** Memoized world matrices of an acyclic, validated node list. */
export function nodeWorlds(nodes: readonly Obj[]): (index: number) => Mat4 {
  const parent = new Map<number, number>();
  nodes.forEach((node, i) => ((node['children'] as number[] | undefined) ?? []).forEach((c) => parent.set(c, i)));
  const worlds = new Map<number, Mat4>();
  const world = (i: number): Mat4 => {
    let m = worlds.get(i);
    if (!m) {
      const p = parent.get(i);
      m = p === undefined ? local(nodes[i]!) : multiply(world(p), local(nodes[i]!));
      worlds.set(i, m);
    }
    return m;
  };
  return world;
}
