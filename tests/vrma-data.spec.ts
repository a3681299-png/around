import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { inspectVrma, VRMA_LIMITS } from '../src/assets/vrma';
import { inspectGlb } from '../src/assets/glb';
import { vrmaFixture, overflowingHipsVrma } from './helpers/vrma-fixture';
import { vrmFixture } from './helpers/vrm-fixture';
import { inspectAsset } from '../src/assets/inspect';

const bytes = (b: Buffer) => new Uint8Array(b);

test('a VRM Animation gives its duration, bones, rest hips height and hips travel', () => {
  const { info } = inspectVrma(bytes(vrmaFixture()));
  expect(info).toEqual({
    format: 'vrma',
    name: 'sit',
    duration: 1,
    bones: ['hips', 'spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg'],
    hipsTranslation: true,
    restHipsHeight: expect.closeTo(0.9, 6),
    hipsTravel: [expect.closeTo(0, 6), expect.closeTo(-0.4, 6), expect.closeTo(0.1, 6)],
    // Time-weighted over the keys: (0.9+0.7)/2·0.5 + (0.7+0.5)/2·0.5.
    hipsHeight: expect.closeTo(0.7, 6),
  });
});

test('the hips height is weighted by time, so a crouch held long reads lower than a dip', () => {
  const held = inspectVrma(
    bytes(
      vrmaFixture({
        times: [0, 0.1, 1],
        hips: [
          [0, 0.9, 0],
          [0, 0.5, 0],
          [0, 0.5, 0],
        ],
      }),
    ),
  ).info;
  const dip = inspectVrma(
    bytes(
      vrmaFixture({
        times: [0, 0.9, 1],
        hips: [
          [0, 0.9, 0],
          [0, 0.9, 0],
          [0, 0.5, 0],
        ],
      }),
    ),
  ).info;
  expect(held.hipsHeight).toBeCloseTo(0.52, 6);
  expect(dip.hipsHeight).toBeCloseTo(0.88, 6);
});

test('a one-frame pose is a valid motion of length 0 (engine layers breathing on top)', () => {
  const { info } = inspectVrma(bytes(vrmaFixture({ times: [0], hips: [[0, 0.5, 0.1]], rotations: [[0, 0, 0, 1]] })));
  expect(info.duration).toBe(0);
  expect(info.hipsTravel).toEqual([0, 0, 0]);
  expect(info.hipsHeight).toBeCloseTo(0.5, 6);
});

test('a motion without hips translation reports none', () => {
  const { info } = inspectVrma(
    bytes(
      vrmaFixture({}, (j) => {
        j.animations[0].channels.shift();
        j.animations[0].channels[0].sampler = 1;
      }),
    ),
  );
  expect(info.hipsTranslation).toBe(false);
  expect(info.hipsTravel).toEqual([0, 0, 0]);
  // Hips that never move stay at the rest height.
  expect(info.hipsHeight).toBeCloseTo(info.restHipsHeight, 6);
});

const rejects: [string, (j: Record<string, any>) => void][] = [
  ['a scene index out of range', (j) => (j.scene = 999)],
  ['a negative scene index', (j) => (j.scene = -1)],
  ['a null scene index', (j) => (j.scene = null)],
  ['a fractional scene index', (j) => (j.scene = 0.5)],
  ['no scenes', (j) => delete j.scenes],
  ['a scene root out of range', (j) => (j.scenes[0].nodes = [999])],
  ['a scene root that is not an index', (j) => (j.scenes[0].nodes = ['0'])],
  ['scene roots that are not an array', (j) => (j.scenes[0].nodes = 0)],
  ['a node child out of range', (j) => (j.nodes[0].children = [999])],
  ['an accessor index out of range', (j) => (j.animations[0].samplers[0].input = 999)],
  ['an output accessor index out of range', (j) => (j.animations[0].samplers[0].output = 999)],
  ['a bufferView index out of range', (j) => (j.accessors[0].bufferView = 999)],
  ['an unused accessor reference out of range', (j) => j.accessors.push({ ...j.accessors[0], bufferView: 999 })],
  ['a buffer index out of range', (j) => (j.bufferViews[0].buffer = 999)],
  ['an animation target out of range', (j) => (j.animations[0].channels[0].target.node = 999)],
  ['an animation sampler out of range', (j) => (j.animations[0].channels[0].sampler = 999)],
  ['an unused sampler reference out of range', (j) => j.animations[0].samplers.push({ input: 999, output: 1 })],
  ['a mesh', (j) => (j.meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }])],
  ['an image', (j) => (j.images = [{ bufferView: 0, mimeType: 'image/png' }])],
  ['a skin', (j) => (j.skins = [{ joints: [1] }])],
  ['a material', (j) => (j.materials = [{}])],
  ['an external URI', (j) => (j.buffers[0].uri = 'https://example.com/a.bin')],
  ['a data URI', (j) => (j.buffers[0].uri = 'data:application/octet-stream;base64,AAAA')],
  ['another extension', (j) => j.extensionsUsed.push('KHR_materials_unlit')],
  ['a required unknown extension', (j) => (j.extensionsRequired = ['EXT_meshopt_compression'])],
  ['a node extension', (j) => (j.nodes[1].extensions = { VRMC_node_constraint: {} })],
  ['no VRMC_vrm_animation', (j) => delete j.extensions.VRMC_vrm_animation],
  ['a wrong spec version', (j) => (j.extensions.VRMC_vrm_animation.specVersion = '0.0')],
  ['an unknown bone name', (j) => (j.extensions.VRMC_vrm_animation.humanoid.humanBones.tail = { node: 6 })],
  ['no hips', (j) => delete j.extensions.VRMC_vrm_animation.humanoid.humanBones.hips],
  ['a shared bone node', (j) => (j.extensions.VRMC_vrm_animation.humanoid.humanBones.head = { node: 2 })],
  ['a bone node out of range', (j) => (j.extensions.VRMC_vrm_animation.humanoid.humanBones.head = { node: 99 })],
  ['expressions', (j) => (j.extensions.VRMC_vrm_animation.expressions.preset.happy = { node: 3 })],
  ['lookAt', (j) => (j.extensions.VRMC_vrm_animation.lookAt = { node: 3 })],
  ['translation on a non-hips bone', (j) => (j.animations[0].channels[1].target.path = 'translation')],
  ['scale', (j) => (j.animations[0].channels[1].target.path = 'scale')],
  ['a channel on a non-humanoid node', (j) => (j.animations[0].channels[1].target.node = 0)],
  ['a duplicated channel', (j) => j.animations[0].channels.push({ ...j.animations[0].channels[1] })],
  ['two animations', (j) => j.animations.push(j.animations[0])],
  ['no animation', (j) => (j.animations = [])],
  ['an unknown interpolation', (j) => (j.animations[0].samplers[0].interpolation = 'BEZIER')],
  ['a node cycle', (j) => (j.nodes[3].children = [1])],
  ['an out-of-range node value', (j) => (j.nodes[1].translation = [0, 1e30, 0])],
  ['a node matrix that is not 16 numbers', (j) => (j.nodes[1].matrix = [1, 0, 0])],
  ['an unknown top-level key', (j) => (j.cameras = [{ type: 'perspective' }])],
];
for (const [name, mutate] of rejects)
  test(`rejects ${name}`, () => {
    expect(() => inspectVrma(bytes(vrmaFixture({}, mutate)))).toThrow();
  });

test('valid nonzero scene and last-node references retain the same measured motion', () => {
  const expected = inspectVrma(bytes(vrmaFixture())).info;
  expect(
    inspectVrma(
      bytes(
        vrmaFixture({}, (j) => {
          j.scenes.push({ nodes: [0] });
          j.scene = 1;
          j.animations[0].channels = [{ sampler: 1, target: { node: j.nodes.length - 1, path: 'rotation' } }];
        }),
      ),
    ).info,
  ).toEqual({ ...expected, hipsTranslation: false, hipsTravel: [0, 0, 0], hipsHeight: expected.restHipsHeight });
});

test('finite inputs that overflow the derived hips height are refused at the import boundary', () => {
  const motion = bytes(overflowingHipsVrma());
  expect(() => inspectVrma(motion)).toThrow();
  expect(() => inspectAsset(motion, 'model/gltf-binary')).toThrow();
});

test('rejects decreasing key times, NaN values and output shorter than input', () => {
  expect(() => inspectVrma(bytes(vrmaFixture({ times: [0, 1, 0.5] })))).toThrow();
  expect(() =>
    inspectVrma(
      bytes(
        vrmaFixture({
          hips: [
            [0, Number.NaN, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        }),
      ),
    ),
  ).toThrow();
  expect(() => inspectVrma(bytes(vrmaFixture({ hips: [[0, 0.9, 0]] })))).toThrow();
});

test('limits: duration and key count boundaries', () => {
  const at = VRMA_LIMITS.durationSeconds;
  expect(inspectVrma(bytes(vrmaFixture({ times: [0, at / 2, at] }))).info.duration).toBe(at);
  expect(() => inspectVrma(bytes(vrmaFixture({ times: [0, at / 2, at + 1] })))).toThrow();
  expect(() => inspectVrma(new Uint8Array(VRMA_LIMITS.fileBytes + 1))).toThrow();
});

test('a VRM model is not a motion, and a motion is not a model', () => {
  expect(() => inspectVrma(bytes(vrmFixture()))).toThrow();
  expect(() => inspectGlb(bytes(vrmaFixture()))).toThrow();
});

// Local only: the private motion files are never in the repository or CI.
test('local motions: every .vrma in AROUND_VRMA_DIR passes', () => {
  const dir = process.env['AROUND_VRMA_DIR'];
  test.skip(!dir || !fs.existsSync(dir), 'AROUND_VRMA_DIR is not set');
  const files = fs.readdirSync(dir!).filter((f) => f.endsWith('.vrma'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const { info } = inspectVrma(new Uint8Array(fs.readFileSync(path.join(dir!, file))));
    expect(info.bones, file).toContain('hips');
    expect(info.duration, file).toBeGreaterThanOrEqual(0);
  }
});
