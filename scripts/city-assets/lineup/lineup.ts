// The asset lineup (development only; never part of the product or the Playground build).
// It draws every manifest asset with the world's look (wwt-toon-look: three-band toon shading,
// navy screen-space outline, the colour table) at the review distances of wwt-asset-review-loop:
// far / mid / near / silhouette / night / props. scripts/city-assets/capture-lineup.mjs calls
// window.lineup.show(view) and screenshots the canvas.
import {
  AmbientLight,
  AnimationMixer,
  BackSide,
  Bone,
  Box3,
  BoxGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RedFormat,
  Scene,
  SkinnedMesh,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import colorways from '../../../src/playground/city-assets/colorways.json';
import humanoid from '../../../src/playground/city-assets/humanoid.json';

type Entry = {
  id: string;
  kind: string;
  file: string | null;
  roles: string[];
  cultures?: string[];
  heightM: number;
  status: string;
};
type View = 'far' | 'mid' | 'near' | 'sil' | 'night' | 'props' | 'hero' | 'culture';

const ink = '#2b3a5a';
const palette = { grass: '#8fd6b8', green: '#2e9e8c', pavement: '#eaf8f6', water: '#5aa9de', sky: '#bdeff5' };
const params = new URLSearchParams(location.search);
const width = Number(params.get('w') ?? 1600);
const height = Number(params.get('h') ?? 900);

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
document.body.append(renderer.domElement);
const pixels = new Vector2(width, height);

const bands = new DataTexture(new Uint8Array([88, 177, 255]), 3, 1, RedFormat);
bands.minFilter = bands.magFilter = NearestFilter;
bands.needsUpdate = true;

// --- materials -------------------------------------------------------------------------------
const lit = new Set<MeshToonMaterial>();
const lights = new Set<MeshToonMaterial>();
const silhouette = new MeshBasicMaterial({ color: '#1b2233' });
function toon(color: string, map: Texture | null = null) {
  const material = new MeshToonMaterial({
    color,
    map,
    gradientMap: bands,
    toneMapped: false,
    emissive: new Color(0x88868b),
    emissiveIntensity: 0.13,
  });
  lit.add(material);
  return material;
}
function glow(color: string) {
  const material = new MeshToonMaterial({ color, gradientMap: bands, toneMapped: false, emissive: new Color(color) });
  lights.add(material);
  return material;
}
/** The world's ink width (src/playground/city/projection.ts on codex/playground-city): `cityInk`
 * drawing-buffer pixels, 2.1 close up to 1.25 at the planet view, times the material's lineScale.
 * The world draws residents at lineScale 0.72; the lineup uses 1.0 for everything, the value
 * proposed to the world side, because 0.72 left residents nearly unlined at mid range. */
const cityInk = { value: 1.8 };
const INK_BY_VIEW: Record<string, number> = {
  near: 2.1,
  props: 2.1,
  hero: 2.1,
  mid: 1.8,
  sil: 1.8,
  night: 1.8,
  far: 1.25,
};
function inkMaterial(lineScale = 1) {
  const material = new MeshToonMaterial({ color: '#000000', emissive: ink, side: BackSide, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inkPixels = { value: pixels };
    shader.uniforms.cityInk = cityInk;
    shader.vertexShader = 'uniform vec2 inkPixels;\nuniform float cityInk;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      // BackSide defines FLIP_SIDED, which already negated transformedNormal: undo it to push outward.
      vec2 inkDir = (projectionMatrix * vec4(-normalize(transformedNormal), 0.0)).xy * inkPixels;
      gl_Position.xy += inkDir / max(length(inkDir), 0.0001) * cityInk * ${(2 * lineScale).toFixed(2)} / inkPixels * gl_Position.w;`,
    );
  };
  material.customProgramCacheKey = () => `ink-${lineScale}`;
  return material;
}
const inkThin = inkMaterial(Number(params.get('lineScale') ?? 1));

// --- colours ---------------------------------------------------------------------------------
type Colorway = Record<string, string>;
function colorway(seed: number): Colorway {
  const set = colorways.sets[seed % colorways.sets.length];
  return {
    slot_skin: colorways.skin[(seed * 3) % colorways.skin.length],
    slot_hair: colorways.hair[(seed * 7 + 1) % colorways.hair.length],
    slot_top: set.top,
    slot_bottom: set.bottom,
    slot_shoes: set.shoes,
    slot_accent: set.accent,
    slot_wood: colorways.materials.wood,
    slot_metal: colorways.materials.metal,
    slot_stone: colorways.materials.stone,
    slot_cloth: colorways.materials.cloth,
    slot_glass: colorways.materials.glass,
    slot_plant: colorways.materials.plant,
    slot_light: colorways.materials.light,
  };
}

/** Paint every mesh by its slot name and give it an outline twin. */
function dress(root: Object3D, colors: Colorway, map?: Texture | null) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  for (const mesh of meshes) {
    const paint = (material: Material) => {
      const name = material.name.replace(/\.\d+$/, '');
      if (name === 'slot_light') return glow(colors.slot_light);
      if (name === 'slot_tex' || map !== undefined)
        return toon('#ffffff', (material as MeshToonMaterial).map ?? map ?? null);
      return toon(colors[name] ?? '#ff00ff');
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
    // Not in userData: Object3D.clone() copies userData through JSON, which would flatten materials.
    mesh.userData.face = true;
    mesh.frustumCulled = false;
    const line = mesh.clone(false) as Mesh;
    line.material = inkThin;
    line.name = '';
    line.userData.ink = true;
    line.frustumCulled = false;
    if ((mesh as SkinnedMesh).isSkinnedMesh)
      (line as SkinnedMesh).bind((mesh as SkinnedMesh).skeleton, (mesh as SkinnedMesh).bindMatrix);
    mesh.parent!.add(line);
  }
}

// --- loading ---------------------------------------------------------------------------------
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
const load = (url: string) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url)!;
};

function contactShadow(radius: number) {
  const mesh = new Mesh(
    new CircleGeometry(radius, 20).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: '#4f7581', opacity: 0.32, transparent: true, depthWrite: false }),
  );
  mesh.position.y = 0.004;
  return mesh;
}

// --- posing (humanoid.json names, so the same code poses Tsumu and residents) ------------------
function bones(root: Object3D, rig: Record<string, string>) {
  const found: Record<string, Bone> = {};
  root.traverse((object) => {
    for (const [key, name] of Object.entries(rig))
      if (object.name === name.replace('.', '')) found[key] = object as Bone;
    for (const [key, name] of Object.entries(rig)) if (object.name === name) found[key] = object as Bone;
  });
  return found;
}
function turn(bone: Bone | undefined, axis: Vector3, degrees: number) {
  if (!bone?.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  const parent = bone.parent.getWorldQuaternion(new Quaternion());
  const world = bone.getWorldQuaternion(new Quaternion());
  const target = new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180).multiply(world);
  bone.quaternion.copy(parent.invert().multiply(target));
  bone.updateWorldMatrix(false, true);
}
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
type Pose = 'stand' | 'carry' | 'hang';
function pose(root: Object3D, kind: Pose) {
  const b = bones(root, humanoid.resident);
  root.updateWorldMatrix(true, true);
  if (kind === 'carry') {
    turn(b.leftUpperArm, Z, -58);
    turn(b.rightUpperArm, Z, 58);
    turn(b.leftUpperArm, Y, -42);
    turn(b.rightUpperArm, Y, 42);
    turn(b.leftLowerArm, Y, -38);
    turn(b.rightLowerArm, Y, 38);
  } else {
    turn(b.leftUpperArm, Z, -74);
    turn(b.rightUpperArm, Z, kind === 'hang' ? 62 : 74);
    turn(b.leftLowerArm, Y, -10);
    turn(b.rightLowerArm, Y, kind === 'hang' ? 30 : 10);
  }
}

const held: Record<string, { prop: string; pose: Pose }> = {
  dockworker: { prop: 'prop-crate', pose: 'carry' },
  shopkeeper: { prop: 'prop-broom', pose: 'hang' },
  lamplighter: { prop: 'prop-lantern', pose: 'hang' },
  musician: { prop: 'prop-instrument', pose: 'hang' },
  stargazer: { prop: 'prop-telescope', pose: 'hang' },
  gardener: { prop: 'prop-watering-can', pose: 'hang' },
  vendor: { prop: 'prop-stall-goods', pose: 'carry' },
  fisher: { prop: 'prop-fishing-rod', pose: 'hang' },
};

async function resident(entry: Entry, seed: number, withProp: boolean, props: Map<string, Entry>) {
  const gltf = await load(`assets/${entry.file}`);
  const root = cloneSkinned(gltf.scene);
  const role = entry.roles[0];
  const hold = withProp ? held[role] : undefined;
  pose(root, hold?.pose ?? 'stand');
  dress(root, colorway(seed));
  root.add(contactShadow(0.2));
  const propEntry = hold && props.get(hold.prop);
  if (propEntry?.file) {
    const prop = (await load(`assets/${propEntry.file}`)).scene.clone(true);
    dress(prop, colorway(seed + 2));
    root.updateWorldMatrix(true, true);
    const handR = root.getObjectByName('attach_hand_r');
    const handL = root.getObjectByName('attach_hand_l');
    if (hold!.pose === 'carry' && handR && handL) {
      // A two-handed load sits between the palms, upright in the body's frame.
      const a = handR.getWorldPosition(new Vector3());
      const c = handL.getWorldPosition(new Vector3());
      prop.position.copy(a.add(c).multiplyScalar(0.5));
      root.add(prop);
    } else handR?.add(prop);
  }
  return root;
}

async function tsumu() {
  try {
    const gltf = await load('private/tsumu-city.glb');
    const root = cloneSkinned(gltf.scene);
    root.scale.setScalar(0.72); // the world's display scale for Tsumu (src/playground/city/resident.ts)
    let map: Texture | null = null;
    root.traverse((object) => {
      const material = (object as Mesh).material as MeshToonMaterial | undefined;
      if (material?.map) map = material.map;
    });
    dress(root, colorway(0), map);
    const mixer = new AnimationMixer(root);
    const idle = gltf.animations.find((clip) => clip.name === 'Idle_Loop');
    if (idle) {
      mixer.clipAction(idle).play();
      mixer.setTime(0.6);
    }
    const group = new Group();
    group.add(root, contactShadow(0.22));
    return group;
  } catch {
    return null; // no private checkout: the lineup still runs, without the height reference
  }
}

async function prop(entry: Entry, seed: number) {
  const root = (await load(`assets/${entry.file}`)).scene.clone(true);
  dress(root, colorway(seed));
  return root;
}

// --- the stage -------------------------------------------------------------------------------
const scene = new Scene();
const sun = new DirectionalLight('#ffffff', 1.55);
sun.position.set(-4, 9, 7);
const ambient = new AmbientLight('#ffffff', 0.9);
const hemi = new HemisphereLight('#e8fbff', '#8fd6b8', 0.35);
const rim = new DirectionalLight('#ffd9a0', 0);
rim.position.set(3, 4, -6);
scene.add(sun, ambient, hemi, rim);
const camera = new PerspectiveCamera(30, width / height, 0.1, 600);

function ground() {
  const g = new Group();
  // Land in front of the quay line (z > -2.5), water behind it, so the pier and ship sit in water.
  const grass = new Mesh(new PlaneGeometry(160, 80).rotateX(-Math.PI / 2), toon(palette.grass));
  grass.position.set(0, 0, 37.5);
  const road = new Mesh(new PlaneGeometry(26, 4.2).rotateX(-Math.PI / 2), toon(palette.pavement));
  road.position.set(0, 0.002, 0.4);
  const water = new Mesh(new PlaneGeometry(160, 60).rotateX(-Math.PI / 2), toon(palette.water));
  water.position.set(0, -0.35, -32.5);
  const quay = new Mesh(new BoxGeometry(160, 0.4, 0.5), toon('#dfe7e6'));
  quay.position.set(0, -0.2, -2.5);
  g.add(grass, road, water, quay);
  return g;
}

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const views = new Map<View, Group>();
let manifest: Entry[] = [];

async function buildViews() {
  manifest = (await (await fetch('assets/manifest.json')).json()).assets;
  const props = new Map(manifest.map((entry) => [entry.id, entry]));
  const residents = manifest.filter((entry) => entry.kind === 'resident' && entry.file);
  const things = manifest.filter((entry) => entry.kind !== 'resident' && entry.kind !== 'hero' && entry.file);
  const placeAt = async (entry: Entry, px: number, pz: number, seed = 1) => {
    const object = await prop(entry, seed);
    object.position.set(px, 0, pz);
    // Ships pass along the quay, so they are judged side-on.
    if (entry.kind === 'ship') object.rotation.y = -Math.PI / 2;
    return object;
  };
  // Ships, the pier and the tall harbour landmarks stand by the water, behind the row.
  const waterSide = (entry: Entry) =>
    entry.kind === 'ship' || ['harbor-pier', 'harbor-crane', 'harbor-lighthouse'].includes(entry.id);

  // Every view is built fresh: skinned meshes cannot be shared by a plain clone.
  // Row: Tsumu first (height reference), then each resident standing, then those holding a prop.
  const rowView = async () => {
    const g = new Group();
    const row = new Group();
    let x = 0;
    const placeRow = (object: Object3D, step = 0.78) => {
      object.position.x = x;
      row.add(object);
      x += step;
    };
    const hero = await tsumu();
    if (hero) placeRow(hero);
    for (const [i, entry] of residents.entries()) placeRow(await resident(entry, i, false, props));
    for (const [i, entry] of residents.entries())
      if (held[entry.roles[0]]) placeRow(await resident(entry, i + 3, true, props), 0.86);
    row.position.x = -(x - 0.78) / 2;
    g.add(ground(), row);
    // Street and harbour things behind the row, so "fits the town" is judged in place.
    let bx = -5;
    for (const entry of things.filter((t) => ['street', 'harbor'].includes(t.kind) && !waterSide(t))) {
      g.add(await placeAt(entry, bx, -1.3));
      bx += 1.7;
    }
    for (const [i, entry] of things.filter(waterSide).entries())
      g.add(await placeAt(entry, -3.5 + i * 3.8, entry.kind === 'ship' ? -4.4 : -3.2));
    return g;
  };

  // Hero: Tsumu beside one resident of each role, at Tsumu's eye level (same work, same people?).
  const hero = new Group();
  hero.add(ground());
  const firstOfRole = [...new Map(residents.map((entry) => [entry.roles[0], entry])).values()];
  const pair = [
    await tsumu(),
    ...(await Promise.all(firstOfRole.map((entry, i) => resident(entry, i + 2, false, props)))),
  ];
  pair.forEach((object, i) => {
    if (!object) return;
    object.position.x = (i - (pair.length - 1) / 2) * 0.72;
    hero.add(object);
  });
  views.set('hero', hero);

  // Culture: each culture building with its own person in front, holding the culture's prop.
  const culture = new Group();
  culture.add(ground());
  const buildings = things.filter((t) => t.kind === 'culture');
  for (const [i, entry] of buildings.entries()) {
    const x = (i - (buildings.length - 1) / 2) * 5.2;
    culture.add(await placeAt(entry, x, -0.6, i + 1));
    const person = residents.find((r) => r.cultures?.some((c) => entry.cultures?.includes(c)));
    if (person) {
      const figure = await resident(person, i + 4, true, props);
      figure.position.set(x + 1.2, 0, 1.4);
      culture.add(figure);
    }
  }
  const cultureHero = await tsumu();
  if (cultureHero) {
    cultureHero.position.set(-1.4, 0, 1.6);
    culture.add(cultureHero);
  }
  views.set('culture', culture);

  views.set('mid', await rowView());
  views.set('near', await rowView());
  views.set('sil', await rowView());
  views.set('night', await rowView());

  // Far: a little plaza of 24 people with the street and harbour things, the planet-view size.
  const far = new Group();
  far.add(ground());
  const random = rng(7);
  for (let i = 0; i < 24; i++) {
    const entry = residents[i % residents.length];
    if (!entry) break;
    const person = await resident(entry, i * 5 + 1, random() < 0.5, props);
    person.position.set((random() - 0.5) * 22, 0, random() * 5.5 - 1.6);
    person.rotation.y = (random() - 0.5) * 2.4;
    far.add(person);
  }
  const farHero = await tsumu();
  if (farHero) {
    farHero.position.set(1, 0, 1.2);
    far.add(farHero);
  }
  // Culture buildings have their own view; scattered here they would bury the crowd being judged.
  const land = things.filter((t) => t.kind !== 'prop' && t.kind !== 'culture' && !waterSide(t));
  for (let i = 0; i < land.length * 3; i++)
    far.add(await placeAt(land[i % land.length], (random() - 0.5) * 28, random() < 0.5 ? -1.9 : 4.4, i));
  for (const [i, entry] of things.filter(waterSide).entries())
    far.add(await placeAt(entry, -6 + i * 7, entry.kind === 'ship' ? -6 : -3.2));
  views.set('far', far);

  // Props: every non-resident asset in a row at close range (hand props lifted to stand on the ground).
  const shelf = new Group();
  shelf.add(ground());
  let sx = 0;
  const items: Object3D[] = [];
  for (const [i, entry] of things.entries()) {
    if (waterSide(entry)) continue;
    const object = await prop(entry, i + 1);
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    object.position.set(sx + size.x / 2, -box.min.y, 0);
    sx += Math.max(size.x, 0.25) + 0.3;
    items.push(object);
    shelf.add(object);
  }
  for (const object of items) object.position.x -= sx / 2;
  const shelfHero = await tsumu();
  if (shelfHero) {
    shelfHero.position.set(-sx / 2 - 0.5, 0, 0);
    shelf.add(shelfHero);
  }
  for (const [i, entry] of things.filter(waterSide).entries())
    shelf.add(await placeAt(entry, -4 + i * 4, entry.kind === 'ship' ? -4.4 : -3.2));
  views.set('props', shelf);
}

const cameras: Record<View, { at: [number, number, number]; look: [number, number, number]; fov: number }> = {
  far: { at: [0, 48, 66], look: [0, 0, -1], fov: 30 },
  mid: { at: [0, 9, 20], look: [0, 0.4, 0], fov: 30 },
  sil: { at: [0, 9, 20], look: [0, 0.4, 0], fov: 30 },
  night: { at: [0, 9, 20], look: [0, 0.4, 0], fov: 30 },
  near: { at: [0, 0.75, 6.4], look: [0, 0.55, 0], fov: 30 },
  props: { at: [0, 4.2, 13.5], look: [0, 0.9, -1.2], fov: 34 },
  hero: { at: [0, 0.62, 4.6], look: [0, 0.5, 0], fov: 30 },
  culture: { at: [0, 7.5, 21], look: [0, 1.4, 0], fov: 34 },
};

const pointLights: PointLight[] = [];
const faces = new WeakMap<Mesh, Mesh['material']>();
function show(view: View) {
  for (const group of views.values()) scene.remove(group);
  for (const light of pointLights.splice(0)) scene.remove(light);
  const group = views.get(view)!;
  scene.add(group);
  cityInk.value = INK_BY_VIEW[view] ?? 1.8;
  const night = view === 'night';
  const sil = view === 'sil';
  scene.background = new Color(sil ? '#ffffff' : night ? '#1d2747' : palette.sky);
  sun.intensity = night ? 0.35 : 1.55;
  sun.color.set(night ? '#9fb4ff' : '#ffffff');
  ambient.intensity = night ? 0.32 : 0.9;
  ambient.color.set(night ? '#6d7fc4' : '#ffffff');
  hemi.intensity = night ? 0.15 : 0.35;
  rim.intensity = night ? 0.9 : 0;
  for (const material of lit) material.emissiveIntensity = night ? 0.03 : 0.13;
  for (const material of lights) material.emissiveIntensity = night ? 1.4 : 0.35;
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.ink) mesh.visible = !sil;
    else if (mesh.userData.face) {
      if (!faces.has(mesh)) faces.set(mesh, mesh.material);
      mesh.material = sil ? silhouette : faces.get(mesh)!;
    }
  });
  // In silhouette only the row of figures stays: ground and the town things behind are hidden.
  for (const [i, child] of group.children.entries()) if (i !== 1) child.visible = !sil;
  if (night) {
    group.updateWorldMatrix(true, true);
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || mesh.userData.ink) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((m) => lights.has(m as MeshToonMaterial)) && pointLights.length < 12) {
        const light = new PointLight('#ffc978', 0.9, 2.4, 2);
        mesh.getWorldPosition(light.position);
        light.position.y += 0.1;
        pointLights.push(light);
        scene.add(light);
      }
    });
  }
  const c = cameras[view];
  camera.fov = c.fov;
  camera.position.set(...c.at);
  camera.lookAt(new Vector3(...c.look));
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return new Promise<void>((done) => requestAnimationFrame(() => done()));
}

declare global {
  interface Window {
    lineup: { ready: Promise<void>; show: (view: View) => Promise<void>; manifest: () => Entry[] };
  }
}
const ready = buildViews().then(() => new Promise<void>((done) => setTimeout(done, 300)));
window.lineup = { ready, show, manifest: () => manifest };
void ready.then(() => show((params.get('view') as View) ?? 'mid'));
