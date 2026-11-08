/**
 * The room behind the UI and the glass plates in front of it (docs/depth-foundation.md). One
 * canvas under the page's content: the room is drawn with its baked light layers, then one pass
 * draws the plates over it (frosted blur, edge refraction, a rim highlight, a tint picked from
 * the room, the readability density) and the plates' shadow and the video's glow on the room.
 *
 * Everything drawn is a fixed engine effect; the artwork only gives numbers (RoomLook). The room
 * comes from a verified model asset: its light layers are textures the .glb lists in its root
 * extras (`wwtRoom`, scripts/room/pack-room.mjs), checked here before use.
 *
 * Nothing here reads the page: the Host passes the plates, the camera and the video's light.
 */
import {
  AmbientLight,
  Camera,
  Color,
  DirectionalLight,
  Quaternion,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  LinearSRGBColorSpace,
  type Object3D,
  type Material,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { parseVerifiedModelSource, type VerifiedModelSource } from '../../assets/verified-source';
import {
  PLATE_LIMIT,
  PLATE_TEXT,
  plateLimit,
  type CameraProjection,
  type ColorScheme,
  type GlassPlate,
  type VideoLight,
} from '../../world/space';
import { ROOM_LIGHT_LAYER, type RoomLook } from '../../design/space';
import { SPACE_BREAK } from '../../host/world-options';
import type { RoomLayout, RoomSpot } from '../../world/room-life';
import type { RoomResident } from './room-resident';

/**
 * The room's layout from the asset contract (部屋の素材の約束): marker_sit_/marker_hide_/
 * marker_stand_ empties (position; the arrow, the empty's +Z, gives the way the character faces)
 * and the navmesh_floor mesh (its triangles, flattened onto the floor). Numbers only leave here.
 */
function readLayout(root: Object3D): RoomLayout {
  root.updateWorldMatrix(true, true);
  const spots: RoomSpot[] = [];
  const floor: number[][] = [];
  let floorY = 0,
    heights = 0;
  const p = new Vector3(),
    forward = new Vector3();
  root.traverse((o) => {
    const marker = /^marker_(sit|hide|stand)_([a-z0-9_]{1,32})$/.exec(o.name);
    if (marker && spots.length < 32) {
      o.getWorldPosition(p);
      forward.set(0, 0, 1).transformDirection(o.matrixWorld);
      const heading = Math.hypot(forward.x, forward.z) > 0.2 ? Math.atan2(forward.x, forward.z) : 0;
      if ([p.x, p.y, p.z, heading].every(Number.isFinite))
        spots.push({
          id: `${marker[1]}_${marker[2]}`,
          kind: marker[1] as RoomSpot['kind'],
          x: p.x,
          y: p.y,
          z: p.z,
          heading,
        });
      return;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.name !== 'navmesh_floor') return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count && floor.length < 4096; i += 3) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
        tri.push(p.x, p.z);
        floorY += p.y;
        heights++;
      }
      if (tri.every(Number.isFinite)) floor.push(tri);
    }
  });
  return { floorY: heights ? floorY / heights : 0, floor, spots };
}

/** Light layers a room may carry (the asset contract, 部屋の素材の約束). More are ignored. */
const LAYER_LIMIT = 8;
/** The least plate opacity by importance: a plate is seen as glass even over a dark room. */
const PLATE_FLOOR = { operate: 0.32, read: 0.2 } as const;
/** The room is drawn at the canvas's own size: between the small plates it is seen sharp. */
const ROOM_SCALE = 1;
/** camera_main's distance to the room's middle (the dolly zoom's subject), docs/room-bake-plan.md. */
export const ROOM_SUBJECT_M = 3.2;

export interface RoomFrame {
  camera: CameraProjection;
  plates: readonly GlassPlate[];
  scheme: ColorScheme;
  /** Linear RGB of the video's light (already slew-limited by the world). */
  video: VideoLight;
  /** The resident's palm marks on the glass (canvas px, 0–1 strength), at most MARK_LIMIT. */
  marks?: readonly { x: number; y: number; size: number; strength: number }[];
}
const MARK_LIMIT = 4;
export interface RoomRenderer {
  readonly canvas: HTMLCanvasElement;
  /** The room's base view: camera_main's vertical field of view. */
  readonly baseFovDeg: number;
  /** The room's own layout (its markers and walkable floor, the asset contract), as numbers. */
  readonly layout: RoomLayout;
  resize(width: number, height: number): void;
  draw(frame: RoomFrame, look: RoomLook): void;
  /** Puts the living character into the room's scene once its programs are ready (undefined
   * takes it out; it is not disposed here). */
  setResident(resident: RoomResident | undefined): Promise<void>;
  /** Room points (metres) to canvas pixels with the last drawn camera; null behind the camera. */
  project(points: readonly { x: number; y: number; z: number }[]): ({ x: number; y: number } | null)[];
  /** 0–1: dims the room (a reduced-motion cut between camera shapes). */
  dim(amount: number): void;
  /** Fades the canvas in (after the first draw); resolves when it is fully shown. */
  reveal(): Promise<void>;
  /** For tests: the drawn colour (sRGB bytes) at canvas pixels, read right after a draw. */
  readPixels: ((points: readonly { x: number; y: number }[]) => number[][]) | undefined;
  destroy(): void;
}

interface LightLayer {
  name: string;
  texture: Texture;
  scale: number;
}
/** The room's own list of light layers, checked: the names follow the asset contract, the
 * textures exist, the scales are finite. Anything else and the room is refused. */
async function lightLayers(gltf: GLTF): Promise<LightLayer[]> {
  const extras = (gltf.parser.json as { extras?: { wwtRoom?: unknown } }).extras?.wwtRoom as
    { version?: unknown; layers?: unknown } | undefined;
  if (!extras || extras.version !== 1 || !Array.isArray(extras.layers) || !extras.layers.length)
    throw new Error('部屋の素材に光の層がありません。');
  const textures = (gltf.parser.json as { textures?: unknown[] }).textures?.length ?? 0;
  const out: LightLayer[] = [];
  for (const value of extras.layers.slice(0, LAYER_LIMIT)) {
    const entry = value as { name?: unknown; texture?: unknown; scale?: unknown };
    if (
      typeof entry.name !== 'string' ||
      !ROOM_LIGHT_LAYER.test(entry.name) ||
      !Number.isInteger(entry.texture) ||
      (entry.texture as number) < 0 ||
      (entry.texture as number) >= textures ||
      typeof entry.scale !== 'number' ||
      !Number.isFinite(entry.scale) ||
      entry.scale <= 0 ||
      entry.scale > 1e4
    )
      throw new Error('部屋の素材の光の層が不正です。');
    const texture = (await gltf.parser.getDependency('texture', entry.texture as number)) as Texture;
    // Data, not colour: the layer's 8 bits are sqrt(light / scale), decoded in the mix.
    texture.colorSpace = '';
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    out.push({ name: entry.name, texture, scale: entry.scale });
  }
  return out;
}

const QUAD_VERTEX = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

function mixShader(count: number) {
  const lines = Array.from({ length: count }, (_, i) => i);
  return new ShaderMaterial({
    uniforms: Object.fromEntries([
      ...lines.map((i) => [`t${i}`, { value: null }]),
      ...lines.map((i) => [`w${i}`, { value: new Vector3() }]),
    ]),
    vertexShader: QUAD_VERTEX,
    fragmentShader: `varying vec2 vUv;
      ${lines.map((i) => `uniform sampler2D t${i}; uniform vec3 w${i};`).join('\n')}
      void main(){ vec3 c = vec3(0.);
      ${lines.map((i) => `{ vec3 s = texture2D(t${i}, vUv).rgb; c += s * s * w${i}; }`).join('\n')}
      gl_FragColor = vec4(c, 1.); }`,
    depthTest: false,
    depthWrite: false,
  });
}

/** The plate pass. Plates are rounded boxes evaluated per pixel (at most PLATE_LIMIT). */
function compositeShader() {
  return new ShaderMaterial({
    uniforms: {
      tRoom: { value: null },
      resolution: { value: new Vector2(1, 1) },
      plates: { value: Array.from({ length: PLATE_LIMIT }, () => new Vector4()) },
      plateInfo: { value: Array.from({ length: PLATE_LIMIT }, () => new Vector4()) },
      plateCount: { value: 0 },
      dark: { value: 1 },
      limit: { value: 0 },
      baseColor: { value: new Color() },
      glass: { value: new Vector4() },
      shadowAmount: { value: 0 },
      videoColor: { value: new Color() },
      lampColor: { value: new Color(1, 0.62, 0.34) },
      lightDir: { value: new Vector2(-0.45, -0.9) },
      toneMappingExposure: { value: 1 },
      marks: { value: Array.from({ length: MARK_LIMIT }, () => new Vector4()) },
      markCount: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: `
      #define PLATES ${PLATE_LIMIT}
      #include <common>
      #include <tonemapping_pars_fragment>
      varying vec2 vUv;
      uniform sampler2D tRoom;
      uniform vec2 resolution;
      uniform vec4 plates[PLATES];   // left, top, right, bottom in canvas pixels (top-left origin)
      uniform vec4 plateInfo[PLATES]; // floor opacity, video, -, -
      uniform int plateCount;
      uniform float dark, limit, shadowAmount;
      uniform vec3 baseColor, videoColor, lampColor;
      uniform vec4 glass; // blur, refraction, highlight, tint
      uniform vec2 lightDir;
      #define MARKS ${MARK_LIMIT}
      uniform vec4 marks[MARKS]; // x, y (canvas px, top-left), -, strength
      uniform int markCount;
      // A palm pressed on the glass from behind: the palm and four fingertips, misted.
      float palm(vec2 p, vec2 c) {
        vec2 q = p - c;
        float m = exp(-dot(q / vec2(15.0, 18.0), q / vec2(15.0, 18.0)));
        for (int k = 0; k < 4; k++) {
          vec2 f = q - vec2(-13.5 + 9.0 * float(k), -22.0 - (k == 1 || k == 2 ? 6.0 : 0.0));
          m = max(m, exp(-dot(f / vec2(3.6, 8.0), f / vec2(3.6, 8.0))));
        }
        // The breath's mist around it, fainter and wider.
        return max(m, 0.35 * exp(-dot(q / 34.0, q / 34.0)));
      }
      const float RADIUS = 10.0;
      float box(vec2 p, vec4 r) {
        vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5 - RADIUS;
        vec2 q = abs(p - c) - h;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - RADIUS;
      }
      vec3 room(vec2 uv, float lod) { return AgXToneMapping(textureLod(tRoom, uv, lod).rgb); }
      // A frosted look from the room's mip chain: nine taps at a blurred level.
      vec3 frosted(vec2 uv, float lod) {
        vec2 o = exp2(lod) / resolution * 0.75;
        vec3 c = room(uv, lod) * 0.25;
        c += (room(uv + vec2(o.x, 0.), lod) + room(uv - vec2(o.x, 0.), lod) + room(uv + vec2(0., o.y), lod) + room(uv - vec2(0., o.y), lod)) * 0.125;
        c += (room(uv + o, lod) + room(uv - o, lod) + room(uv + vec2(o.x, -o.y), lod) + room(uv + vec2(-o.x, o.y), lod)) * 0.0625;
        return c;
      }
      float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec2 p = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
        vec2 uv = gl_FragCoord.xy / resolution;
        float inside = 1e9; int at = -1;
        float shade = 0.0; float glow = 0.0; float glint = 0.0;
        vec2 shadowOffset = -lightDir * vec2(18.0, 26.0);
        for (int i = 0; i < PLATES; i++) {
          if (i >= plateCount) break;
          vec4 r = plates[i];
          if (plateInfo[i].y > 0.5) glow = max(glow, exp(-max(box(p, r), 0.0) / 260.0));
          // Many small plates: one far from this pixel (beyond its shadow's reach) costs four compares.
          if (p.x < r.x - 72.0 || p.x > r.z + 72.0 || p.y < r.y - 72.0 || p.y > r.w + 72.0) continue;
          float d = box(p, r);
          if (d < inside) { inside = d; at = i; }
          // The plate's shadow on the room: the plate seen from the light, offset and softened.
          shade = max(shade, 1.0 - smoothstep(-16.0, 28.0, box(p - shadowOffset, r)));
          // The light the glass bends at its edge falls just past the shadow's far side: a thin,
          // warm line (a caustic), the plate's light on the room.
          glint = max(glint, exp(-abs(box(p - shadowOffset * 1.25, r) - 4.0) / 3.0));
        }
        vec3 back = room(uv, 0.0);
        // The plates darken the room behind them, and the video lights the room around itself.
        back *= 1.0 - shade * shadowAmount;
        back += lampColor * glint * (1.0 - shade) * shadowAmount * 0.35;
        // The resident's palm marks on the glass between it and the viewer: misted, only in the
        // clear (outside every sheet: the Host places them away from text, and the sheets below
        // draw over them), fading as the Host says.
        float mist = 0.0;
        for (int k = 0; k < MARKS; k++) {
          if (k >= markCount) break;
          mist = max(mist, palm((p - marks[k].xy) / marks[k].z + marks[k].xy, marks[k].xy) * marks[k].w);
        }
        back = mix(back, vec3(0.62, 0.66, 0.72), mist * 0.45);
        back += videoColor * glow * 0.45 * (1.0 - shade * shadowAmount * 0.5);
        if (at < 0 || inside >= 0.0 || plateInfo[at].y > 0.5) {
          // Outside every plate, or under the video (the player covers it).
          gl_FragColor = vec4(srgb(clamp(back, 0.0, 1.0)), 1.0);
          return;
        }
        float e = -inside; // pixels inside the plate's edge
        // The outward normal from the box's gradient.
        vec2 n = normalize(vec2(box(p + vec2(1., 0.), plates[at]) - box(p - vec2(1., 0.), plates[at]),
                                box(p + vec2(0., 1.), plates[at]) - box(p - vec2(0., 1.), plates[at])) + 1e-6);
        // Refraction at the edge only: the room behind bends within 10 px of the edge (inside the
        // plate's 8 px margin around the text, mostly); the middle, where the text is, is still.
        float band = 1.0 - clamp(e / 10.0, 0.0, 1.0);
        vec2 bend = n * glass.y * 12.0 * band * band;
        vec2 suv = (p - bend) / resolution;
        suv.y = 1.0 - suv.y;
        float lod = mix(1.0, 5.0, glass.x);
        vec3 c = frosted(suv, lod) * (1.0 - shade * shadowAmount * 0.6);
        // A thin rim catches the lamp and the video's light from the light's side (3 px).
        float rim = pow(1.0 - clamp(e / 3.0, 0.0, 1.0), 2.0) * glass.z;
        float facing = 0.35 + 0.65 * max(0.0, dot(n, -normalize(lightDir)));
        c += rim * facing * (lampColor * 0.55 + videoColor * 0.8);
        // The plate's own colour: the scheme's base with a little of the room's colour behind it.
        vec3 avg = room(uv, 7.0);
        vec3 base = mix(baseColor, avg / max(0.02, max(avg.r, max(avg.g, avg.b))) * lum(baseColor) * 1.6 + baseColor * 0.4, glass.w * 0.5);
        float lb = lum(base);
        // Keep the base itself readable (the tint never pushes it past the limit).
        if (dark > 0.5 && lb > limit * 0.5) base *= limit * 0.5 / lb;
        if (dark < 0.5 && lb < limit + 0.1) base = mix(base, vec3(1.0), clamp((limit + 0.1 - lb) / max(1e-3, 1.0 - lb), 0.0, 1.0));
        lb = lum(base);
        // The density rule (world/space.ts plateAlpha), per pixel over what this pixel shows.
        float l = lum(c);
        float need = dark > 0.5
          ? (l > limit ? (l - limit) / max(1e-6, l - lb) : 0.0)
          : (l < limit ? (limit - l) / max(1e-6, lb - l) : 0.0);
        float a = clamp(max(need, plateInfo[at].x), 0.0, 1.0);
        // Antialias the plate's outline over one pixel (the edge is outside the padded region).
        float cover = clamp(e, 0.0, 1.0);
        vec3 plate = mix(c, base, a);
        gl_FragColor = vec4(srgb(clamp(mix(back, plate, cover), 0.0, 1.0)), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

const disposeObject = (root: Object3D) =>
  root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const materials = (
      Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    ) as Material[];
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof Texture) value.dispose();
      m.dispose();
    }
  });

/** How long the room fades in once it is ready. */
const REVEAL_MS = 700;
const UP = new Vector3(0, 1, 0);

/**
 * Waits for a quiet moment of the page (an idle callback; `timeoutMs` at the latest), so the
 * room's preparation runs in small steps between the page's own work. The room only needs to be
 * glimpsed: it never has to be ready for the page's first paint. Throws once `signal` aborts.
 */
function quiet(view: Window, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => (signal?.aborted ? reject(new DOMException('aborted', 'AbortError')) : resolve());
    if (typeof view.requestIdleCallback === 'function') view.requestIdleCallback(done, { timeout: timeoutMs });
    else view.setTimeout(done, 16);
  });
}

export async function createRoomRenderer(
  doc: Document,
  slot: { parent: HTMLElement; zIndex: number },
  source: VerifiedModelSource,
  options: { readback?: boolean; signal?: AbortSignal } = {},
): Promise<RoomRenderer> {
  const view = doc.defaultView!,
    signal = options.signal;
  // The startup CPU profile (docs/depth-foundation.md, 11節) had the room's first draw as one
  // 50–70 ms task: the textures' upload and the shader programs' link, all at once, during the
  // page's own startup. The room now waits for the page to settle, then prepares one piece per
  // idle moment (parse, each texture, the programs in parallel), and fades in when ready.
  if (doc.readyState !== 'complete')
    await new Promise<void>((resolve) => view.addEventListener('load', () => resolve(), { once: true }));
  await quiet(view, 3000, signal);
  const canvas = doc.createElement('canvas');
  canvas.dataset['wwRoom'] = '';
  canvas.setAttribute('aria-hidden', 'true');
  // Under the content (the adapter's backdrop slot): it takes no input and covers nothing. It
  // starts transparent and fades in (reveal) over the page's own background colour.
  canvas.style.cssText = `position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:${slot.zIndex}!important;display:block!important;margin:0!important;border:0!important;padding:0!important;opacity:0!important;transition:opacity ${REVEAL_MS}ms ease-out!important`;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    // The room shares the GPU with the video: the integrated GPU is the one the video decodes on.
    powerPreference: 'low-power',
    preserveDrawingBuffer: Boolean(options.readback),
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.autoClear = true;
  let destroyed = false;
  const loader = new GLTFLoader();
  let gltf: GLTF;
  try {
    // The context's creation alone took ~30 ms in the profile: the parse waits for the next quiet moment.
    await quiet(view, 1000, signal);
    gltf = await parseVerifiedModelSource(source, loader);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  const layers = await quiet(view, 1000, signal)
    .then(() => lightLayers(gltf))
    .catch((error) => {
      disposeObject(gltf.scene);
      renderer.dispose();
      throw error;
    });
  const size = (layers[0]!.texture.image as { width?: number } | undefined)?.width ?? 1024;
  const mixTarget = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  mixTarget.texture.channel = 1;
  const mix = mixShader(layers.length);
  layers.forEach((l, i) => (mix.uniforms[`t${i}`]!.value = l.texture));
  const quad = new Mesh(new PlaneGeometry(2, 2), mix);
  const quadScene = new Scene().add(quad);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const scene = new Scene();
  scene.background = new Color(0x050508);
  scene.add(gltf.scene);
  const layout = readLayout(gltf.scene);
  // The room is baked (unlit materials); these lights reach only the living character. A soft
  // fill and a warm key from above the camera, near the lamps' colour; the video's colour is added
  // to the fill each draw (the screen's light on the character, as on the room).
  const fill = new AmbientLight(0xffffff, 1.1);
  const key = new DirectionalLight(0xffe2c4, 1.4);
  key.position.set(0.6, 3, 2);
  scene.add(fill, key, key.target);
  let monitor: MeshBasicMaterial | undefined;
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // navmesh_, occluder_, shadow_ and marker_ are for the characters (the next chunk): not drawn.
    if (/^(navmesh_|occluder_|marker_|shadow_)/.test(mesh.name)) {
      mesh.visible = false;
      return;
    }
    const source = mesh.material as MeshBasicMaterial;
    if (mesh.name === 'dyn_monitor_screen') {
      monitor = new MeshBasicMaterial({ color: 0x000000 });
      mesh.material = monitor;
    } else if (mesh.name.startsWith('dyn_'))
      // A dyn_ object is not baked: its own colour (the window's sky).
      mesh.material = new MeshBasicMaterial({ color: source.color, map: source.map ?? null });
    // Flat colour times the mixed baked light: the anime-background paint (no real-time light).
    else
      mesh.material = new MeshBasicMaterial({
        color: source.color,
        map: source.map ?? null,
        lightMap: mixTarget.texture,
      });
    (source as Material).dispose();
  });
  const cameraNode = gltf.cameras[0] as PerspectiveCamera | undefined;
  if (!cameraNode) {
    disposeObject(gltf.scene);
    renderer.dispose();
    throw new Error('部屋の素材に camera_main がありません。');
  }
  cameraNode.updateWorldMatrix(true, false);
  const camera = new PerspectiveCamera(cameraNode.fov, 16 / 9, 0.05, 60);
  const base = new Camera();
  cameraNode.matrixWorld.decompose(base.position, base.quaternion, base.scale);
  const axes = {
    right: new Vector3(1, 0, 0).applyQuaternion(base.quaternion),
    up: new Vector3(0, 1, 0).applyQuaternion(base.quaternion),
    back: new Vector3(0, 0, 1).applyQuaternion(base.quaternion),
  };
  let roomTarget: WebGLRenderTarget | undefined;
  const composite = compositeShader();
  const compositeScene = new Scene().add(new Mesh(new PlaneGeometry(2, 2), composite));
  let width = 1,
    height = 1;
  let mixed = '';
  const remix = (look: RoomLook, video: VideoLight) => {
    // Weights per layer; the screen layers take the video's colour (the room's monitor and the
    // light the player throws into the room).
    const weights = layers.map((l) => {
      const w = look.lights[l.name] ?? 0;
      return l.name === 'screen' || l.name === 'screen_monitor'
        ? new Vector3(video.r, video.g, video.b).multiplyScalar(w * look.videoLight * l.scale * 2)
        : new Vector3(w * l.scale, w * l.scale, w * l.scale);
    });
    const key = weights
      .map((w) =>
        w
          .toArray()
          .map((n) => n.toFixed(4))
          .join(','),
      )
      .join('|');
    if (key === mixed) return;
    mixed = key;
    weights.forEach((w, i) => (mix.uniforms[`w${i}`]!.value as Vector3).copy(w));
    renderer.setRenderTarget(mixTarget);
    renderer.render(quadScene, quadCamera);
    renderer.setRenderTarget(null);
  };
  const resize = (w: number, h: number) => {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false);
    roomTarget?.dispose();
    roomTarget = new WebGLRenderTarget(
      Math.max(1, Math.round(width * ROOM_SCALE)),
      Math.max(1, Math.round(height * ROOM_SCALE)),
      {
        type: HalfFloatType,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
        // Seen sharp between the plates now: the furniture's edges are smoothed (resolved before
        // the mip chain the frosted glass reads).
        samples: 4,
      },
    );
    composite.uniforms['tRoom']!.value = roomTarget.texture;
    (composite.uniforms['resolution']!.value as Vector2).set(width, height);
  };
  resize(doc.defaultView?.innerWidth ?? 1280, doc.defaultView?.innerHeight ?? 720);
  canvas.addEventListener('webglcontextlost', () => (destroyed = true));
  const release = () => {
    destroyed = true;
    canvas.remove();
    disposeObject(gltf.scene);
    layers.forEach((l) => l.texture.dispose());
    mixTarget.dispose();
    roomTarget?.dispose();
    mix.dispose();
    composite.dispose();
    quad.geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    // One texture per quiet moment: each upload is a few ms on its own (a 1024 px layer), where
    // the first draw uploaded them all in one task.
    const textures = new Set<Texture>(layers.map((l) => l.texture));
    scene.traverse((o) => {
      const map = ((o as Mesh).material as MeshBasicMaterial | undefined)?.map;
      if (map) textures.add(map);
    });
    for (const texture of textures) {
      await quiet(view, 1000, signal);
      renderer.initTexture(texture);
    }
    // The programs, linked in parallel by the GPU process (KHR_parallel_shader_compile) while the
    // page runs; the first draw then finds them ready instead of waiting on the link. Each pass is
    // compiled for the target it draws into (the program depends on it: colour space, tone mapping).
    await quiet(view, 1000, signal);
    const compile = (target: WebGLRenderTarget | null, s: Scene, c: Camera) => {
      renderer.setRenderTarget(target);
      const done = renderer.compileAsync(s, c);
      renderer.setRenderTarget(null);
      return done;
    };
    await Promise.all([
      compile(mixTarget, quadScene, quadCamera),
      compile(roomTarget!, scene, camera),
      compile(null, compositeScene, quadCamera),
    ]);
    // Each pass's first draw still checks its programs (a synchronous round trip to the GPU
    // process per program, ~13 ms for all in the profile) and uploads its buffers: one pass per
    // quiet moment, into the canvas that is still transparent. The real first draw finds them done.
    const warm: [WebGLRenderTarget | null, Scene, Camera][] = [
      [mixTarget, quadScene, quadCamera],
      [roomTarget!, scene, camera],
      [null, compositeScene, quadCamera],
    ];
    for (const [target, s, c] of warm) {
      await quiet(view, 1000, signal);
      renderer.setRenderTarget(target);
      renderer.render(s, c);
      renderer.setRenderTarget(null);
    }
    await quiet(view, 1000, signal);
  } catch (error) {
    release();
    throw error;
  }
  slot.parent.prepend(canvas);
  let revealed: Promise<void> | undefined;
  let resident: RoomResident | undefined;
  let dimmed = 0;
  const projected = new Vector3();
  return {
    canvas,
    baseFovDeg: cameraNode.fov,
    layout,
    async setResident(next) {
      if (resident === next) return;
      if (resident) scene.remove(resident.root);
      resident = next;
      if (!next) return;
      // The character's programs link in parallel before it is first drawn (the startup's long
      // first draw was the room's own link, 11節): it joins the scene only once they are ready.
      const visible = next.root.visible;
      next.root.visible = true;
      const holder = new Scene().add(next.root);
      holder.add(fill.clone(), key.clone());
      renderer.setRenderTarget(roomTarget ?? null);
      await renderer.compileAsync(holder, camera).catch(() => undefined);
      renderer.setRenderTarget(null);
      next.root.visible = visible;
      if (resident === next && !destroyed) scene.add(next.root);
    },
    project(points) {
      return points.map(({ x, y, z }) => {
        projected.set(x, y, z).project(camera);
        if (projected.z > 1 || projected.z < -1) return null;
        return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      });
    },
    dim(amount) {
      const next = Math.round(Math.min(1, Math.max(0, amount)) * 100) / 100;
      if (next === dimmed) return;
      dimmed = next;
      // Over the reveal's own opacity (a style the page cannot change): a short dip, no transition.
      canvas.style.setProperty('filter', next ? `brightness(${1 - next * 0.85})` : 'none', 'important');
    },
    reveal() {
      revealed ??= new Promise<void>((resolve) => {
        // The canvas was connected at opacity 0 in an earlier frame, so this change transitions.
        canvas.style.setProperty('opacity', '1', 'important');
        const end = () => resolve();
        canvas.addEventListener('transitionend', end, { once: true });
        view.setTimeout(end, REVEAL_MS + 100);
      });
      return revealed;
    },
    resize,
    draw(frame, look) {
      if (destroyed || !roomTarget) return;
      remix(look, frame.video);
      // The camera: camera_main moved in its own axes, the dolly zoom's narrower view.
      camera.position
        .copy(base.position)
        .addScaledVector(axes.right, frame.camera.offset.x)
        .addScaledVector(axes.up, frame.camera.offset.y)
        .addScaledVector(axes.back, frame.camera.offset.z);
      camera.quaternion.copy(base.quaternion);
      const orbit = ((frame.camera.orbitDeg ?? 0) * Math.PI) / 180;
      if (orbit) {
        // A turn about the room's middle (the dolly zoom's subject in front of camera_main), about
        // the room's vertical: vertical lines stay vertical.
        const pivot = base.position.clone().addScaledVector(axes.back, -ROOM_SUBJECT_M);
        const turn = new Quaternion().setFromAxisAngle(UP, orbit);
        camera.position.sub(pivot).applyQuaternion(turn).add(pivot);
        camera.quaternion.premultiply(turn);
      }
      camera.fov = frame.camera.fovDeg;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (frame.camera.shiftX || frame.camera.shiftY) {
        // The lens shift: the frustum slides instead of the camera turning (an off-axis view).
        const m = camera.projectionMatrix.elements;
        m[8] = (frame.camera.shiftX ?? 0) / camera.aspect;
        m[9] = frame.camera.shiftY ?? 0;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      camera.updateMatrixWorld();
      fill.color.setRGB(0.55 + frame.video.r * 0.6, 0.52 + frame.video.g * 0.6, 0.6 + frame.video.b * 0.6);
      if (monitor) monitor.color.setRGB(frame.video.r * 1.6, frame.video.g * 1.6, frame.video.b * 1.6);
      renderer.setRenderTarget(roomTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const u = composite.uniforms;
      const plates = u['plates']!.value as Vector4[],
        info = u['plateInfo']!.value as Vector4[];
      frame.plates.slice(0, PLATE_LIMIT).forEach((p, i) => {
        plates[i]!.set(p.left, p.top, p.right, p.bottom);
        info[i]!.set(SPACE_BREAK === 'density' ? 0 : PLATE_FLOOR[p.importance], p.video ? 1 : 0, 0, 0);
      });
      u['plateCount']!.value = Math.min(PLATE_LIMIT, frame.plates.length);
      const marks = (frame.marks ?? []).slice(0, MARK_LIMIT);
      marks.forEach((m, i) => (u['marks']!.value as Vector4[])[i]!.set(m.x, m.y, m.size, m.strength));
      u['markCount']!.value = marks.length;
      u['dark']!.value = frame.scheme === 'dark' ? 1 : 0;
      // A broken build (WW_SPACE_BREAK=density) drops the readability density, to see its tests fail.
      // The limit keeps a margin for the 8-bit output: rounding a pixel to the nearest byte can move
      // it half a step past an exact limit (measured 4.47:1 without it on real YouTube).
      const limit = plateLimit(frame.scheme);
      u['limit']!.value =
        SPACE_BREAK === 'density'
          ? frame.scheme === 'dark'
            ? 1
            : 0
          : frame.scheme === 'dark'
            ? limit * 0.9
            : limit + 0.02;
      const b = PLATE_TEXT[frame.scheme].base;
      // The base colour is grey: its luminance is the scheme's base.
      (u['baseColor']!.value as Color).setRGB(b, b, b);
      (u['glass']!.value as Vector4).set(look.glass.blur, look.glass.refraction, look.glass.highlight, look.glass.tint);
      u['shadowAmount']!.value = look.glass.shadow * 0.45;
      (u['videoColor']!.value as Color).setRGB(
        frame.video.r * look.videoLight,
        frame.video.g * look.videoLight,
        frame.video.b * look.videoLight,
      );
      renderer.render(compositeScene, quadCamera);
    },
    readPixels: options.readback
      ? (points) => {
          const gl = renderer.getContext();
          return points.map(({ x, y }) => {
            const px = new Uint8Array(4);
            gl.readPixels(Math.round(x), height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            return [px[0]!, px[1]!, px[2]!];
          });
        }
      : undefined,
    destroy: release,
  };
}
