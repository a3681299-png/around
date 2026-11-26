import { isHumanBone, type BodyInput, type HumanBone } from './humanoid';
import { identity, multiply, nodeWorlds, transform } from './gltf-space';

/**
 * VRM → engine body facts, read once from glTF JSON and BIN that `inspectGlb` already bounded
 * (index ranges, accessor sizes, finite floats). No three.js: the same numbers are produced in
 * any context and can be stored as import facts.
 */
type Obj = Record<string, any>; // validated glTF; every index used below was range-checked by inspectGlb

function reader(json: Obj, bin: Uint8Array, index: number) {
  const a = json.accessors[index],
    view = json.bufferViews[a.bufferView],
    size = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType]!,
    count = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]!,
    stride = view.byteStride ?? size * count,
    offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
    data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
    // Integer weights are normalized; joints are plain indices.
    scale = a.normalized
      ? ({ 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 } as Record<number, number>)[a.componentType]!
      : 1;
  return {
    count: a.count as number,
    get(item: number, component: number): number {
      const at = offset + item * stride + component * size;
      const n =
        a.componentType === 5126
          ? data.getFloat32(at, true)
          : a.componentType === 5125
            ? data.getUint32(at, true)
            : a.componentType === 5123
              ? data.getUint16(at, true)
              : a.componentType === 5122
                ? data.getInt16(at, true)
                : a.componentType === 5121
                  ? data.getUint8(at)
                  : data.getInt8(at);
      return n / scale;
    },
  };
}

function humanBones(json: Obj): Partial<Record<HumanBone, number>> | undefined {
  const map: Partial<Record<HumanBone, number>> = {};
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones;
  const vrm0 = json.extensions?.VRM?.humanoid?.humanBones;
  if (vrm1 && typeof vrm1 === 'object') {
    for (const [name, value] of Object.entries(vrm1))
      if (isHumanBone(name) && Number.isInteger((value as Obj)?.node)) map[name] = (value as Obj).node;
  } else if (Array.isArray(vrm0)) {
    for (const item of vrm0 as Obj[])
      if (isHumanBone(item?.bone) && Number.isInteger(item?.node)) map[item.bone] = item.node;
  } else return undefined;
  return map;
}

export function vrmBodyFacts(json: Obj, bin: Uint8Array): BodyInput | undefined {
  const mapping = humanBones(json);
  if (!mapping) return undefined;
  const nodes: Obj[] = json.nodes ?? [];
  const world = nodeWorlds(nodes);
  const bones: BodyInput['bones'] = {};
  for (const [name, node] of Object.entries(mapping) as [HumanBone, number][])
    if (node < nodes.length) bones[name] = transform(world(node), 0, 0, 0);
  const head = mapping.head;
  let crown = Number.NaN,
    floor = Number.NaN;
  nodes.forEach((node) => {
    if (node.mesh === undefined || node.skin === undefined) return;
    const skin: Obj = json.skins[node.skin],
      joints: number[] = skin.joints,
      ibm = skin.inverseBindMatrices === undefined ? undefined : reader(json, bin, skin.inverseBindMatrices);
    // Rest pose: a vertex bound to a joint lands at jointWorld · inverseBind · v.
    const bind = joints.map((joint, j) => {
      const inverse = identity();
      if (ibm) for (let k = 0; k < 16; k++) inverse[k] = ibm.get(j, k);
      return multiply(world(joint), inverse);
    });
    for (const primitive of json.meshes[node.mesh].primitives as Obj[]) {
      const a = primitive.attributes;
      if (a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) continue;
      const position = reader(json, bin, a.POSITION),
        jointIndex = reader(json, bin, a.JOINTS_0),
        weight = reader(json, bin, a.WEIGHTS_0);
      for (let n = 0; n < position.count; n++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (weight.get(n, k) > weight.get(n, best)) best = k;
        const j = jointIndex.get(n, best),
          matrix = bind[j];
        if (!matrix) continue;
        const y = transform(matrix, position.get(n, 0), position.get(n, 1), position.get(n, 2))[1];
        if (!(y >= floor)) floor = Math.min(Number.isNaN(floor) ? y : floor, y);
        // Mostly-head vertices only: hair and face count, ears or hats on their own bones do not.
        if (joints[j] === head && weight.get(n, best) >= 0.5 && !(y <= crown)) crown = y;
      }
    }
  });
  return { bones, crown, floor };
}
