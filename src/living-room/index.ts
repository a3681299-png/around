// The living room on its own page: the baked room (scripts/living-room) drawn with three.js.
// No extension, no artwork runtime. The room's light is baked (a texture for the big surfaces,
// vertex colours for the rest), so the page draws only when something changes.
import {
  ACESFilmicToneMapping,
  Color,
  Raycaster,
  LoadingManager,
  MeshBasicMaterial,
  HemisphereLight,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { readLayout } from '../renderers/three/room-layout';
import { floorPath, standPoint, walkable } from '../world/room-life';
import { loadLivingResident, type LivingResident } from './resident';
import { softSurface } from './soft-surface';
import { screenGlow, type GlowKind } from './screen-glow';
import { startRoomDesktop } from './desktop';

declare const __WW_LIVING_TEST__: boolean;
declare const __WW_LIVING_CHARACTER__: boolean;

interface RoomManifest {
  bakedColor?: boolean;
  lightScale: number;
  lightmap: string;
  lightmapMesh: string;
  /** Models that keep their own colour texture; their vertex colours hold baked light only. */
  texturedMesh?: string;
  /** Lamps baked on their own, tinted at run time: a lightmap each (and vertex attributes). */
  layers?: { ui?: string; screen?: string };
  camera: string;
  aspect: number;
}

/** What the camera looks at (the middle of the room, a little above the floor), in the room's metres. */
const SUBJECT = new Vector3(-0.05, 0.85, -0.35);
const BACKGROUND = 0x0b1835;

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#room')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const base = new URL('content/', document.baseURI);
  const manifest = (await (await fetch(new URL('room.json', base), { credentials: 'omit' })).json()) as RoomManifest;
  if (!(manifest.lightScale > 0 && manifest.lightScale <= 64)) throw new Error('部屋の光の倍率が範囲外です。');

  // The room is one self-contained file: refuse anything it would fetch from elsewhere.
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith(base.href)) return url;
    throw new Error('部屋の素材が外部の資源を参照しています。');
  });
  const image = (name: string | undefined) => {
    if (!name) return undefined;
    if (!/^[\w.-]{1,60}\.png$/.test(name)) throw new Error('部屋の光の画像の名前が正しくありません。');
    return new TextureLoader(manager).loadAsync(new URL(name, base).href);
  };
  const [gltf, lightmap, layerUi, layerScreen] = await Promise.all([
    new GLTFLoader(manager).loadAsync(new URL('room.glb', base).href),
    new TextureLoader(manager).loadAsync(new URL(manifest.lightmap, base).href),
    // Light baked on its own and tinted at run time (docs/living-desktop.md). Older rooms have none.
    image(manifest.layers?.ui),
    image(manifest.layers?.screen),
  ]);
  for (const texture of [lightmap, layerUi, layerScreen]) {
    if (!texture) continue;
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
  }

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.8;
  lightmap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  scene.add(gltf.scene);

  // New rooms bake colour and light together; older manifests still multiply their base colour.
  // Light sources keep their own colour (above 1, so they bloom).
  const made = new Map<string, MeshBasicMaterial>();
  const unlit = (source: MeshStandardMaterial, lit: boolean, baked: boolean, map: Texture | null, textured = false) => {
    const key = `${source.uuid}:${lit}:${baked}:${map ? 1 : 0}:${textured}`;
    let material = made.get(key);
    if (!material) {
      const glow = source.emissive.r + source.emissive.g + source.emissive.b > 0 && source.emissiveIntensity > 0;
      // Textured models: their own colour texture times the baked light in the vertex colours,
      // which is stored divided by lightScale like the rest of the room.
      const color = textured
        ? new Color(0xffffff).multiplyScalar(manifest.lightScale)
        : glow
          ? source.emissive.clone().multiplyScalar(source.emissiveIntensity * 0.55)
          : (baked && manifest.bakedColor ? new Color(0xffffff) : source.color.clone()).multiplyScalar(
              baked ? manifest.lightScale : 1,
            );
      // Thin window panes and curtains keep the sidedness authored in the room file.
      const artwork = textured
        ? source.map
        : (map ?? (baked ? null : glow ? (source.emissiveMap ?? source.map) : source.map));
      material = new MeshBasicMaterial({ color, map: artwork, vertexColors: lit, side: source.side });
      made.set(key, material);
    }
    return material;
  };
  const soft: Mesh[] = [];
  const kinds = new Map<MeshBasicMaterial, GlowKind>();
  gltf.scene.traverse((object) => {
    if (/^(navmesh_|marker_|occluder_|shadow_)/.test(object.name)) {
      object.visible = false;
      return;
    }
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name.startsWith('pbr_')) return;
    // A multi-material mesh arrives as several meshes whose names start with the object's name.
    const map = mesh.name.startsWith(manifest.lightmapMesh) ? lightmap : null;
    const source = mesh.material as MeshStandardMaterial;
    // The room's soft things (by the material's name in the room file) give under a body.
    if (/^(duvet|sheet|throw|pillow|beanbag|rug_|floor_shade)/.test(source.name)) soft.push(mesh);
    const textured = !!manifest.texturedMesh && mesh.name.startsWith(manifest.texturedMesh);
    const material = unlit(source, mesh.geometry.hasAttribute('color'), mesh.name.startsWith('static_'), map, textured);
    mesh.material = material;
    // How this material carries the room's baked light layers (screen-glow.ts).
    const layered = mesh.geometry.hasAttribute('_ui') && mesh.geometry.hasAttribute('_screen');
    kinds.set(material, map ? 'lightmap' : textured && layered ? 'textured' : layered ? 'vertex' : 'plain');
  });
  // The actual baked room supplies reflections in the small glass and metal objects. This is
  // captured once, so the room's still frame and its ordinary animation loop stay inexpensive.
  const reflective: Mesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.name.startsWith('pbr_')) {
      reflective.push(mesh);
      mesh.visible = false;
    }
  });
  if (reflective.length) {
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(scene, 0.08, 0.1, 30, { size: 128, position: new Vector3(0, 1.5, 0) }).texture;
    pmrem.dispose();
    scene.add(new HemisphereLight(0xc5dce0, 0x7c6045, 0.8));
    for (const mesh of reflective) mesh.visible = true;
  }
  const layout = readLayout(gltf.scene);
  // A character only where the build was given one (a local folder, never a public build).
  let resident: LivingResident | undefined;
  // Light that changes at run time: the baked layers (the desktop's glow, the monitor) and small
  // screens (the resident's phone).
  const glow = screenGlow(
    kinds,
    { ...(layerUi ? { ui: layerUi } : {}), ...(layerScreen ? { screen: layerScreen } : {}) },
    manifest.lightScale,
  );
  if (__WW_LIVING_CHARACTER__)
    resident = await loadLivingResident(scene, base, layout, softSurface(soft), { root: gltf.scene, glow });

  const authored = gltf.cameras.find((c) => c.name === manifest.camera || c.parent?.name === manifest.camera) as
    PerspectiveCamera | undefined;
  if (!authored) throw new Error('部屋のカメラがありません。');
  authored.updateWorldMatrix(true, false);
  const home = authored.getWorldPosition(new Vector3());
  const camera = new PerspectiveCamera(authored.fov, manifest.aspect, 0.1, 80);
  const authoredTan = Math.tan((authored.fov * Math.PI) / 360);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.13, 0.55, 1.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const aim = new Vector2();
  const look = new Vector2();
  const offset = new Vector3();
  const subject = new Vector3();
  const reviewSubject = SUBJECT.clone();
  let reviewDistance = 1,
    reviewTurn = 0;
  let closeUp = 0;
  let frameRate = 0;
  let frame: number | undefined;
  let last = 0;
  let draws = 0;
  function resize() {
    const width = window.innerWidth,
      height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(width, height);
    camera.aspect = width / height;
    // Wider than authored: keep the height. Narrower: keep the width, so the room is never cut.
    const tan = camera.aspect >= manifest.aspect ? authoredTan : (authoredTan * manifest.aspect) / camera.aspect;
    camera.fov = (Math.atan(tan) * 360) / Math.PI;
    camera.updateProjectionMatrix();
    wake();
  }
  // The virtual desktop: glass windows over the room, the same desktop on the room's monitor, and
  // its colour in the room's light (docs/living-desktop.md).
  const desktop = startRoomDesktop({
    host: document.body,
    scene,
    room: gltf.scene,
    camera,
    glow,
    floorY: layout.floorY,
    resident,
    wake: () => wake(),
  });
  const timing = { frames: 0, interval: 0, worstInterval: 0, body: 0, draw: 0 };
  function tick(now: number) {
    frame = undefined;
    // For checking the motion at a slower display (the test hook): frames that come sooner than
    // the asked rate are passed over, as a 30 or 60 Hz screen would not have shown them.
    if (__WW_LIVING_TEST__ && frameRate && last && now - last < 1000 / frameRate - 1) {
      wake();
      return;
    }
    // A mirrored screen is the only thing moving (no resident, the view at rest): thirty frames a
    // second are plenty for a picture that comes at fifteen.
    if (!resident && desktop.mirroring && last && now - last < 32 && look.distanceToSquared(aim) < 1e-6) {
      wake();
      return;
    }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    // (With the desktop open the room holds still: the pointer is working the windows, and the
    // resident comes to a place on a window that must not drift under its hand.)
    look.lerp(reduce.matches || desktop.open ? aim.set(0, 0) : aim, 1 - Math.exp(-dt * 5));
    // A small orbit about the subject follows the pointer: depth without leaving the composition.
    offset.copy(home).sub(SUBJECT);
    if (__WW_LIVING_TEST__) offset.multiplyScalar(reviewDistance).applyAxisAngle(new Vector3(0, 1, 0), reviewTurn);
    offset.applyAxisAngle(new Vector3(0, 1, 0), -look.x * 0.05);
    offset.y += look.y * 0.25;
    camera.position.copy(reviewSubject).add(offset);
    camera.lookAt(reviewSubject);
    if (closeUp && resident) {
      // For the motion review only (the test hook): the same angle, near the character.
      const at = resident.state().mover;
      subject.set(at.x, layout.floorY + 0.6, at.z);
      camera.position.copy(subject).addScaledVector(offset, closeUp);
      camera.lookAt(subject);
    }
    camera.updateMatrixWorld();
    const began = __WW_LIVING_TEST__ ? performance.now() : 0;
    desktop.update(dt, now);
    resident?.update(dt, camera);
    const posed = __WW_LIVING_TEST__ ? performance.now() : 0;
    composer.render();
    draws++;
    if (__WW_LIVING_TEST__ && dt > 0) {
      // For the load measurement (the test hook): the frame's interval, the body's and the draw's
      // time on the main thread.
      timing.frames++;
      timing.interval += dt * 1000;
      timing.worstInterval = Math.max(timing.worstInterval, dt * 1000);
      timing.body += posed - began;
      timing.draw += performance.now() - posed;
    }
    // A living character breathes and blinks: with one, every frame is drawn while the page shows.
    // Without one, only while the view or the desktop's light is still moving.
    if (resident ? !document.hidden : look.distanceToSquared(aim) > 1e-6 || (desktop.busy && !document.hidden)) wake();
    else last = 0;
  }
  function wake() {
    if (frame === undefined) frame = requestAnimationFrame(tick);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (event) => {
    aim.set((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
    wake();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });
  if (resident) {
    // For trying the approach by hand: Alt and a click puts a thing to notice on the surface
    // under the pointer (with Shift it is met eagerly); a click on the thing itself answers the
    // character's touch; Escape takes it away. (The desktop's windows are what it comes to now.)
    const ray = new Raycaster();
    const live = resident;
    canvas.addEventListener('click', (event) => {
      if (!event.altKey && !live.state().target) return;
      ray.setFromCamera(
        new Vector2((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2),
        camera,
      );
      const hit = ray.intersectObject(gltf.scene, true).find((h) => h.object.visible);
      if (!hit) return;
      // A little off the surface, toward the viewer, so the hand has something in front of it.
      const p = hit.point.addScaledVector(ray.ray.direction, -0.04);
      const now = live.state().target;
      if (now && ray.ray.distanceToPoint(new Vector3(now[0], now[1], now[2])) < 0.12) {
        live.cheer();
        return;
      }
      live.setMood(event.shiftKey ? 'interest' : 'calm');
      live.setTarget([p.x, p.y, p.z]);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') live.setTarget(undefined);
    });
  }
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    status.textContent = '描画が止まりました。ページを再読み込みしてください。';
  });
  resize();
  // The first frame is drawn now; `resize` has already asked for one, and two requests would run
  // two loops side by side for as long as the page draws (every frame done twice).
  if (frame !== undefined) cancelAnimationFrame(frame);
  tick(performance.now());
  canvas.toggleAttribute('data-ready', true);
  status.textContent = '';
  if (__WW_LIVING_TEST__)
    Object.assign(globalThis, {
      __wwLivingRoom: {
        layout,
        // Every place must be on the walkable floor and reachable on foot from the first standing
        // place: the same functions the room's resident uses (src/world/room-life.ts).
        reach: () => {
          const from = layout.spots.find((spot) => spot.kind === 'stand');
          const start = from ? standPoint(layout, from) : ([0, 0] as [number, number]);
          return layout.spots.map((spot) => {
            const at = standPoint(layout, spot);
            return {
              id: spot.id,
              walkable: walkable(layout, at[0], at[1]),
              reachable: spot === from || floorPath(layout, start, at).length > 0,
            };
          });
        },
        draws: () => draws,
        /** The load since the last call: frames, and milliseconds a frame (interval, body, draw). */
        timing: () => {
          const n = Math.max(1, timing.frames);
          const out = {
            frames: timing.frames,
            intervalMs: timing.interval / n,
            worstIntervalMs: timing.worstInterval,
            bodyMs: timing.body / n,
            drawMs: timing.draw / n,
          };
          timing.frames = timing.interval = timing.worstInterval = timing.body = timing.draw = 0;
          return out;
        },
        resident,
        /** The virtual desktop's state (docs/living-desktop.md). */
        desktop: () => desktop.state(),
        /** Fixed close views of the furniture for the browser art review. */
        reviewCamera: (target: [number, number, number], scale: number, turn = 0) => {
          reviewSubject.fromArray(target);
          reviewDistance = Math.min(1, Math.max(0.08, scale));
          // (Round the subject by this much, radians: a side view of what the room's camera sees.)
          reviewTurn = turn;
          wake();
        },
        /** Draws at most this many frames a second (0: every frame the display gives). */
        frameRate: (rate: number) => {
          frameRate = Math.max(0, rate);
        },
        /** 0 = the room's own camera; 0.3–0.6 = that fraction of its distance, on the character. */
        closeUp: (scale: number) => {
          closeUp = Math.min(1, Math.max(0, scale));
          wake();
        },
        triangles: () => renderer.info.render.triangles,
        still: () => {
          aim.set(0, 0);
          look.set(0, 0);
          wake();
        },
      },
    });
}

void start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) status.textContent = error instanceof Error ? error.message : '読み込めませんでした。';
  console.error('[Living Room]', error);
});
