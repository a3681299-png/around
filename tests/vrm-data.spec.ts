import { test, expect } from '@playwright/test';
import { inspectAsset } from '../src/assets/inspect';
import { emptyDesign, parseDesign } from '../src/design/schema';
import { defaultModelSettings, patchModel } from '../src/models/types';
import { createAssetTransfers } from '../src/assets/transfers';
import { ASSET_LIMITS } from '../src/assets/validation';
import { vrmFixture } from './helpers/vrm-fixture';
import { modelFixture } from './helpers/model-fixture';
import { evaluateWorld, initialWorldState } from '../src/world/evaluate';

test('VRM1 preserves humanoid, expression, spring and MToon capabilities with v11 roundtrip', () => {
  const source = inspectAsset(vrmFixture(), 'model/vrm').model!;
  expect(source.format).toBe('vrm');
  expect(source.vrm).toMatchObject({
    version: '1.0',
    expressions: ['happy', 'blink'],
    mtoon: true,
    lookAt: true,
    springBone: true,
  });
  const doc = emptyDesign('youtube', 'retro');
  const settings = defaultModelSettings(source);
  expect(settings.look).toMatchObject({ enabled: true, bone: 3 });
  doc.decorations.push({
    kind: 'model3d',
    id: 'avatar',
    assetId: `asset-${'a'.repeat(64)}`,
    name: 'Avatar',
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    source,
    model: settings,
    placement: { anchor: { kind: 'viewport' }, x: 0.5, y: 0.5, widthPx: 256, heightPx: 256, rotationDeg: 0 },
  });
  expect(parseDesign(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  const updated = patchModel(settings, { vrm: { expressions: { happy: 0.6 } } }, source);
  expect(updated.vrm).toMatchObject({ lookAt: true, headFollow: true, springBone: true, expressions: { happy: 0.6 } });
  expect(() => patchModel(updated, { vrm: { expressions: { script: 1 } } }, source)).toThrow();
  expect(() => patchModel(updated, { vrm: { expressions: { happy: Infinity } } }, source)).toThrow();
  const run = () => {
    let state = initialWorldState();
    return Array.from({ length: 30 }, (_, index) => {
      const result = evaluateWorld(doc, state, {
        timeMs: index * 16,
        deltaMs: index ? 16 : 0,
        viewport: { width: 1100, height: 760 },
        anchors: {},
        signals: { playing: false, pointer: { x: 200 + index * 20, y: 300 } },
        events: [],
        environment: { hidden: false, reducedMotion: false },
      });
      state = result.state;
      return result;
    });
  };
  expect(run()).toEqual(run());
  expect(run().at(-1)?.frame.models?.[0]?.lookYaw).not.toBe(0);
});

test('existing v10 GLB settings migrate without losing authored clips, assets or transforms', () => {
  const source = inspectAsset(modelFixture()).model!,
    doc = {
      ...emptyDesign('youtube', 'retro'),
      schemaVersion: 10,
      decorations: [
        {
          kind: 'model3d',
          id: 'rig',
          assetId: `asset-${'b'.repeat(64)}`,
          name: 'Rig',
          opacity: 0.8,
          visible: true,
          locked: false,
          zIndex: 0,
          source,
          model: defaultModelSettings(source),
          placement: { anchor: { kind: 'viewport' }, x: 0.3, y: 0.7, widthPx: 250, heightPx: 290, rotationDeg: 25 },
        },
      ],
    };
  const before = JSON.stringify(doc),
    migrated = parseDesign(doc);
  expect(migrated.schemaVersion).toBe(11);
  expect(migrated.decorations).toEqual(doc.decorations);
  expect(JSON.stringify(doc)).toBe(before);
});

test('legacy VRM0 metadata uses the same three-vrm expression names without relabeling it VRM1', () => {
  const bytes = vrmFixture((j) => {
    const modern = j.extensions.VRMC_vrm;
    j.extensionsUsed = ['VRM', 'KHR_materials_unlit'];
    delete j.materials[0].extensions.VRMC_materials_mtoon;
    j.extensions = {
      VRM: {
        specVersion: '0.0',
        humanoid: {
          humanBones: Object.entries(modern.humanoid.humanBones).map(([bone, v]: [string, any]) => ({
            bone,
            node: v.node,
          })),
        },
        meta: { title: 'Original test box', author: 'Tests', licenseName: 'CC0' },
        firstPerson: { lookAtTypeName: 'Bone', firstPersonBone: 3 },
        blendShapeMaster: {
          blendShapeGroups: [
            { name: 'Joy', presetName: 'joy', binds: [{ mesh: 0, index: 0, weight: 40 }] },
            { name: 'A', presetName: 'a', binds: [] },
          ],
        },
        secondaryAnimation: { boneGroups: [], colliderGroups: [] },
        materialProperties: [],
      },
    };
  });
  expect(inspectAsset(bytes).model?.vrm).toMatchObject({ version: '0.x', expressions: ['happy', 'aa'], lookAt: true });
});

for (const [label, mutate] of [
  [
    'external URL',
    (j: any) => {
      j.images[0].uri = 'https://invalid.example/asset';
    },
  ],
  [
    'unsupported version',
    (j: any) => {
      j.extensions.VRMC_vrm.specVersion = '2.0';
    },
  ],
  [
    'bone index',
    (j: any) => {
      j.extensions.VRMC_vrm.humanoid.humanBones.head.node = 99999;
    },
  ],
  [
    'missing hips',
    (j: any) => {
      delete j.extensions.VRMC_vrm.humanoid.humanBones.hips;
    },
  ],
  [
    'morph index',
    (j: any) => {
      j.extensions.VRMC_vrm.expressions.preset.happy.morphTargetBinds[0].index = 5;
    },
  ],
  [
    'spring index',
    (j: any) => {
      j.extensions.VRMC_springBone.springs[0].joints[0].node = -1;
    },
  ],
  [
    'spring force',
    (j: any) => {
      j.extensions.VRMC_springBone.springs[0].joints[0].gravityPower = 1e9;
    },
  ],
] as const)
  test(`VRM rejects ${label}`, () => expect(() => inspectAsset(vrmFixture(mutate))).toThrow());

test('chunked uploads are bounded, ordered, isolated by owner, cancellable and expiring', () => {
  const t = createAssetTransfers(),
    start = () => t.start('a', 'owner', 4, 'avatar.vrm', '', 0);
  start();
  expect(() => t.append('a', 'intruder', 0, new Uint8Array([1]), 1)).toThrow();
  expect(() => t.append('a', 'owner', 1, new Uint8Array([1]), 1)).toThrow();
  expect(() => t.finish('a', 'owner', 2)).toThrow();
  t.append('a', 'owner', 0, new Uint8Array([1, 2]), 3);
  t.append('a', 'owner', 2, new Uint8Array([3, 4]), 4);
  expect([...t.finish('a', 'owner', 5).bytes]).toEqual([1, 2, 3, 4]);
  expect(() => t.finish('a', 'owner', 6)).toThrow();
  start();
  t.abort('a', 'owner', 1);
  expect(() => t.append('a', 'owner', 0, new Uint8Array([1]), 2)).toThrow();
  start();
  expect(() => t.finish('a', 'owner', 60001)).toThrow();
  expect(() => t.start('a', 'owner', ASSET_LIMITS.modelBytes + 1, 'a', '', 0)).toThrow();
  start();
  expect(() => t.append('a', 'owner', 0, new Uint8Array(ASSET_LIMITS.chunkBytes + 1), 1)).toThrow();
});
