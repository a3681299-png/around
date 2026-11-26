import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { inspectGlb } from '../src/assets/glb';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultModelSettings } from '../src/models/types';
import { validateDesignAssets } from '../src/assets/design-assets';
import { modelFixture } from './helpers/model-fixture';
import { vrmFixture } from './helpers/vrm-fixture';
import type { ModelInfo } from '../src/models/types';

test('bounded original GLB rig exposes arbitrary clips/bones; metadata and asset IDs roundtrip', () => {
  const bytes = modelFixture(),
    info = inspectAsset(bytes, 'model/gltf-binary');
  expect(info.model?.clips.map((c) => c.name)).toEqual(['Rest / 待機', 'Stride', 'Sprint']);
  expect(info.model?.bones.map((b) => b.node)).toEqual([2, 3]);
  const doc = emptyDesign('youtube', 'retro'),
    source = info.model!;
  doc.decorations.push({
    kind: 'model3d',
    id: 'character',
    assetId: `asset-${'a'.repeat(64)}`,
    name: 'Rig',
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    source,
    model: defaultModelSettings(source),
    placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 0 },
  });
  expect(parseDesign(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  const layer = doc.decorations[0]!;
  const asset = { ...info, id: layer.assetId, name: 'Rig', byteLength: bytes.length };
  expect(() => validateDesignAssets(doc.decorations, new Map([[layer.assetId, asset]]))).not.toThrow();
  expect(() =>
    validateDesignAssets(doc.decorations, new Map([[layer.assetId, { ...asset, model: { ...source, clips: [] } }]])),
  ).toThrow();
  expect(() => parseDesign({ ...doc, schemaVersion: 9 })).toThrow();
  const invalid = structuredClone(doc);
  if (invalid.decorations[0]?.kind === 'model3d') invalid.decorations[0].model.clip = 99;
  expect(() => parseDesign(invalid)).toThrow();
});

test('external URIs, custom extensions, cycles, broken buffers and decompression bombs fail before loader', () => {
  for (const mutate of [
    (j: any) => {
      j.images[0].uri = 'https://attacker.invalid/secret.png';
    },
    (j: any) => {
      j.buffers[0].uri = 'data:application/octet-stream;base64,AAAA';
    },
    (j: any) => {
      j.extensionsUsed = ['KHR_draco_mesh_compression'];
    },
    (j: any) => {
      j.nodes[3].children = [0];
    },
    (j: any) => {
      j.bufferViews[0].byteLength = 1e9;
    },
    (j: any) => {
      j.accessors[0].count = 2e9;
    },
    (j: any) => {
      j.animations[0].channels[0].target.node = 99999;
    },
    (j: any) => {
      j.animations[0].channels.push(j.animations[0].channels[0]);
    },
  ])
    expect(() => inspectGlb(modelFixture(mutate))).toThrow();
  const truncated = modelFixture().subarray(0, -4);
  expect(() => inspectAsset(truncated)).toThrow();
});

test('legacy VRM sources omit only body: supplied body and every other model fact still match exactly', () => {
  const bytes = vrmFixture(),
    info = inspectAsset(bytes),
    measured = info.model!,
    source = structuredClone(measured);
  delete source.vrm!.body;
  const doc = emptyDesign('youtube', null),
    assetId = `asset-${'b'.repeat(64)}`;
  doc.decorations.push({
    kind: 'model3d',
    id: 'legacy-vrm',
    assetId,
    name: 'Legacy VRM',
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    source,
    model: defaultModelSettings(source),
    placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 200, heightPx: 200, rotationDeg: 0 },
  });
  const stored = { ...info, id: assetId, name: 'Original.vrm', byteLength: bytes.length },
    validate = (model: ModelInfo) => validateDesignAssets(doc.decorations, new Map([[assetId, { ...stored, model }]]));
  expect(() => validate(measured)).not.toThrow();
  // Ignoring a missing historical body must not hide a change in any other fact.
  for (const mutate of [
    (m: ModelInfo) => (m.clips[0]!.duration += 1),
    (m: ModelInfo) => (m.bones[0]!.node += 1),
    (m: ModelInfo) => (m.vertices += 1),
    (m: ModelInfo) => (m.triangles += 1),
    (m: ModelInfo) => (m.textureBytes += 1),
    (m: ModelInfo) => (m.vrm!.version = '0.x'),
    (m: ModelInfo) => (m.vrm!.humanoid[0]!.node += 1),
    (m: ModelInfo) => m.vrm!.expressions.pop(),
    (m: ModelInfo) => (m.vrm!.lookAt = !m.vrm!.lookAt),
    (m: ModelInfo) => (m.vrm!.springBone = !m.vrm!.springBone),
    (m: ModelInfo) => (m.vrm!.mtoon = !m.vrm!.mtoon),
  ]) {
    const changed = structuredClone(measured);
    mutate(changed);
    expect(() => validate(changed)).toThrow('一致');
  }
  source.vrm!.body = structuredClone(measured.vrm!.body!);
  expect(() => validate(measured)).not.toThrow();
  source.vrm!.body.height += 0.01;
  expect(() => validate(measured)).toThrow('一致');
  const withoutBody = structuredClone(measured);
  delete withoutBody.vrm!.body;
  expect(() => validate(withoutBody)).toThrow('一致');
  expect(info.model).toEqual(measured);
});

test('shared morph accessors cannot amplify a small file into an unbounded GPU texture', () => {
  const vertices = 120000,
    bin = Buffer.alloc(vertices * 3 * 4);
  for (let i = 0; i < vertices; i++) {
    bin.writeFloatLE(i % 2, i * 12);
    bin.writeFloatLE(i % 3, i * 12 + 4);
  }
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, targets: Array.from({ length: 32 }, () => ({ POSITION: 0 })) }] },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: vertices, min: [0, 0, 0], max: [1, 2, 0] }],
  };
  const raw = Buffer.from(JSON.stringify(json)),
    text = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]),
    bytes = Buffer.alloc(28 + text.length + bin.length);
  bytes.writeUInt32LE(0x46546c67);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(text.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  text.copy(bytes, 20);
  bytes.writeUInt32LE(bin.length, text.length + 20);
  bytes.writeUInt32LE(0x004e4942, text.length + 24);
  bin.copy(bytes, text.length + 28);
  expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
  expect(() => inspectGlb(bytes)).toThrow(/モーフ.*64MiB/);
  const small = inspectGlb(
    modelFixture((j) => {
      j.meshes[0].primitives[0].targets = [{ POSITION: 0 }];
    }),
  );
  expect(small.gpuBytes).toBeGreaterThan(8 * 16);
});
