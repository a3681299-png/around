// The asset contract's automatic checks (agent-skills/wwt-asset-contract/references/checks.md).
//   node scripts/city-assets/check.mjs [src/playground/city-assets]
// Reads the manifest and every GLB with no dependency: GLB chunks, accessor bounds, node
// transforms, material and node names. Exit code 1 when anything is wrong.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN } from '../playground/check-output.mjs';

export const BUDGET = { resident: 3000, hero: 4000, prop: 500, street: 800, harbor: 800, ship: 3000, culture: 6000 };
export const SLOTS = new Set([
  'slot_skin',
  'slot_hair',
  'slot_top',
  'slot_bottom',
  'slot_shoes',
  'slot_accent',
  'slot_wood',
  'slot_metal',
  'slot_stone',
  'slot_cloth',
  'slot_glass',
  'slot_light',
  'slot_tex',
  'slot_plant',
]);
const KINDS = new Set(Object.keys(BUDGET));
const STATUS = new Set(['placeholder', 'draft', 'final']);
const ATTACH = ['attach_head', 'attach_hand_l', 'attach_hand_r', 'attach_back'];
// Where the origin sits (contract): on the ground for people and street things; the grip for hand
// props; the waterline for ships (the hull goes below it); the deck top for harbour things that may
// stand in water.
const FEET = new Set(['resident', 'street', 'culture']);

/** Parse a GLB into the numbers the contract cares about. */
export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('not a glTF 2 binary');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const accessors = json.accessors ?? [];
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) throw new Error('a primitive is not triangles');
      const position = accessors[primitive.attributes.POSITION];
      tris += (primitive.indices !== undefined ? accessors[primitive.indices].count : position.count) / 3;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], position.min[i]);
        max[i] = Math.max(max[i], position.max[i]);
      }
    }
  const bufferLength = bytes.length - 20 - jsonLength - 8;
  for (const view of json.bufferViews ?? [])
    if ((view.byteOffset ?? 0) + view.byteLength > bufferLength) throw new Error('a buffer view runs past the data');
  for (const accessor of accessors) if (accessor.count < 0) throw new Error('an accessor has a negative count');
  return {
    json,
    tris,
    min,
    max,
    materials: (json.materials ?? []).map((m) => m.name),
    nodes: json.nodes ?? [],
    sceneRoots: (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((i) => json.nodes[i]),
  };
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const identityTransform = (node) =>
  !node.matrix &&
  (!node.scale || node.scale.every((s) => near(s, 1, 1e-4))) &&
  (!node.rotation || near(Math.abs(node.rotation[3]), 1, 1e-4));

function glbFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? glbFiles(path) : name.endsWith('.glb') ? [path] : [];
  });
}

/** Every contract problem in a city-assets folder, as readable lines (empty when all is well). */
export function checkCityAssets(root) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const humanoid = JSON.parse(readFileSync(join(root, 'humanoid.json'), 'utf8'));
  const listed = new Set();
  const ids = new Set();
  for (const row of manifest.assets) {
    const say = (text) => problems.push(`${row.id}: ${text}`);
    if (ids.has(row.id)) say('duplicate id');
    ids.add(row.id);
    if (FORBIDDEN.some((pattern) => pattern.test(row.id) || pattern.test(row.file ?? ''))) say('forbidden name');
    if (!KINDS.has(row.kind)) say(`unknown kind "${row.kind}"`);
    if (!STATUS.has(row.status)) say(`unknown status "${row.status}"`);
    if (row.status === 'placeholder' || !row.file) {
      if (row.status !== 'placeholder' && !row.privateFile) say('a built row without a file');
      continue;
    }
    if (!row.source?.type || !row.source.author) say('no source recorded');
    listed.add(row.file);
    const path = join(root, row.file);
    if (!existsSync(path)) {
      say(`${row.file} is missing`);
      continue;
    }
    let glb;
    try {
      glb = readGlb(readFileSync(path));
    } catch (error) {
      say(`unreadable GLB (${error.message})`);
      continue;
    }
    const text = readFileSync(path).toString('latin1');
    if (FORBIDDEN.some((pattern) => pattern.test(text))) say('forbidden name inside the GLB');
    if (glb.tris > BUDGET[row.kind]) say(`${glb.tris} triangles over the ${row.kind} budget ${BUDGET[row.kind]}`);
    if (row.tris !== undefined && row.tris !== glb.tris)
      say(`manifest says ${row.tris} triangles, GLB has ${glb.tris}`);
    for (const name of glb.materials) if (!SLOTS.has(name)) say(`material "${name}" is not a contract slot`);
    for (const node of glb.sceneRoots)
      if (!identityTransform(node)) say(`node "${node.name}" has a scale or rotation (apply transforms)`);
    const height = glb.max[1] - glb.min[1];
    if (row.heightM !== undefined && !near(height, row.heightM, 0.02))
      say(`height ${height.toFixed(3)} m differs from heightM ${row.heightM}`);
    if (FEET.has(row.kind) && !near(glb.min[1], 0, 0.03))
      say(`origin is not at the feet (lowest point y=${glb.min[1].toFixed(3)})`);
    if (row.kind === 'ship' && !(glb.min[1] < 0 && glb.max[1] > 0)) say('origin is not at the waterline');
    if (row.kind === 'prop' && !(glb.min[1] <= 0.02 && glb.max[1] >= -0.02))
      say('origin is not inside the prop (grip)');
    if (row.kind === 'resident' || row.rig) {
      const rig = humanoid[row.rig ?? 'resident'];
      const names = new Set(glb.nodes.map((node) => node.name));
      for (const [key, name] of Object.entries(rig)) if (!names.has(name)) say(`bone "${name}" (${key}) is missing`);
      if (row.kind === 'resident')
        for (const name of ATTACH) if (!names.has(name)) say(`attach point "${name}" is missing`);
      if (!glb.json.skins?.length && glb.nodes.length) say('no skin');
      if (glb.json.animations?.length) say('animations are baked in (the world applies motions)');
    }
  }
  for (const path of glbFiles(root)) {
    const file = relative(root, path).replaceAll('\\', '/');
    if (!listed.has(file)) problems.push(`${file}: a GLB that no manifest row lists`);
  }
  return problems;
}

/** A minimal one-material GLB for tests: `tris` triangles spanning y 0..height. */
export function makeGlb({ material = 'slot_wood', height = 0.5, tris = 1, scale } = {}) {
  const positions = new Float32Array(tris * 9);
  for (let t = 0; t < tris; t++) positions.set([0, 0, t * 0.01, 0.1, 0, t * 0.01, 0, height, t * 0.01], t * 9);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'thing', mesh: 0, ...(scale ? { scale } : {}) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: material }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: tris * 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [0.1, height, (tris - 1) * 0.01],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, bin)]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? 'src/playground/city-assets');
  const found = checkCityAssets(root);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const built = manifest.assets.filter((row) => row.status !== 'placeholder').length;
  console.log(`city assets: ${built} built of ${manifest.assets.length} rows, ${found.length} problem(s)`);
  for (const line of found) console.log('  ' + line);
  process.exitCode = found.length ? 1 : 0;
}
