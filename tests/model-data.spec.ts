import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { inspectGlb } from '../src/assets/glb';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultModelSettings } from '../src/models/types';
import { validateDesignAssets } from '../src/assets/design-assets';
import { modelFixture } from './helpers/model-fixture';

test('bounded original GLB rig exposes arbitrary clips/bones; metadata and asset IDs roundtrip', () => {
  const bytes = modelFixture(), info = inspectAsset(bytes, 'model/gltf-binary');
  expect(info.model?.clips.map((c) => c.name)).toEqual(['Rest / 待機', 'Stride', 'Sprint']); expect(info.model?.bones.map((b) => b.node)).toEqual([2, 3]);
  const doc = emptyDesign('youtube', 'retro'), source = info.model!;
  doc.decorations.push({ kind: 'model3d', id: 'character', assetId: `asset-${'a'.repeat(64)}`, name: 'Rig', opacity: 1, visible: true, locked: false, zIndex: 0, source, model: defaultModelSettings(source), placement: { anchor: { kind: 'viewport' }, x: .5, y: .5, widthPx: 200, heightPx: 200, rotationDeg: 0 } });
  expect(parseDesign(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  const layer = doc.decorations[0]!; const asset = { ...info, id: layer.assetId, name: 'Rig', byteLength: bytes.length };
  expect(() => validateDesignAssets(doc.decorations, new Map([[layer.assetId, asset]]))).not.toThrow();
  expect(() => validateDesignAssets(doc.decorations, new Map([[layer.assetId, { ...asset, model: { ...source, clips: [] } }]]))).toThrow();
  expect(() => parseDesign({ ...doc, schemaVersion: 9 })).toThrow();
  const invalid = structuredClone(doc); if (invalid.decorations[0]?.kind === 'model3d') invalid.decorations[0].model.clip = 99; expect(() => parseDesign(invalid)).toThrow();
});

test('external URIs, custom extensions, cycles, broken buffers and decompression bombs fail before loader', () => {
  for (const mutate of [
    (j: any) => { j.images[0].uri = 'https://attacker.invalid/secret.png'; },
    (j: any) => { j.buffers[0].uri = 'data:application/octet-stream;base64,AAAA'; },
    (j: any) => { j.extensionsUsed = ['KHR_draco_mesh_compression']; },
    (j: any) => { j.nodes[3].children = [0]; },
    (j: any) => { j.bufferViews[0].byteLength = 1e9; },
    (j: any) => { j.accessors[0].count = 2e9; },
    (j: any) => { j.animations[0].channels[0].target.node = 99999; },
  ]) expect(() => inspectGlb(modelFixture(mutate))).toThrow();
  const truncated = modelFixture().subarray(0, -4); expect(() => inspectAsset(truncated)).toThrow();
  expect(() => inspectAsset(modelFixture(), 'image/png')).toThrow(/MIME/);
});
