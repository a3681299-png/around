import { HUMAN_BONES, isHumanBone, type HumanBone, type Vec3 } from '../characters/humanoid';
import { nodeWorlds, transform } from '../characters/gltf-space';
import type { VrmAnimationInfo } from '../characters/motion-info';

/**
 * VRM Animation (.vrma) is untrusted input. It may only carry humanoid bone rotations and the
 * hips translation: no meshes, images, materials, skins, URIs, expressions or other extensions.
 * Every index, key time and float the renderer will read is checked here first.
 */
type Obj = Record<string, any>;
export const VRMA_LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  jsonBytes: 1024 * 1024,
  nodes: 256,
  accessors: 512,
  channels: 128,
  keys: 400_000,
  durationSeconds: 600,
});
export type { VrmAnimationInfo } from '../characters/motion-info';

const bad = (message = 'VRMアニメーション（.vrma）が破損しているか、未対応の構造です。') => new Error(message);
const TOP_LEVEL = new Set([
  'asset',
  'scene',
  'scenes',
  'nodes',
  'animations',
  'accessors',
  'bufferViews',
  'buffers',
  'extensionsUsed',
  'extensionsRequired',
  'extensions',
  'extras',
]);
const int = (n: unknown, max: number) => {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > max) throw bad();
  return n;
};
const list = (n: unknown, max: number): Obj[] => {
  if (n === undefined) return [];
  if (!Array.isArray(n) || n.length > max || n.some((v) => !v || typeof v !== 'object' || Array.isArray(v)))
    throw bad();
  return n;
};
const record = (n: unknown): Obj => {
  if (!n || typeof n !== 'object' || Array.isArray(n)) throw bad();
  return n as Obj;
};

function container(bytes: Uint8Array): { json: Obj; bin: Uint8Array } {
  if (bytes.length > VRMA_LIMITS.fileBytes) throw bad('VRMアニメーションのファイルが大きすぎます。');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 28 ||
    dv.getUint32(0, true) !== 0x46546c67 ||
    dv.getUint32(4, true) !== 2 ||
    dv.getUint32(8, true) !== bytes.length
  )
    throw bad();
  let at = 12,
    json: Obj | undefined,
    bin: Uint8Array = new Uint8Array(),
    chunks = 0;
  while (at + 8 <= bytes.length && ++chunks <= 2) {
    const size = dv.getUint32(at, true),
      type = dv.getUint32(at + 4, true);
    at += 8;
    if (size % 4 || size > bytes.length - at) throw bad();
    if (type === 0x4e4f534a && chunks === 1 && size <= VRMA_LIMITS.jsonBytes) {
      try {
        json = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + size))));
      } catch {
        throw bad();
      }
    } else if (type === 0x004e4942 && chunks === 2) bin = bytes.subarray(at, at + size);
    else throw bad();
    at += size;
  }
  if (at !== bytes.length || !json || json['asset']?.version !== '2.0') throw bad();
  return { json, bin };
}

/** Routing only (inspect.ts): a GLB whose JSON declares VRM Animation. Full checks follow. */
export function isVrmaContainer(bytes: Uint8Array): boolean {
  try {
    const { json } = container(bytes);
    return Boolean(json['extensions']?.VRMC_vrm_animation);
  } catch {
    return false;
  }
}

export function inspectVrma(bytes: Uint8Array): { info: VrmAnimationInfo; json: Obj; bin: Uint8Array } {
  const { json, bin } = container(bytes);
  // Shape before content: anything a motion file has no use for is refused outright.
  if (Object.keys(json).some((key) => !TOP_LEVEL.has(key)))
    throw bad('VRMアニメーションに不要なデータが含まれています。');
  let entries = 0;
  const scan = (value: unknown, depth: number, root: boolean) => {
    if (++entries > 100_000 || depth > 32) throw bad();
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e8)) throw bad();
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['uri', '__proto__', 'prototype', 'constructor'].includes(key))
        throw bad('外部URL・data URIを含むVRMアニメーションは読み込めません。');
      if (key === 'extensions' && !(root && depth === 0)) throw bad('未対応のglTF拡張です。');
      scan(child, depth + 1, false);
    }
  };
  scan(json, 0, true);
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    if (
      json[key] !== undefined &&
      (!Array.isArray(json[key]) || json[key].some((e: unknown) => e !== 'VRMC_vrm_animation'))
    )
      throw bad('未対応のglTF拡張です。');
  const extensions = record(json['extensions'] ?? {});
  if (Object.keys(extensions).some((k) => k !== 'VRMC_vrm_animation')) throw bad('未対応のglTF拡張です。');
  const ext = record(extensions['VRMC_vrm_animation']);
  if (
    Object.keys(ext).some((k) => !['specVersion', 'humanoid', 'expressions'].includes(k)) ||
    ext['specVersion'] !== '1.0'
  )
    throw bad('VRMアニメーション 1.0 の形式ではありません。');
  // Expressions animate through extra nodes; R3 plays skeletons only, so any entry is refused.
  if (ext['expressions'] !== undefined) {
    const expressions = record(ext['expressions']);
    for (const [key, value] of Object.entries(expressions))
      if (!['preset', 'custom'].includes(key) || Object.keys(record(value)).length)
        throw bad('表情を含むVRMアニメーションは未対応です。');
  }

  const buffers = list(json['buffers'], 1),
    views = list(json['bufferViews'], VRMA_LIMITS.accessors),
    accessors = list(json['accessors'], VRMA_LIMITS.accessors),
    nodes = list(json['nodes'], VRMA_LIMITS.nodes),
    scenes = list(json['scenes'], VRMA_LIMITS.nodes);
  if (buffers.length !== 1 || int(buffers[0]!['byteLength'], bin.length) < bin.length - 3) throw bad();
  const ref = (n: unknown, items: Obj[]) => items[int(n, items.length - 1)]!;
  // The animation loader reads a scene before bones. Check every scene, including unused ones,
  // so no out-of-range root or default scene can reach GLTFLoader.
  ref(json['scene'] === undefined ? 0 : json['scene'], scenes);
  for (const scene of scenes) {
    if (scene['nodes'] !== undefined && (!Array.isArray(scene['nodes']) || scene['nodes'].length > nodes.length))
      throw bad();
    for (const node of (scene['nodes'] as unknown[] | undefined) ?? []) ref(node, nodes);
  }
  const bufferLength = buffers[0]!['byteLength'] as number;
  for (const v of views) {
    if (v['buffer'] !== 0 || v['byteStride'] !== undefined) throw bad();
    const start = int(v['byteOffset'] ?? 0, bufferLength);
    if (start % 4 || !int(v['byteLength'], bufferLength - start)) throw bad();
  }
  // Animation data is float only: SCALAR times, VEC3 translations, VEC4 rotations.
  const width: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const checked = new Map<number, { type: string; count: number; at: (i: number, c: number) => number }>();
  let floatValues = 0;
  const floats = (index: unknown): { type: string; count: number; at: (i: number, c: number) => number } => {
    const id = int(index, accessors.length - 1),
      cached = checked.get(id);
    if (cached) return cached;
    const a = accessors[id]!;
    if (
      a['sparse'] !== undefined ||
      a['componentType'] !== 5126 ||
      typeof a['type'] !== 'string' ||
      !Object.hasOwn(width, a['type']) ||
      a['normalized']
    )
      throw bad();
    const view = ref(a['bufferView'], views),
      count = int(a['count'], VRMA_LIMITS.keys),
      n = width[a['type']]!,
      start = int(a['byteOffset'] ?? 0, view['byteLength']);
    if (!count || start % 4 || start + count * n * 4 > view['byteLength']) throw bad();
    // One time plus three VEC4s per CUBICSPLINE key is the largest supported motion.
    // Shared/unused accessors cannot multiply the inspection work beyond that budget.
    floatValues += count * n;
    if (floatValues > VRMA_LIMITS.keys * 13) throw bad('キーフレームが多すぎます。');
    const base = (view['byteOffset'] ?? 0) + start;
    const at = (i: number, c: number) => data.getFloat32(base + (i * n + c) * 4, true);
    for (let i = 0; i < count; i++)
      for (let c = 0; c < n; c++) if (!Number.isFinite(at(i, c)) || Math.abs(at(i, c)) > 1e6) throw bad();
    const result = { type: a['type'] as string, count, at };
    checked.set(id, result);
    return result;
  };
  accessors.forEach((_, index) => floats(index));

  const parent = new Map<number, number>();
  for (const [i, node] of nodes.entries()) {
    for (const key of Object.keys(node))
      if (!['name', 'children', 'translation', 'rotation', 'scale', 'matrix', 'extras'].includes(key)) throw bad();
    for (const [key, length] of [
      ['translation', 3],
      ['rotation', 4],
      ['scale', 3],
      ['matrix', 16],
    ] as const)
      if (
        node[key] !== undefined &&
        (!Array.isArray(node[key]) ||
          node[key].length !== length ||
          node[key].some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e6))
      )
        throw bad();
    if (node['children'] !== undefined && (!Array.isArray(node['children']) || node['children'].length > nodes.length))
      throw bad();
    for (const c of (node['children'] as unknown[] | undefined) ?? []) {
      const child = int(c, nodes.length - 1);
      if (parent.has(child) || child === i) throw bad();
      parent.set(child, i);
    }
  }
  // Acyclic and bounded depth: walk each node's ancestors.
  for (let i = 0; i < nodes.length; i++) {
    let n: number | undefined = i,
      depth = 0;
    while ((n = parent.get(n)) !== undefined) if (++depth > 64 || n === i) throw bad('ノード階層が不正です。');
  }

  const humanoid = record(record(ext['humanoid'])['humanBones']);
  const boneOf = new Map<number, HumanBone>();
  for (const [name, value] of Object.entries(humanoid)) {
    if (!isHumanBone(name)) throw bad('未知の人型の骨の名前です。');
    const v = record(value);
    if (Object.keys(v).some((k) => k !== 'node')) throw bad();
    const node = int(v['node'], nodes.length - 1);
    if (boneOf.has(node)) throw bad('人型の骨が同じノードを指しています。');
    boneOf.set(node, name);
  }
  const hipsNode = [...boneOf].find(([, b]) => b === 'hips')?.[0];
  if (hipsNode === undefined) throw bad('腰（hips）がありません。');

  const animations = list(json['animations'], 1);
  if (animations.length !== 1) throw bad('VRMアニメーションには動作を1つだけ入れてください。');
  const animation = animations[0]!;
  const samplers = list(animation['samplers'], VRMA_LIMITS.channels),
    channels = list(animation['channels'], VRMA_LIMITS.channels);
  if (!channels.length) throw bad();
  for (const sampler of samplers) {
    ref(sampler['input'], accessors);
    ref(sampler['output'], accessors);
  }
  let duration = 0,
    keys = 0,
    hipsTranslation = false,
    hipsTravel: Vec3 = [0, 0, 0];
  const targets = new Set<string>();
  for (const channel of channels) {
    const target = record(channel['target']),
      node = int(target['node'], nodes.length - 1),
      bone = boneOf.get(node),
      path = target['path'];
    if (!bone) throw bad('人型の骨でないノードを動かしています。');
    if (!(path === 'rotation' || (path === 'translation' && bone === 'hips')))
      throw bad('腰の移動と骨の回転だけを使えます。');
    const id = `${node}:${path}`;
    if (targets.has(id)) throw bad('同じ対象のチャンネルが重複しています。');
    targets.add(id);
    const sampler = ref(channel['sampler'], samplers),
      interpolation = sampler['interpolation'] ?? 'LINEAR';
    if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) throw bad();
    const input = floats(sampler['input']),
      output = floats(sampler['output']);
    if (input.type !== 'SCALAR' || output.type !== (path === 'rotation' ? 'VEC4' : 'VEC3')) throw bad();
    const factor = interpolation === 'CUBICSPLINE' ? 3 : 1;
    if (output.count !== input.count * factor) throw bad('キーと値の数が一致しません。');
    keys += input.count;
    if (keys > VRMA_LIMITS.keys) throw bad('キーフレームが多すぎます。');
    let last = -1;
    for (let i = 0; i < input.count; i++) {
      const t = input.at(i, 0);
      if (t < 0 || t <= last) throw bad();
      last = t;
    }
    if (last > VRMA_LIMITS.durationSeconds) throw bad('VRMアニメーションが長すぎます。');
    duration = Math.max(duration, last);
    if (path === 'translation') {
      hipsTranslation = true;
      // CUBICSPLINE stores (in-tangent, value, out-tangent) per key.
      const value = (i: number, c: number) => output.at(i * factor + (factor === 3 ? 1 : 0), c);
      const end = input.count - 1;
      hipsTravel = [0, 1, 2].map((c) => value(end, c) - value(0, c)) as unknown as Vec3;
    }
  }

  // Rest hips height in world space, as @pixiv/three-vrm-animation reads it (hips.getWorldPosition).
  const restHipsPosition = transform(nodeWorlds(nodes)(hipsNode), 0, 0, 0),
    restHipsHeight = restHipsPosition[1];
  // Finite local transforms can overflow when multiplied along the parent chain.
  if (!restHipsPosition.every(Number.isFinite)) throw bad('腰の位置が有限の数値ではありません。');
  if (!(restHipsHeight > 1e-3)) throw bad('腰の高さが0です。');
  const name =
    typeof animation['name'] === 'string' ? animation['name'].replace(/[\u0000-\u001f]/g, '').slice(0, 120) : '';
  return {
    info: {
      format: 'vrma',
      name,
      duration,
      bones: HUMAN_BONES.filter((b) => [...boneOf.values()].includes(b)),
      hipsTranslation,
      restHipsHeight,
      hipsTravel,
    },
    json,
    bin,
  };
}
