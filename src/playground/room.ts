import {
  AmbientLight,
  BoxGeometry,
  Color,
  DepthTexture,
  Group,
  HalfFloatType,
  LoadingManager,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { VRMUtils } from '@pixiv/three-vrm';
import type { AssetPort } from '../assets/port';
import { parseVerifiedModelSource } from '../assets/verified-source';
import type { DesktopLayout } from './desktop-layout';

export function positionMonitor(group: Group, monitor: DesktopLayout['monitor']) {
  group.position.set(...monitor.position);
  group.rotation.set(...(monitor.rotationDeg.map(MathUtils.degToRad) as [number, number, number]));
}

const QUAD_VERTEX = `
  varying vec2 pixel;
  void main() {
    pixel = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

async function roomLightLayers(gltf: GLTF) {
  const source = gltf.parser.json as {
    textures?: unknown[];
    extras?: { wwtRoom?: { version?: unknown; layers?: unknown } };
  };
  const packed = source.extras?.wwtRoom;
  if (!packed) return [];
  if (packed.version !== 1 || !Array.isArray(packed.layers) || packed.layers.length > 8)
    throw new Error('部屋の光の層の形式が不正です。');
  const weights = { sun_noon: 0.16, room_desk: 1, room_pendant: 0.7 } as const;
  const layers = packed.layers.flatMap((entry: { name?: unknown; texture?: unknown; scale?: unknown } | null) => {
    if (typeof entry?.name !== 'string' || !Object.hasOwn(weights, entry.name)) return [];
    if (
      typeof entry.texture !== 'number' ||
      !Number.isInteger(entry.texture) ||
      entry.texture < 0 ||
      entry.texture >= (source.textures?.length ?? 0) ||
      typeof entry.scale !== 'number' ||
      !Number.isFinite(entry.scale) ||
      entry.scale <= 0 ||
      entry.scale > 10000
    )
      throw new Error('部屋の光の層の値が範囲外です。');
    return [{ index: entry.texture, weight: entry.scale * weights[entry.name as keyof typeof weights] }];
  });
  const loaded = await Promise.allSettled(
    layers.map(async ({ index, weight }) => ({
      texture: (await gltf.parser.getDependency('texture', index)) as Texture,
      weight,
    })),
  );
  const ready = loaded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (ready.length !== layers.length) {
    for (const { texture } of ready) texture.dispose();
    throw new Error('部屋の光の層を読み込めません。');
  }
  return ready;
}

function mixRoomLight(renderer: WebGLRenderer, layers: Awaited<ReturnType<typeof roomLightLayers>>) {
  if (!layers.length) return;
  const image = layers[0]!.texture.image as { width: number };
  const size = Math.min(1024, image.width);
  const target = new WebGLRenderTarget(size, size, {
    depthBuffer: false,
    ...(renderer.extensions.has('EXT_color_buffer_float') ? { type: HalfFloatType } : {}),
  });
  target.texture.channel = 1;
  const material = new ShaderMaterial({
    uniforms: Object.fromEntries(
      layers.flatMap(({ texture, weight }, i) => {
        texture.colorSpace = '';
        return [
          [`layer${i}`, { value: texture }],
          [`weight${i}`, { value: weight }],
        ];
      }),
    ),
    vertexShader: QUAD_VERTEX,
    // Packed layers encode the square root of the linear light. Decode once for the static room.
    fragmentShader: `
      varying vec2 pixel;
      ${layers.map((_, i) => `uniform sampler2D layer${i}; uniform float weight${i};`).join('\n')}
      void main() {
        vec3 light = vec3(0.0);
        ${layers.map((_, i) => `{ vec3 s = texture2D(layer${i}, pixel).rgb; light += s * s * weight${i}; }`).join('\n')}
        gl_FragColor = vec4(light, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const pass = new FullScreenQuad(material);
  renderer.setRenderTarget(target);
  pass.render(renderer);
  renderer.setRenderTarget(null);
  pass.dispose();
  material.dispose();
  return target;
}

/** Geometry and practical lights can be swapped for the room asset at this boundary. */
export function mountRoom(
  scene: Scene,
  layout: DesktopLayout,
  assets: AssetPort,
  renderer: WebGLRenderer,
  invalidate: () => void,
) {
  const room = new Group();
  scene.add(room);
  scene.background = new Color(0x101728);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, luminous = false) => {
    const material = luminous ? new MeshBasicMaterial({ color }) : new MeshStandardMaterial({ color, roughness: 0.86 });
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    room.add(mesh);
    return mesh;
  };

  box(2420, 1460, 40, 0, 205, -970, 0x263952);
  box(2500, 35, 2900, 0, -526, 350, 0x544035);
  box(45, 1460, 2680, -1125, 205, 380, 0x263b53);
  box(45, 1460, 2680, 1125, 205, 380, 0x393249);
  for (let x = -1100; x <= 1100; x += 140) box(2, 1, 2600, x, -508, 350, 0x171c27);
  box(1600, 10, 1100, 0, -505, 220, 0x304f63);
  box(1560, 11, 1060, 0, -504, 220, 0x26364b);

  // A tall window, a low sideboard, and a lamp give the camera foreground and background cues.
  box(715, 490, 36, -610, 340, -930, 0x101d31);
  box(680, 451, 8, -610, 340, -908, 0x326285, true);
  box(672, 88, 9, -610, 174, -901, 0x698baa, true);
  box(20, 451, 20, -610, 340, -892, 0x182c42);
  box(690, 15, 20, -610, 340, -892, 0x182c42);
  box(730, 16, 73, -610, 98, -887, 0x41536a);
  box(382, 164, 250, 930, -408, -655, 0x82563c);
  box(404, 20, 265, 930, -322, -655, 0xa7744a);
  for (const x of [805, 930, 1055]) box(55, 7, 6, x, -380, -526, 0xf7b76a);
  box(130, 16, 104, 1010, -303, -655, 0x1c2433);
  box(11, 230, 11, 1010, -184, -655, 0xbb794d);
  box(160, 83, 140, 1010, -61, -655, 0xffbf78, true);
  box(170, 9, 148, 1010, -106, -655, 0xffe0a3, true);
  box(80, 100, 75, 780, -266, -666, 0x385b56);
  box(52, 62, 49, 854, -283, -633, 0x853b3e);
  const monitor = new Group();
  positionMonitor(monitor, layout.monitor);
  const [w, h] = layout.monitor.size;
  const frame = box(w + 24, h + 24, 28, 0, 0, -16, 0x17232a);
  monitor.add(frame);
  room.add(monitor);
  const [mx, my, mz] = layout.monitor.position;
  const top = my - h / 2 - 75;
  box(w + 140, 22, 300, mx, top - 11, mz + 22, 0x966b4b);
  box(21, 75, 22, mx, top + 37.5, mz - 22, 0x212e35);
  box(140, 7, 84, mx, top + 4, mz - 22, 0x212e35);
  for (const x of [mx - w * 0.53, mx + w * 0.53])
    box(30, Math.max(14, top - layout.floorY - 22), 34, x, (top + layout.floorY - 22) / 2, mz + 132, 0x6f4e3d);
  box(190, 115, 152, -945, -450, -270, 0x735342);
  box(205, 18, 167, -945, -385, -270, 0x9b7557);
  const leaves = [
    [-990, -310, -290, -0.43],
    [-908, -292, -264, 0.39],
    [-952, -252, -273, -0.12],
  ];
  for (const [x, y, z, angle] of leaves as [number, number, number, number][]) {
    box(38, 162, 35, x, y, z, 0x285d57).rotation.z = angle;
  }

  const practical = new PointLight(0xffaf66, 1380000, 1800);
  practical.position.set(1010, -103, -555);
  const window = new PointLight(0x8dc4ff, 1260000, 1900);
  window.position.set(-630, 380, -620);
  const videoLight = new PointLight(0x90c6ff, 0, 1650);
  scene.add(videoLight);
  const lights = new Group();
  lights.add(new AmbientLight(0xc3d7ff, 0.76), practical, window);
  scene.add(lights);
  let disposed = false;
  let lightMap: WebGLRenderTarget | undefined;
  if (layout.room) {
    const source = layout.room;
    const manager = new LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:')) return url;
      throw new Error('Playground room references an external resource.');
    });
    void assets
      .load(source.asset)
      .then((asset) => parseVerifiedModelSource(asset.modelBuffer!, new GLTFLoader(manager)))
      .then(async (gltf) => {
        const localRoom = gltf.scene;
        try {
          const layers = await roomLightLayers(gltf);
          try {
            if (disposed) return;
            lightMap = mixRoomLight(renderer, layers);
          } finally {
            for (const { texture } of layers) texture.dispose();
          }
          localRoom.position.set(...source.position);
          localRoom.rotation.set(...(source.rotationDeg.map(MathUtils.degToRad) as [number, number, number]));
          localRoom.scale.setScalar(source.scale);
          localRoom.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            if (/^(navmesh_|occluder_|marker_|shadow_)/.test(object.name) || object.name === 'dyn_monitor_screen') {
              object.visible = false;
              return;
            }
            const material = object.material;
            if (lightMap && material instanceof MeshStandardMaterial) {
              object.material = new MeshBasicMaterial({
                color: material.color,
                map: material.map,
                lightMap: object.geometry.hasAttribute('uv1') ? lightMap.texture : null,
              });
              material.dispose();
            }
          });
          room.visible = false;
          scene.add(localRoom);
        } finally {
          if (localRoom.parent !== scene) VRMUtils.deepDispose(localRoom);
        }
      })
      .catch((error: unknown) => console.warn('[WWT Playground] Room', error))
      .finally(() => {
        if (!disposed) invalidate();
      });
  }
  return {
    videoLight,
    lights,
    dispose() {
      disposed = true;
      VRMUtils.deepDispose(scene);
      lightMap?.dispose();
    },
  };
}

/** Preserve the wallpaper's depth as well as its colour so the moving resident can go behind furniture. */
export function createRoomCache(renderer: WebGLRenderer) {
  const size = renderer.getSize(new Vector2());
  const target = new WebGLRenderTarget(size.x, size.y, {
    depthTexture: new DepthTexture(size.x, size.y),
    ...(renderer.extensions.has('EXT_color_buffer_float') ? { type: HalfFloatType } : {}),
  });
  const material = new ShaderMaterial({
    uniforms: { wallpaper: { value: target.texture }, depth: { value: target.depthTexture } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: `
      uniform sampler2D wallpaper;
      uniform sampler2D depth;
      varying vec2 pixel;
      void main() {
        gl_FragColor = texture2D(wallpaper, pixel);
        gl_FragDepth = texture2D(depth, pixel).r;
        #include <colorspace_fragment>
      }
    `,
  });
  const composite = new FullScreenQuad(material);
  return {
    capture(room: Scene, camera: Camera) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(room, camera);
      renderer.setRenderTarget(null);
    },
    draw: () => composite.render(renderer),
    dispose() {
      composite.dispose();
      material.dispose();
      target.dispose();
    },
  };
}
