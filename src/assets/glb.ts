import { MODEL_LIMITS, type ModelInfo } from '../models/types';
import { ASSET_MESSAGES, MODEL_RESOURCE_LIMITS } from './limits';
import type { AssetInfo } from './validation';
import { inspectVrm, VRM_EXTENSIONS } from './vrm';

type Obj = Record<string, any>; // glTF is untrusted; every used index/range is checked below.
const bad = (message = 'GLBが破損しているか、初版で未対応の構造です。') => new Error(message);
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
const name = (n: unknown, fallback: string) =>
  typeof n === 'string' ? n.replace(/[\u0000-\u001f]/g, '').slice(0, 120) : fallback;
const allowedExtensions = new Set([
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  ...VRM_EXTENSIONS,
]);

/** Bounded, self-contained GLB 2.0. The returned BIN is a read-only view of the input. */
export function inspectGlb(bytes: Uint8Array): { info: AssetInfo; json: Obj; bin: Uint8Array; gpuBytes: number } {
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
    if (type === 0x4e4f534a && chunks === 1 && size <= 2 * 1024 * 1024) {
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + size))) as Obj;
      } catch {
        throw bad();
      }
    } else if (type === 0x004e4942 && chunks === 2) bin = bytes.subarray(at, at + size);
    else throw bad();
    at += size;
  }
  if (
    at !== bytes.length ||
    !json ||
    json.asset?.version !== '2.0' ||
    (json.asset?.minVersion && json.asset.minVersion !== '2.0')
  )
    throw bad();
  const isVrm = Boolean(json.extensions?.VRMC_vrm || json.extensions?.VRM),
    morphLimit = isVrm ? 128 : 32;
  let entries = 0;
  function scan(value: unknown, depth = 0) {
    if (++entries > 200000 || depth > 40) throw bad('GLBの構造が複雑すぎます。');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e12)) throw bad();
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['uri', '__proto__', 'prototype', 'constructor'].includes(key))
        throw bad('外部URL・data URI・外部アセットを含むGLBは読み込めません。テクスチャを埋め込んでください。');
      if (
        key === 'extensions' &&
        child &&
        typeof child === 'object' &&
        Object.keys(child).some((e) => !allowedExtensions.has(e))
      )
        throw bad('未対応のGLB拡張です。圧縮なしのGLBで書き出してください。');
      scan(child, depth + 1);
    }
  }
  scan(json);
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    if (
      json[key] !== undefined &&
      (!Array.isArray(json[key]) || json[key].some((e: unknown) => typeof e !== 'string' || !allowedExtensions.has(e)))
    )
      throw bad('未対応のGLB拡張です。');
  const buffers = list(json.buffers, 1);
  if (buffers.length !== 1 || int(buffers[0]!.byteLength, bin.length) < bin.length - 3) throw bad();
  const views = list(json.bufferViews, 2048),
    accessors = list(json.accessors, 2048),
    nodes = list(json.nodes, MODEL_LIMITS.nodes),
    meshes = list(json.meshes, 256);
  const ref = (n: unknown, items: Obj[]) => items[int(n, items.length - 1)]!;
  for (const v of views) {
    if (v.buffer !== 0) throw bad();
    const start = int(v.byteOffset ?? 0, bin.length),
      length = int(v.byteLength, bin.length - start);
    if (!length) throw bad();
    if (v.byteStride !== undefined && (int(v.byteStride, 252) < 4 || v.byteStride % 4)) throw bad();
  }
  const component: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 },
    components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  let totalSamples = 0;
  const values = (a: Obj) => {
    const view = ref(a.bufferView, views),
      size = component[a.componentType]!,
      count = components[a.type]!,
      stride = view.byteStride ?? count * size;
    return { view, size, count, stride, offset: (view.byteOffset ?? 0) + (a.byteOffset ?? 0) };
  };
  for (const a of accessors) {
    if (a.sparse || !component[a.componentType] || !components[a.type])
      throw bad('スパースアクセサーは初版では未対応です。');
    const count = int(a.count, 2_000_000),
      v = values(a),
      start = int(a.byteOffset ?? 0, v.view.byteLength);
    if (
      !count ||
      v.stride < v.count * v.size ||
      start % v.size ||
      (count - 1) * v.stride + v.count * v.size > v.view.byteLength - start
    )
      throw bad();
    totalSamples += count * v.count;
    if (totalSamples > 16_000_000) throw bad('GLBの展開量が上限を超えています。');
    // Validate all floats before a geometry box or an animation can consume NaN/Infinity.
    if (a.componentType === 5126) {
      const data = new DataView(bin.buffer, bin.byteOffset);
      for (let i = 0; i < count; i++)
        for (let j = 0; j < v.count; j++) {
          const n = data.getFloat32(v.offset + i * v.stride + j * 4, true);
          if (!Number.isFinite(n) || Math.abs(n) > 1e8) throw bad();
        }
    }
    for (const key of ['min', 'max'])
      if (
        a[key] !== undefined &&
        (!Array.isArray(a[key]) ||
          a[key].length !== v.count ||
          a[key].some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e8))
      )
        throw bad();
  }
  let vertices = 0,
    triangles = 0,
    geometryBytes = 0,
    morphBytes = 0;
  const gpuAccessors = new Set<number>();
  for (const mesh of meshes)
    for (const p of list(mesh.primitives, 128)) {
      if ((p.mode ?? 4) !== 4 || !p.attributes || typeof p.attributes !== 'object')
        throw bad('三角形メッシュで書き出してください。');
      const position = ref(p.attributes.POSITION, accessors);
      if (position.type !== 'VEC3' || !position.min || !position.max) throw bad('位置の境界情報が必要です。');
      for (const index of Object.values(p.attributes)) if (ref(index, accessors).count !== position.count) throw bad();
      for (const index of [...Object.values(p.attributes), ...(p.indices === undefined ? [] : [p.indices])]) {
        const n = int(index, accessors.length - 1);
        if (gpuAccessors.has(n)) continue;
        gpuAccessors.add(n);
        const a = accessors[n]!;
        geometryBytes += a.count * components[a.type]! * component[a.componentType]!;
      }
      const targets = list(p.targets, morphLimit),
        slots = targets.some((t) => t.NORMAL !== undefined) ? 2 : 1;
      let morphVertices = position.count;
      if (isVrm && p.indices !== undefined) {
        const a = ref(p.indices, accessors),
          v = values(a),
          used = new Set<number>(),
          data = new DataView(bin.buffer, bin.byteOffset);
        if (a.type !== 'SCALAR' || ![5121, 5123, 5125].includes(a.componentType)) throw bad();
        for (let n = 0; n < a.count; n++) {
          const at = v.offset + n * v.stride;
          used.add(
            v.size === 1 ? data.getUint8(at) : v.size === 2 ? data.getUint16(at, true) : data.getUint32(at, true),
          );
        }
        // VRM Renderer must run removeUnnecessaryVertices before the first draw.
        morphVertices = used.size;
      }
      // Morph target texture layers can amplify shared binary accessors. Allow
      // row padding conservatively; do not rely on encoded file size alone.
      morphBytes += morphVertices * targets.length * slots * 16 * 2;
      if (morphBytes > (isVrm ? MODEL_RESOURCE_LIMITS.vrmMorphBytes : MODEL_RESOURCE_LIMITS.morphBytes))
        throw bad(ASSET_MESSAGES.morphSize(isVrm));
      const indices = p.indices === undefined ? position : ref(p.indices, accessors);
      vertices += position.count;
      triangles += indices.count / 3;
      if (
        vertices > MODEL_LIMITS.vertices ||
        triangles > MODEL_LIMITS.triangles ||
        !Number.isInteger(indices.count / 3)
      )
        throw bad('GLBの頂点・三角形数が上限を超えています。');
      if (p.indices !== undefined) {
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType)) throw bad();
        const v = values(indices),
          data = new DataView(bin.buffer, bin.byteOffset);
        for (let i = 0; i < indices.count; i++) {
          const offset = v.offset + i * v.stride,
            n =
              v.size === 1
                ? data.getUint8(offset)
                : v.size === 2
                  ? data.getUint16(offset, true)
                  : data.getUint32(offset, true);
          if (n >= position.count) throw bad();
        }
      }
      for (const target of list(p.targets, morphLimit))
        for (const index of Object.values(target)) if (ref(index, accessors).count !== position.count) throw bad();
    }
  const parents = new Set<number>();
  for (const node of nodes) {
    if (node.mesh !== undefined) ref(node.mesh, meshes);
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > nodes.length))
      throw bad();
    for (const n of node.children ?? []) {
      ref(n, nodes);
      if (parents.has(n)) throw bad();
      parents.add(n);
    }
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
  }
  const seen = new Set<number>(),
    visiting = new Set<number>();
  const visit = (n: number, depth: number) => {
    if (depth > 64 || visiting.has(n)) throw bad('ノード階層が不正です。');
    if (seen.has(n)) return;
    visiting.add(n);
    for (const c of nodes[n]!.children ?? []) visit(c, depth + 1);
    visiting.delete(n);
    seen.add(n);
  };
  nodes.forEach((_, i) => visit(i, 0));
  for (const s of list(json.scenes, 16)) {
    if (!Array.isArray(s.nodes)) throw bad();
    for (const n of s.nodes) {
      ref(n, nodes);
      if (parents.has(n)) throw bad();
    }
  }
  if (json.scene !== undefined) ref(json.scene, list(json.scenes, 16));
  let sceneVertices = 0,
    sceneTriangles = 0;
  for (const node of nodes)
    if (node.mesh !== undefined)
      for (const p of meshes[node.mesh]!.primitives) {
        const a = ref(p.attributes.POSITION, accessors);
        sceneVertices += a.count;
        sceneTriangles += p.indices === undefined ? a.count / 3 : ref(p.indices, accessors).count / 3;
      }
  if (!sceneTriangles || sceneVertices > MODEL_LIMITS.vertices || sceneTriangles > MODEL_LIMITS.triangles)
    throw bad('モデル内のインスタンスを含む描画量が上限を超えています。');
  const skins = list(json.skins, 64),
    boneIds = new Set<number>();
  for (const skin of skins) {
    if (!Array.isArray(skin.joints) || !skin.joints.length || skin.joints.length > (isVrm ? MODEL_LIMITS.bones : 256))
      throw bad();
    for (const n of skin.joints) {
      ref(n, nodes);
      boneIds.add(n);
    }
    if (skin.inverseBindMatrices !== undefined) {
      const a = ref(skin.inverseBindMatrices, accessors);
      if (a.type !== 'MAT4' || a.count !== skin.joints.length) throw bad();
    }
  }
  if (boneIds.size > MODEL_LIMITS.bones) throw bad();
  for (const node of nodes) if (node.skin !== undefined) ref(node.skin, skins);
  for (const node of nodes)
    if (node.skin !== undefined && node.mesh !== undefined) {
      const skin = skins[node.skin]!,
        mesh = meshes[node.mesh]!;
      for (const p of mesh.primitives) {
        const joints = ref(p.attributes.JOINTS_0, accessors),
          weights = ref(p.attributes.WEIGHTS_0, accessors);
        if (
          joints.type !== 'VEC4' ||
          ![5121, 5123].includes(joints.componentType) ||
          weights.type !== 'VEC4' ||
          ![5121, 5123, 5126].includes(weights.componentType)
        )
          throw bad('スキンのウェイト形式が不正です。');
        const v = values(joints),
          data = new DataView(bin.buffer, bin.byteOffset);
        for (let i = 0; i < joints.count; i++)
          for (let j = 0; j < 4; j++) {
            const at = v.offset + i * v.stride + j * v.size,
              index = v.size === 1 ? data.getUint8(at) : data.getUint16(at, true);
            if (index >= skin.joints.length) throw bad('スキンのボーン参照が範囲外です。');
          }
      }
    }
  const clips: ModelInfo['clips'] = [];
  let keys = 0,
    animationBytes = 0;
  for (const [i, animation] of list(json.animations, MODEL_LIMITS.clips).entries()) {
    const samplers = list(animation.samplers, 256);
    let duration = 0;
    for (const s of samplers) {
      const input = ref(s.input, accessors),
        output = ref(s.output, accessors);
      if (
        input.type !== 'SCALAR' ||
        input.componentType !== 5126 ||
        !['LINEAR', 'STEP', 'CUBICSPLINE'].includes(s.interpolation ?? 'LINEAR')
      )
        throw bad();
      if (output.count < input.count) throw bad();
      keys += input.count;
      if (keys > 500000) throw bad('キーフレームが多すぎます。');
      const v = values(input),
        data = new DataView(bin.buffer, bin.byteOffset);
      let last = -1;
      for (let n = 0; n < input.count; n++) {
        const t = data.getFloat32(v.offset + n * v.stride, true);
        if (t < 0 || t <= last || t > 86400) throw bad();
        last = t;
      }
      duration = Math.max(duration, last);
    }
    const targets = new Set<string>();
    for (const c of list(animation.channels, 256)) {
      const s = ref(c.sampler, samplers);
      if (!c.target || !['translation', 'rotation', 'scale', 'weights'].includes(c.target.path)) throw bad();
      const targetId = `${c.target.node}:${c.target.path}`;
      if (targets.has(targetId)) throw bad('同じ対象のアニメーションチャンネルが重複しています。');
      targets.add(targetId);
      const node = ref(c.target.node, nodes),
        a = ref(s.input, accessors),
        b = ref(s.output, accessors),
        factor = s.interpolation === 'CUBICSPLINE' ? 3 : 1;
      const morphs = c.target.path === 'weights' ? ref(node.mesh, meshes).primitives?.[0]?.targets?.length : 1;
      animationBytes += a.count * 4 + b.count * components[b.type]! * 4;
      if (animationBytes > MODEL_RESOURCE_LIMITS.animationBytes) throw bad(ASSET_MESSAGES.modelAnimationSize);
      if (
        !morphs ||
        b.componentType !== 5126 ||
        b.count !== a.count * factor * morphs ||
        b.type !== (c.target.path === 'weights' ? 'SCALAR' : c.target.path === 'rotation' ? 'VEC4' : 'VEC3')
      )
        throw bad('アニメーションのチャンネルとキー配列が一致しません。');
    }
    clips.push({ name: name(animation.name, `Clip ${i + 1}`), duration });
  }
  let textureBytes = 0;
  const images = list(json.images, 32);
  for (const image of images) {
    const v = ref(image.bufferView, views),
      data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    let width = 0,
      height = 0;
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (
      image.mimeType === 'image/png' &&
      data.length >= 33 &&
      d.getUint32(0) === 0x89504e47 &&
      d.getUint32(4) === 0x0d0a1a0a
    ) {
      width = d.getUint32(16);
      height = d.getUint32(20);
    } else if (image.mimeType === 'image/jpeg' && data[0] === 255 && data[1] === 216) {
      let p = 2;
      while (p + 4 < data.length) {
        if (data[p++] !== 255) throw bad();
        const marker = data[p++]!;
        if (marker === 0xda || marker === 0xd9) break;
        const len = d.getUint16(p);
        if (len < 2 || p + len > data.length) throw bad();
        if ([0xc0, 0xc1, 0xc2].includes(marker) && len >= 7) {
          height = d.getUint16(p + 3);
          width = d.getUint16(p + 5);
          break;
        }
        p += len;
      }
    } else throw bad('GLB内のテクスチャはPNGまたはJPEGで埋め込んでください。');
    if (!width || !height || width > 4096 || height > 4096) throw bad('テクスチャは4096px以下にしてください。');
    textureBytes += width * height * 4;
    if (textureBytes > MODEL_LIMITS.textureBytes) throw bad(ASSET_MESSAGES.textureSize);
  }
  for (const t of list(json.textures, 32)) ref(t.source, images);
  const textures = list(json.textures, 32),
    materials = list(json.materials, 128);
  const checkTextures = (item: Obj) => {
    for (const [key, value] of Object.entries(item))
      if (value && typeof value === 'object') {
        if (key.endsWith('Texture')) ref(value.index, textures);
        checkTextures(value);
      }
  };
  materials.forEach(checkTextures);
  for (const mesh of meshes) for (const p of mesh.primitives) if (p.material !== undefined) ref(p.material, materials);
  const vrm = inspectVrm(json);
  vrm?.humanoid.forEach((b) => boneIds.add(b.node));
  if (boneIds.size > MODEL_LIMITS.bones) throw bad();
  const info: AssetInfo = {
    mime: 'model/gltf-binary',
    width: 256,
    height: 256,
    model: {
      format: vrm ? 'vrm' : 'glb',
      ...(vrm ? { vrm } : {}),
      clips,
      bones: [...boneIds].map((node) => ({ node, name: name(nodes[node]!.name, `Bone ${node}`) })),
      vertices,
      triangles,
      textureBytes,
    },
  };
  const gpuBytes = geometryBytes + morphBytes + Math.ceil((textureBytes * 4) / 3) + boneIds.size * 64;
  if (gpuBytes > (vrm ? MODEL_RESOURCE_LIMITS.vrmGpuBytes : MODEL_RESOURCE_LIMITS.gpuBytes))
    throw bad(ASSET_MESSAGES.modelGpuSize(Boolean(vrm)));
  return { info, json, bin, gpuBytes };
}
