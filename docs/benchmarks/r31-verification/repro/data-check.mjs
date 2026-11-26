// Independent before/after oracle. No checked-in goldens are regenerated.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

const root = process.cwd(),
  out = path.join(root, '.work/evidence');
await mkdir(out, { recursive: true });
async function api(source, label, more = '') {
  const exports = [
    ['src/design/schema.ts', 'parseDesign,emptyDesign'],
    ['src/design/renderer.ts', 'compileDesign'],
    ['src/world/evaluate.ts', 'evaluateWorld,initialWorldState'],
    ['src/sites/youtube-targets.ts', 'YOUTUBE_DESIGN_TARGETS'],
    ['src/assets/inspect.ts', 'inspectAsset'],
    ['src/assets/design-assets.ts', 'validateDesignAssets'],
    ['src/renderers/three/vrm-player.ts', 'createVrmPlayer'],
    ['src/models/types.ts', 'defaultModelSettings'],
  ]
    .map(([p, names]) => `export {${names}} from ${JSON.stringify(path.join(source, p))};`)
    .join('\n');
  const file = path.join(root, `.work/r31-tools/${label}.mjs`);
  await build({
    stdin: { contents: exports + more, resolveDir: source },
    absWorkingDir: source,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    loader: { '.css': 'text' },
    outfile: file,
    logLevel: 'silent',
  });
  return import(pathToFileURL(file).href);
}
const before = await api(path.resolve('../r31-before'), 'before');
const after = await api(
  root,
  'after',
  `\nexport {inspectVrma,VRMA_LIMITS} from ${JSON.stringify(path.join(root, 'src/assets/vrma.ts'))};\nexport {parseVrmAnimationInfo,motionUsable} from ${JSON.stringify(path.join(root, 'src/characters/settings.ts'))};\nexport {vrmaFixture} from ${JSON.stringify(path.join(root, 'tests/helpers/vrma-fixture.ts'))};\nexport {vrmFixture} from ${JSON.stringify(path.join(root, 'tests/helpers/vrm-fixture.ts'))};`,
);
const digest = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
const checks = [],
  failures = [];
async function check(name, fn) {
  try {
    checks.push({ name, ...(await fn()), pass: true });
  } catch (e) {
    failures.push({ name, error: e.message });
    checks.push({ name, pass: false, error: e.message });
  }
}
const files = (await readdir('tests/fixtures/designs')).filter((f) => /^(history-)?v\d+\.json$/.test(f)).sort();
const fixtures = new Map(
  await Promise.all(files.map(async (f) => [f, await readFile('tests/fixtures/designs/' + f, 'utf8')])),
);
const captured = { baseline: '8e63f0d451eeaf7811b7e0b5b60070d10b5233a9', documents: {} };
for (const file of files)
  await check('compatibility:' + file, () => {
    const input = JSON.parse(requireRead(file));
    const frozen = JSON.stringify(input),
      b = before.parseDesign(input),
      a = after.parseDesign(input);
    captured.documents[file] = b;
    assert.deepEqual({ ...a, schemaVersion: 13 }, b);
    assert.equal(JSON.stringify(input), frozen);
    const bc = before.compileDesign(b, before.YOUTUBE_DESIGN_TARGETS),
      ac = after.compileDesign(a, after.YOUTUBE_DESIGN_TARGETS);
    assert.equal(ac, bc);
    let bs = before.initialWorldState(),
      as = after.initialWorldState(),
      frames = [];
    for (let n = 0; n < 100; n++) {
      const inputFrame = {
        timeMs: n * 37,
        deltaMs: n ? 37 : 0,
        viewport: { width: n < 50 ? 1100 : 1440, height: n < 50 ? 760 : 900 },
        anchors: n === 75 ? {} : { 'video-player': { left: 80, top: 100, width: 720 + (n % 3) * 10, height: 400 } },
        signals: { pointer: n % 7 ? { x: 150 + n, y: 190 } : undefined, playing: n % 9 < 5 },
        events:
          n === 50
            ? [{ type: 'host.lifecycle' }]
            : n % 10 === 0
              ? [{ type: 'pointer.click', point: { x: 300, y: 250 } }]
              : [],
        environment: { hidden: n === 76, reducedMotion: n === 77, safeInteraction: n === 78 },
      };
      const be = before.evaluateWorld(b, bs, inputFrame),
        ae = after.evaluateWorld(a, as, inputFrame);
      assert.deepEqual(ae, be);
      bs = be.state;
      as = ae.state;
      frames.push(be);
    }
    return {
      version: input.schemaVersion,
      cssHash: digest(bc),
      parsedHash: digest(b),
      framesHash: digest(frames),
      frames: 100,
    };
  });
function requireRead(file) {
  return fixtures.get(file);
}
await writeFile(path.join(out, 'compat-before-captured.json'), JSON.stringify(captured, null, 2));

const rejects = new Map([
  ['mesh', () => after.vrmaFixture({}, (j) => (j.meshes = []))],
  ['image', () => after.vrmaFixture({}, (j) => (j.images = []))],
  ['uri', () => after.vrmaFixture({}, (j) => (j.buffers[0].uri = 'https://example.invalid/motion.bin'))],
  ['nested-uri', () => after.vrmaFixture({}, (j) => (j.extras = { metadata: { uri: 'data:text/plain,no' } }))],
  [
    'expression',
    () => after.vrmaFixture({}, (j) => (j.extensions.VRMC_vrm_animation.expressions.preset.happy = { node: 2 })),
  ],
  ['other-extension', () => after.vrmaFixture({}, (j) => (j.extensions.KHR_lights_punctual = {}))],
  [
    'unknown-bone',
    () => after.vrmaFixture({}, (j) => (j.extensions.VRMC_vrm_animation.humanoid.humanBones.tail = { node: 0 })),
  ],
  ['head-translation', () => after.vrmaFixture({}, (j) => (j.animations[0].channels[0].target.node = 3))],
  ['scale', () => after.vrmaFixture({}, (j) => (j.animations[0].channels[0].target.path = 'scale'))],
  ['truncated', () => after.vrmaFixture().subarray(0, 100)],
  ['oversized', () => Buffer.alloc(8 * 1024 * 1024 + 1)],
  ['nan-key', () => after.vrmaFixture({ times: [0, NaN, 1] })],
  ['infinite-key', () => after.vrmaFixture({ times: [0, 0.5, Infinity] })],
  [
    'nan-position',
    () =>
      after.vrmaFixture({
        hips: [
          [0, 0.9, 0],
          [NaN, 0.7, 0],
          [0, 0.5, 0],
        ],
      }),
  ],
  [
    'infinite-quaternion',
    () =>
      after.vrmaFixture({
        rotations: [
          [0, 0, 0, 1],
          [0, Infinity, 0, 1],
          [0, 0, 0, 1],
        ],
      }),
  ],
  ['duration-601', () => after.vrmaFixture({ times: [0, 300, 601] })],
  ['duration-1e8', () => after.vrmaFixture({ times: [0, 300, 1e8] })],
  [
    'derived-hips-infinity',
    () =>
      after.vrmaFixture({}, (j) => {
        j.nodes[0].children = [7];
        for (let n = 0; n < 51; n++) j.nodes.push({ scale: [1, 1e6, 1], children: [n === 50 ? 1 : 8 + n] });
        j.nodes[1].translation = [0, 1e6, 0];
      }),
  ],
  ['bad-scene-index', () => after.vrmaFixture({}, (j) => (j.scene = 999))],
  ['bad-scene-root', () => after.vrmaFixture({}, (j) => (j.scenes[0].nodes = [999]))],
]);
for (const [name, make] of rejects)
  await check('vrma-reject:' + name, () => {
    const data = make();
    let error = '';
    try {
      after.inspectAsset(new Uint8Array(data));
    } catch (e) {
      error = e.message;
    }
    assert.ok(error, `${name} accepted by import inspector`);
    return { bytes: data.length, error };
  });
await check('vrma-duration-boundary', () => {
  assert.equal(after.inspectVrma(after.vrmaFixture({ times: [0, 300, 600] })).info.duration, 600);
  return {};
});
const animation = after.inspectVrma(after.vrmaFixture()).info;
const model = after.inspectAsset(after.vrmFixture()).model;
const aid = (n) => 'asset-' + n.toString(16).padStart(64, '0');
const layer = {
  ...after.parseDesign(JSON.parse(fixtures.get('history-v13.json'))).decorations[0],
  source: model,
  assetId: aid(1),
  model: after.defaultModelSettings(model),
  character: {
    standardMotions: 'auto',
    motions: [{ id: 'idle', assetId: aid(2), role: 'idle', origin: 'character', loop: true, source: animation }],
  },
};
const assets = new Map([
  [aid(1), { model }],
  [aid(2), { vrmAnimation: animation }],
]);
for (const [key, value] of [
  ['duration', 2],
  ['bones', ['hips']],
  ['restHipsHeight', 2],
  ['hipsTravel', [0.2, 0.2, 0.2]],
  ['hipsTranslation', false],
])
  await check('measured-facts:' + key, () => {
    const bad = structuredClone(layer);
    bad.character.motions[0].source[key] = value;
    assert.throws(() => after.validateDesignAssets([bad], assets));
    return {};
  });
await check('character-origin-overrides-body-and-off', () => {
  for (const body of [undefined, { height: 0.8, headLength: 0.3, headsTall: 2.6, legRatio: 0.2, hipRatio: 0.3 }])
    for (const standardMotions of ['auto', 'on', 'off'])
      assert.equal(after.motionUsable({ ...layer.character, standardMotions }, 0, body), true);
  return { cases: 6 };
});

// Use real GLTFLoader/VRM, not mocked humanoid.update(). Same original fixture, raw embedded clip.
const bytes = after.vrmFixture((j) => {
  delete j.images;
  delete j.textures;
  delete j.materials[0].pbrMetallicRoughness.baseColorTexture;
});
const poses = [];
async function embedded(api, inPlace) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p, { autoUpdateHumanBones: false }));
  const gltf = await loader.parseAsync(new Uint8Array(bytes).slice().buffer, '');
  const vrm = gltf.userData.vrm,
    model = api.defaultModelSettings(api.inspectAsset(bytes).model);
  model.inPlace = inPlace;
  model.look.enabled = true;
  model.vrm.expressions = { happy: 0.6 };
  const player = api.createVrmPlayer(gltf, vrm, inPlace),
    result = [];
  for (let n = 0; n < 90; n++) {
    const f = {
      id: 'avatar',
      clip: 0,
      timeMs: n * 17,
      previousClip: null,
      previousTimeMs: 0,
      fadeElapsedMs: 0,
      fadeDurationMs: 0,
      yawDeg: 0,
      lookYaw: (n % 20) - 10,
      lookPitch: (n % 10) - 5,
      suspended: n === 60,
      phase: 'manual',
      blend: 1,
      speedPx: 0,
    };
    const painted = player.paint(f, model, n * 17);
    vrm.scene.updateWorldMatrix(true, true);
    result.push({
      painted,
      nodes: vrm.humanoid.rawHumanBones
        ? Object.fromEntries(
            Object.entries(vrm.humanoid.rawHumanBones).map(([name, b]) => [
              name,
              { position: b.node.position.toArray(), quaternion: b.node.quaternion.toArray() },
            ]),
          )
        : [],
    });
  }
  player.destroy();
  return result;
}
await check('embedded-vrm-real-loader-pose-parity', async () => {
  for (const inPlace of [false, true]) {
    const b = await embedded(before, inPlace),
      a = await embedded(after, inPlace);
    assert.deepEqual(a, b);
    poses.push(...a);
  }
  return { frames: poses.length, inPlaceModes: [false, true], hash: digest(poses) };
});
await writeFile(
  path.join(out, 'independent-data.json'),
  JSON.stringify({ checks, failures, total: checks.length, passed: checks.length - failures.length }, null, 2),
);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
