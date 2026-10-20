import type { VrmInfo } from '../models/types';

type Obj = Record<string, any>; // All consumed references and allocation counts are bounded here.
const fail = () => new Error('VRMの形式・参照・予算が不正です。VRM 1.0または0.xの自己完結したモデルを選んでください。');
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail();
  return v;
};
const array = (v: unknown, max: number): Obj[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw fail();
  return v.map(obj);
};
const index = (v: unknown, length: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= length) throw fail();
  return v;
};
const text = (v: unknown) => {
  if (
    typeof v !== 'string' ||
    !v.length ||
    v.length > 120 ||
    /[\u0000-\u001f]/.test(v) ||
    ['__proto__', 'prototype', 'constructor'].includes(v)
  )
    throw fail();
  return v;
};
const finite = (v: unknown, lo: number, hi: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw fail();
};
const vector = (v: unknown, length: number, lo = -1000, hi = 1000) => {
  if (!Array.isArray(v) || v.length !== length) throw fail();
  v.forEach((x) => finite(x, lo, hi));
};
const required = [
  'hips',
  'spine',
  'head',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
];
const legacyPresets: Record<string, string> = {
  a: 'aa',
  e: 'ee',
  i: 'ih',
  o: 'oh',
  u: 'ou',
  joy: 'happy',
  sorrow: 'sad',
  fun: 'relaxed',
  lookup: 'lookUp',
  lookdown: 'lookDown',
  lookleft: 'lookLeft',
  lookright: 'lookRight',
  blink_l: 'blinkLeft',
  blink_r: 'blinkRight',
};
export const VRM_EXTENSIONS = [
  'VRMC_vrm',
  'VRMC_springBone',
  'VRMC_materials_mtoon',
  'VRMC_materials_hdr_emissiveMultiplier',
  'VRMC_node_constraint',
  'VRM',
];

/** License URLs are metadata only. They are never passed to a fetch/loader. */
export function inspectVrm(json: Obj): VrmInfo | undefined {
  const modern = json.extensions?.VRMC_vrm,
    legacy = json.extensions?.VRM;
  if (!modern && !legacy) {
    if ((json.extensionsUsed ?? []).some((e: string) => VRM_EXTENSIONS.includes(e))) throw fail();
    return undefined;
  }
  if (modern && legacy) throw fail();
  const vrm = obj(modern ?? legacy),
    nodes = json.nodes ?? [],
    materials = json.materials ?? [],
    meshes = json.meshes ?? [],
    textures = json.textures ?? [];
  const v1 = Boolean(modern);
  if (v1 ? vrm.specVersion !== '1.0' : vrm.specVersion !== '0.0') throw fail();
  const humanoid: VrmInfo['humanoid'] = [];
  if (v1)
    for (const [bone, value] of Object.entries(obj(vrm.humanoid?.humanBones)))
      humanoid.push({ bone: text(bone), node: index(obj(value).node, nodes.length) });
  else
    for (const bone of array(vrm.humanoid?.humanBones, 64))
      humanoid.push({ bone: text(bone.bone), node: index(bone.node, nodes.length) });
  if (
    humanoid.length > 64 ||
    required.some((name) => !humanoid.some((b) => b.bone === name)) ||
    new Set(humanoid.map((b) => b.node)).size !== humanoid.length ||
    new Set(humanoid.map((b) => b.bone)).size !== humanoid.length
  )
    throw fail();
  // Humanoid references must be one hierarchy, never a self-referential or unrelated graph.
  const parent = new Map<number, number>();
  nodes.forEach((n: Obj, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  for (const b of humanoid) {
    let n: number | undefined = b.node,
      depth = 0;
    while (n !== undefined && ++depth <= 65) n = parent.get(n);
    if (depth > 64) throw fail();
  }
  const expressions: string[] = [];
  if (v1)
    for (const section of ['preset', 'custom']) {
      const groups = vrm.expressions?.[section] ?? {};
      if (Object.keys(obj(groups)).length > 128) throw fail();
      for (const [key, value] of Object.entries(groups)) {
        expressions.push(text(key));
        const expression = obj(value);
        for (const bind of array(expression.morphTargetBinds, 512)) {
          const node = nodes[index(bind.node, nodes.length)];
          const mesh = meshes[index(node.mesh, meshes.length)];
          for (const p of mesh.primitives) index(bind.index, p.targets?.length ?? 0);
          finite(bind.weight, 0, 1);
        }
        for (const bind of array(expression.materialColorBinds, 128)) {
          index(bind.material, materials.length);
          if (!['color', 'emissionColor', 'shadeColor', 'matcapColor', 'rimColor', 'outlineColor'].includes(bind.type))
            throw fail();
          vector(bind.targetValue, 4, 0, 100);
        }
        for (const bind of array(expression.textureTransformBinds, 128)) {
          index(bind.material, materials.length);
          vector(bind.scale, 2);
          vector(bind.offset, 2);
        }
        for (const key of ['overrideBlink', 'overrideLookAt', 'overrideMouth'])
          if (expression[key] !== undefined && !['none', 'block', 'blend'].includes(expression[key])) throw fail();
      }
    }
  else
    for (const expression of array(vrm.blendShapeMaster?.blendShapeGroups, 128)) {
      const key =
        expression.presetName && expression.presetName !== 'unknown'
          ? (legacyPresets[expression.presetName] ?? expression.presetName)
          : expression.name;
      expressions.push(text(key));
      for (const bind of array(expression.binds, 512)) {
        const mesh = meshes[index(bind.mesh, meshes.length)];
        for (const p of mesh.primitives) index(bind.index, p.targets?.length ?? 0);
        finite(bind.weight, 0, 100);
      }
      for (const bind of array(expression.materialValues, 128)) {
        text(bind.materialName);
        text(bind.propertyName);
        if (!Array.isArray(bind.targetValue) || bind.targetValue.length > 4) throw fail();
        bind.targetValue.forEach((n: number) => finite(n, -100, 100));
      }
    }
  if (expressions.length > 128 || new Set(expressions).size !== expressions.length) throw fail();
  const look = v1 ? vrm.lookAt : vrm.firstPerson;
  if (look) {
    const type = v1 ? look.type : look.lookAtTypeName;
    if (!['bone', 'expression', 'Bone', 'BlendShape'].includes(type)) throw fail();
    if (v1 && look.offsetFromHeadBone) vector(look.offsetFromHeadBone, 3);
    for (const key of v1
      ? ['rangeMapHorizontalInner', 'rangeMapHorizontalOuter', 'rangeMapVerticalDown', 'rangeMapVerticalUp']
      : ['lookAtHorizontalInner', 'lookAtHorizontalOuter', 'lookAtVerticalDown', 'lookAtVerticalUp']) {
      const map = look[key];
      if (map) {
        finite(v1 ? map.inputMaxValue : map.xRange, 0.0001, 180);
        finite(v1 ? map.outputScale : map.yRange, 0, 180);
      }
    }
  }
  const spring = json.extensions?.VRMC_springBone;
  if (spring) {
    if (spring.specVersion !== '1.0') throw fail();
    const colliders = array(spring.colliders, 256),
      groups = array(spring.colliderGroups, 128);
    for (const c of colliders) {
      index(c.node, nodes.length);
      const shape = obj(c.shape);
      const s = shape.sphere ?? shape.capsule;
      if (!s || Object.keys(shape).length !== 1) throw fail();
      vector(s.offset, 3);
      finite(s.radius, 0, 100);
      if (shape.capsule) vector(s.tail, 3);
    }
    for (const g of groups) {
      if (!Array.isArray(g.colliders) || g.colliders.length > 256) throw fail();
      g.colliders.forEach((n: number) => index(n, colliders.length));
    }
    let joints = 0,
      pairs = 0;
    for (const s of array(spring.springs, 128)) {
      if (s.center !== undefined) index(s.center, nodes.length);
      const js = array(s.joints, 256);
      joints += js.length;
      let colliderCount = 0;
      if (s.colliderGroups !== undefined) {
        if (!Array.isArray(s.colliderGroups) || s.colliderGroups.length > 128) throw fail();
        s.colliderGroups.forEach((n: number) => {
          colliderCount += groups[index(n, groups.length)]!.colliders.length;
        });
      }
      pairs += colliderCount * js.length;
      for (const j of js) {
        index(j.node, nodes.length);
        for (const key of ['hitRadius', 'stiffness', 'gravityPower']) if (j[key] !== undefined) finite(j[key], 0, 100);
        if (j.dragForce !== undefined) finite(j.dragForce, 0, 1);
        if (j.gravityDir) vector(j.gravityDir, 3, -1, 1);
      }
    }
    if (joints > 512 || pairs > 32768) throw fail();
  }
  if (!v1) {
    const colliders = array(vrm.secondaryAnimation?.colliderGroups, 128);
    let colliderCount = 0;
    for (const g of colliders) {
      index(g.node, nodes.length);
      for (const c of array(g.colliders, 128)) {
        const o = obj(c.offset);
        for (const axis of ['x', 'y', 'z']) finite(o[axis], -1000, 1000);
        finite(c.radius, 0, 100);
        colliderCount++;
      }
    }
    let joints = 0,
      pairs = 0;
    const descendants = (n: number): number =>
      1 + (nodes[n].children ?? []).reduce((sum: number, c: number) => sum + descendants(c), 0);
    for (const s of array(vrm.secondaryAnimation?.boneGroups, 128)) {
      if (!Array.isArray(s.bones) || s.bones.length > 128) throw fail();
      let count = 0;
      s.bones.forEach((n: number) => {
        index(n, nodes.length);
        count += descendants(n);
      });
      joints += count;
      for (const key of ['stiffiness', 'gravityPower', 'hitRadius']) if (s[key] !== undefined) finite(s[key], 0, 100);
      if (s.dragForce !== undefined) finite(s.dragForce, 0, 1);
      if (s.center !== undefined && s.center !== -1) index(s.center, nodes.length);
      if (s.colliderGroups !== undefined) {
        if (!Array.isArray(s.colliderGroups) || s.colliderGroups.length > 128) throw fail();
        s.colliderGroups.forEach((n: number) => index(n, colliders.length));
      }
      pairs += count * colliderCount;
    }
    if (joints > 512 || pairs > 32768) throw fail();
    for (const material of array(vrm.materialProperties, 128)) {
      if (
        ![
          'VRM/MToon',
          'VRM_USE_GLTFSHADER',
          'VRM/UnlitTexture',
          'VRM/UnlitCutout',
          'VRM/UnlitTransparent',
          'VRM/UnlitTransparentZWrite',
        ].includes(material.shader)
      )
        throw fail();
      for (const n of Object.values(material.textureProperties ?? {})) index(n, textures.length);
    }
  }
  for (const node of nodes) {
    const constraint = node.extensions?.VRMC_node_constraint;
    if (!constraint) continue;
    if (constraint.specVersion !== '1.0') throw fail();
    const c = obj(constraint.constraint);
    if (Object.keys(c).length !== 1) throw fail();
    const key = Object.keys(c)[0]!;
    if (!['roll', 'aim', 'rotation'].includes(key)) throw fail();
    index(c[key].source, nodes.length);
    if (c[key].weight !== undefined) finite(c[key].weight, 0, 1);
  }
  for (const m of materials) {
    const toon = m.extensions?.VRMC_materials_mtoon;
    if (toon && toon.specVersion !== '1.0') throw fail();
  }
  return {
    version: v1 ? '1.0' : '0.x',
    humanoid,
    expressions,
    lookAt: Boolean(look),
    springBone: Boolean(spring || vrm.secondaryAnimation),
    mtoon: v1
      ? materials.some((m: Obj) => m.extensions?.VRMC_materials_mtoon)
      : (vrm.materialProperties ?? []).some((m: Obj) => m.shader === 'VRM/MToon'),
  };
}
