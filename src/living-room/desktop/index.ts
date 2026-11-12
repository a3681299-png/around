/**
 * The virtual desktop joined to the room (docs/living-desktop.md). One state (state.ts) drives
 * four things at once:
 *
 *   the page       glass windows over the room (view.ts)
 *   the monitor    the same desktop on the desk monitor's face (paint.ts), or the real screen
 *                  while it is mirrored (mirror.ts)
 *   the light      the monitor's light and the desktop's glow from the viewer's side, both baked
 *                  layers tinted with the colour of what is shown (screen-glow.ts)
 *   the resident   where on the front window's frame it can put a hand, as a point in the room
 */
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  MeshBasicMaterial,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoTexture,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
} from 'three';
import type { ScreenGlow } from '../screen-glow';
import type { LivingResident } from '../resident';
import { desktopLight, type DesktopState } from './state';
import { desktopView } from './view';
import { MONITOR_H, MONITOR_W, paintDesktop } from './paint';
import { mirror as mirrorSource } from './mirror';
import { edgeSamples } from './edge';

export interface DesktopEnv {
  host: HTMLElement;
  scene: Scene;
  room: Object3D;
  camera: PerspectiveCamera;
  glow: ScreenGlow;
  floorY: number;
  resident: LivingResident | undefined;
  /** Asks the page for a frame (it draws only when something changes). */
  wake(): void;
}

export interface Desktop {
  update(dt: number, now: number): void;
  /** Something of the desktop is still moving: the page keeps drawing. */
  readonly busy: boolean;
  /** The real screen is being mirrored (a picture of some fifteen frames a second). */
  readonly mirroring: boolean;
  readonly open: boolean;
  state(): DesktopState;
}

/**
 * How strongly each layer lights the room, and the resident (who is lit by lamps). Set by eye on
 * the real page: the room keeps its dark blue night; an open desktop is a soft wash from the
 * front, never daylight.
 */
const GAIN = { screen: 2.6, ui: 1.5, uiBody: 2.4, screenBody: 1.1 };
/** The monitor's face is brighter than white, so it blooms like the room's other screens. */
const FACE = 1.5;

export function startRoomDesktop(env: DesktopEnv): Desktop {
  const { resident, glow, camera } = env;
  let dirty = true;
  let pressedFront = false;
  const view = desktopView(env.host, {
    changed: () => {
      dirty = true;
      env.wake();
    },
    mirror: (on) => {
      if (on) void source.start();
      else source.stop();
    },
    pressed: () => {
      pressedFront = true;
    },
  });
  const source = mirrorSource(view.mirrorVideo, (state) => {
    view.setMirror(state);
    view.dispatch({ type: 'mirror', on: state === 'on' });
    dirty = true;
    env.wake();
  });
  view.setMirror(source.state);

  // --- the monitor's face ---------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = MONITOR_W;
  canvas.height = MONITOR_H;
  const pen = canvas.getContext('2d')!;
  // (The room file's UVs are glTF's: no flip.)
  const tune = <T extends Texture>(texture: T) => {
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    return texture;
  };
  const painted = tune(new CanvasTexture(canvas));
  let live: VideoTexture | undefined;
  const face = env.room.getObjectByName('dyn_monitor_screen') as Mesh | undefined;
  const faceMaterial = new MeshBasicMaterial({ map: painted, color: new Color(FACE, FACE, FACE) });
  if (face?.isMesh) face.material = faceMaterial;
  const faceAt = new Vector3();
  if (face) {
    face.updateWorldMatrix(true, false);
    face.geometry.computeBoundingBox();
    face.geometry.boundingBox!.getCenter(faceAt).applyMatrix4(face.matrixWorld);
  }
  let minute = -1;

  // --- lamps for the resident (the room itself takes the baked layers) --------------------------
  const uiLamp = new DirectionalLight(0xffffff, 0);
  // From the viewer's side, a little above: where the desktop hangs.
  uiLamp.position.set(0.5, 2.2, 6);
  const screenLamp = new PointLight(0xffffff, 0, 3.2, 2);
  screenLamp.position.copy(faceAt).add(new Vector3(0, 0, 0.25));
  if (resident) env.scene.add(uiLamp, uiLamp.target, screenLamp);

  const screen = new Vector3(),
    ui = new Vector3(),
    want = new Vector3();
  let amount = 0,
    settled = false,
    first = true;

  // --- the resident and the front window --------------------------------------------------------
  const ray = new Raycaster();
  const ndc = new Vector2();
  let rectKey = '',
    chosen: Vector3 | undefined,
    wasTouching = false;
  /** Where a hand held at hand height is, under a point of the screen. */
  const under = (x: number, y: number, height: number) => {
    ndc.set((x / window.innerWidth) * 2 - 1, 1 - (y / window.innerHeight) * 2);
    ray.setFromCamera(ndc, camera);
    const { origin, direction } = ray.ray;
    if (direction.y > -1e-4) return undefined;
    const t = (height - origin.y) / direction.y;
    return t > 0 ? origin.clone().addScaledVector(direction, t) : undefined;
  };
  function attend(state: DesktopState) {
    if (!resident) return;
    const rect = state.open ? view.frontRect() : undefined;
    if (!rect) {
      rectKey = '';
      chosen = undefined;
      resident.setUi(undefined);
      wasTouching = false;
      return;
    }
    // The place is chosen when the window comes to rest somewhere new, not every frame: the
    // resident walks to one place on the frame, it does not hover between two.
    const key = `${Math.round(rect.left / 3)},${Math.round(rect.top / 3)},${Math.round(rect.width)},${window.innerWidth},${window.innerHeight}`;
    if (key !== rectKey) {
      rectKey = key;
      const body = resident.metrics();
      const handY = env.floorY + body.shoulderHeight * 0.86;
      const from = resident.state().mover;
      let best = Infinity;
      chosen = undefined;
      for (const [x, y] of edgeSamples(rect, 10)) {
        const p = under(x, y, handY);
        // In the room (the approach itself decides whether there is floor to stand on).
        if (!p || Math.abs(p.x) > 2.9 || Math.abs(p.z) > 2.6) continue;
        const far = Math.hypot(p.x - from.x, p.z - from.z);
        if (far < best) {
          best = far;
          chosen = p;
        }
      }
      // Nowhere in the room: something to look at, all the same (under the window's middle).
      chosen ??= under(rect.left + rect.width / 2, rect.bottom, handY);
    }
    resident.setUi(chosen ? [chosen.x, chosen.y, chosen.z] : undefined);
    // Its hand lands on the frame: the window gives. A press on the window it holds is answered.
    const touching = resident.touching();
    if (touching && !wasTouching) view.nudge();
    if (touching && pressedFront) resident.cheer();
    wasTouching = touching;
  }

  return {
    update(dt, now) {
      const state = view.state();
      const mirrored = source.color(now);
      const light = desktopLight(state, mirrored);
      // Colours ease to what is shown (a wallpaper change sweeps through the room; a mirrored
      // film's cuts are softened). The glow keeps its colour while it fades out.
      const k = first ? 1 : 1 - Math.exp(-6 * dt);
      first = false;
      screen.lerp(want.set(light.screen[0], light.screen[1], light.screen[2]), k);
      if (state.open) ui.lerp(want.set(light.ui[0], light.ui[1], light.ui[2]), k);
      const target = state.open ? 1 : 0;
      amount += (target - amount) * (1 - Math.exp(-(state.open ? 4.5 : 3) * dt));
      if (Math.abs(target - amount) < 0.002) amount = target;
      glow.layer('screen', screen.x, screen.y, screen.z, GAIN.screen);
      glow.layer('ui', ui.x, ui.y, ui.z, GAIN.ui * amount);
      uiLamp.color.setRGB(ui.x, ui.y, ui.z);
      uiLamp.intensity = GAIN.uiBody * amount;
      screenLamp.color.setRGB(screen.x, screen.y, screen.z);
      screenLamp.intensity = GAIN.screenBody;
      settled =
        amount === target &&
        screen.distanceToSquared(want.set(light.screen[0], light.screen[1], light.screen[2])) < 1e-6 &&
        (!state.open || ui.distanceToSquared(want.set(light.ui[0], light.ui[1], light.ui[2])) < 1e-6);

      // The monitor: the mirrored picture, or the desktop painted when it changes (and on the minute).
      if (source.state === 'on') {
        if (!live) {
          live = tune(new VideoTexture(view.mirrorVideo));
          faceMaterial.map = live;
          faceMaterial.needsUpdate = true;
        }
      } else {
        if (live) {
          live.dispose();
          live = undefined;
          faceMaterial.map = painted;
          faceMaterial.needsUpdate = true;
          dirty = true;
        }
        const date = new Date();
        if (dirty || date.getMinutes() !== minute) {
          minute = date.getMinutes();
          dirty = false;
          paintDesktop(pen, state, date);
          painted.needsUpdate = true;
        }
      }
      attend(state);
      pressedFront = false;
      if (resident) view.setResident(resident.says());
    },
    get busy() {
      return !settled || source.state === 'on';
    },
    get mirroring() {
      return source.state === 'on';
    },
    get open() {
      return view.state().open;
    },
    state: () => view.state(),
  };
}
