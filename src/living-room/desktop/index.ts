/**
 * The virtual desktop joined to the room (docs/living-desktop.md, docs/living-mind.md). One state
 * (state.ts) drives everything at once:
 *
 *   the page       glass windows and a ball over the room, things that can be thrown (view.ts)
 *   the monitor    the same desktop on the desk monitor's face (paint.ts), or the real screen
 *                  while it is mirrored (mirror.ts)
 *   the light      the monitor's light and the desktop's glow from the viewer's side, baked
 *                  layers tinted with what is shown; and under each window and the ball a pool
 *                  of its light and a soft shadow on the floor, which go where it goes
 *   the resident   what it can do with the desktop (the stage): where a hand reaches a window's
 *                  frame or the ball, where it can sit on a window; and what it does to it
 */
import {
  type Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoTexture,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
} from 'three';
import { GLOW_SLOTS, type ScreenGlow } from '../screen-glow';
import type { LivingResident } from '../resident';
import type { StageAct, StageThing, StageView } from '../director';
import {
  WALLPAPERS,
  desktopLight,
  focused,
  linear,
  type AppId,
  type DeskWindow,
  type DesktopAction,
  type DesktopState,
} from './state';
import { desktopView } from './view';
import { MONITOR_H, MONITOR_W, paintDesktop } from './paint';
import { mirror as mirrorSource } from './mirror';
import { edgeSamples } from './edge';
import { startLive, type Live } from '../live';

export interface DesktopEnv {
  host: HTMLElement;
  scene: Scene;
  room: Object3D;
  camera: PerspectiveCamera;
  glow: ScreenGlow;
  floorY: number;
  resident: LivingResident | undefined;
  /** The room's walls and floor (their box and their meshes), and the wall and ceiling the page
   * added: live mode lights them and turns them down (docs/living-live.md). */
  shell: Box3;
  shellMeshes: readonly Object3D[];
  added: readonly Object3D[];
  /** Asks the page for a frame (it draws only when something changes). */
  wake(): void;
}

export interface Desktop {
  /** What the desktop offers the resident this frame. */
  stage(): StageView;
  /** One frame; `acts` is what the resident did to the desktop. */
  update(dt: number, now: number, acts: readonly StageAct[]): void;
  /** Something of the desktop is still moving: the page keeps drawing. */
  readonly busy: boolean;
  /** The real screen is being mirrored (a picture of some fifteen frames a second). */
  readonly mirroring: boolean;
  readonly open: boolean;
  state(): DesktopState;
  /** Live mode (docs/living-live.md): the room around a video. */
  readonly live: Live;
  dispatch(action: DesktopAction): void;
}

/**
 * How strongly each layer lights the room, and the resident (who is lit by lamps). Set by eye on
 * the real page: the room keeps its dark blue night; an open desktop is a soft wash from the
 * front, never daylight.
 */
const GAIN = {
  screen: 2.6,
  ui: 1.5,
  uiBody: 2.4,
  screenBody: 1.1,
  pool: 0.3,
  ball: 0.55,
  poolBody: 0.9,
  liveScreen: 1.6,
};
/** The monitor's face is brighter than white, so it blooms like the room's other screens. */
const FACE = 1.5;
/** How hard the resident sends a thing off (CSS pixels a second). */
const SHOVE = { nudge: 150, push: 980, pull: -560, bat: 1350 };
/** Where the desktop's panes hang in the room (metres toward the viewer from its middle). */
const PANE_Z = 1.2;
/** Heights a hand can meet a thing at, as shares of the shoulder's height: the easy ones first. */
const REACH = [0.86, 1.08, 0.64, 1.26, 0.46];
/** Depths of the room (metres from its middle toward the viewer) a seat on a window is tried at. */
const PERCH_DEPTHS = [0.4, -0.3, 1.0, -0.9, 1.6, -1.5, 2.1, -2.1];
/** A thing passing this fast over the resident startles it. */
const WHOOSH = 900;

function blob() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export function startRoomDesktop(env: DesktopEnv): Desktop {
  const { resident, glow, camera } = env;
  let dirty = true;
  const view = desktopView(env.host, {
    changed: (state) => {
      dirty = true;
      // (At once: entering live mode asks the browser for the tab, which needs the press itself.)
      live.changed(state);
      env.wake();
    },
    mirror: (on) => {
      if (on) void source.start();
      else source.stop();
    },
    liveView: (name) => live.setView(name),
    light: (on) => live.setLight(on),
  });
  const live: Live = startLive(
    {
      scene: env.scene,
      glow,
      shell: env.shell,
      shellMeshes: env.shellMeshes,
      added: env.added,
      floorY: env.floorY,
      resident: Boolean(resident),
      wake: env.wake,
    },
    view,
  );
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
  let shared: VideoTexture | undefined;
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

  // --- lamps for the resident (the room itself takes the baked layers and the pools) ------------
  const uiLamp = new DirectionalLight(0xffffff, 0);
  // From the viewer's side, a little above: where the desktop hangs.
  uiLamp.position.set(0.5, 2.2, 6);
  const screenLamp = new PointLight(0xffffff, 0, 3.2, 2);
  screenLamp.position.copy(faceAt).add(new Vector3(0, 0, 0.25));
  // The window in front shines on it from where that window hangs.
  const windowLamp = new PointLight(0xffffff, 0, 3, 2);
  if (resident) env.scene.add(uiLamp, uiLamp.target, screenLamp, windowLamp);

  // --- a soft shadow on the floor under each thing of the desktop --------------------------------
  const shade = blob();
  const shadows = Array.from({ length: GLOW_SLOTS - 1 }, () => {
    const mesh = new Mesh(
      new CircleGeometry(0.5, 20),
      new MeshBasicMaterial({ map: shade, color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    mesh.visible = false;
    env.scene.add(mesh);
    return mesh;
  });

  const screen = new Vector3(),
    ui = new Vector3(),
    want = new Vector3(),
    accent = new Color(),
    into = new Vector3();
  let amount = 0,
    settled = false,
    first = true,
    sliding = false,
    whooshedAt = -Infinity,
    bats = 0;

  // --- screen ↔ room ---------------------------------------------------------------------------
  const ray = new Raycaster();
  const ndc = new Vector2();
  const sight = (x: number, y: number) => {
    ndc.set((x / window.innerWidth) * 2 - 1, 1 - (y / window.innerHeight) * 2);
    ray.setFromCamera(ndc, camera);
    return ray.ray;
  };
  /**
   * Where a point of the screen is in the room at a height above the floor, along the line of
   * sight. The view is level, from eye height: below the eye the line comes down to that height,
   * above it the line climbs to it.
   */
  const under = (x: number, y: number, height: number) => {
    const { origin, direction } = sight(x, y);
    if (Math.abs(direction.y) < 1e-4) return undefined;
    const t = (env.floorY + height - origin.y) / direction.y;
    return t > 0 ? origin.clone().addScaledVector(direction, t) : undefined;
  };
  /** Where a point of the screen is on the upright plane the desktop's panes hang in. */
  const onPane = (x: number, y: number) => {
    const { origin, direction } = sight(x, y);
    if (direction.z > -1e-4) return undefined;
    return origin.clone().addScaledVector(direction, (PANE_Z - origin.z) / direction.z);
  };
  const inRoom = (p: Vector3 | undefined, margin = 0): p is Vector3 =>
    Boolean(p) && Math.abs(p!.x) < 2.9 + margin && Math.abs(p!.z) < 2.6 + margin;
  /** Where a point of the room is on the screen (CSS pixels). */
  const onScreen = (p: readonly number[]): [number, number] => {
    want.set(p[0]!, p[1]!, p[2]!).project(camera);
    return [((want.x + 1) / 2) * window.innerWidth, ((1 - want.y) / 2) * window.innerHeight];
  };
  const thingOf = (win: DeskWindow): StageThing => {
    const body = resident!.metrics();
    const from = resident!.state().mover;
    const thing: StageThing = { speed: view.speed(win.id), held: view.held(win.id) };
    // A hand can be anywhere from the waist to a stretch above the head: the place on the floor
    // from which it meets the thing is searched over those heights (the easy ones first).
    if (win.id === 'ball') {
      for (const k of REACH) {
        const p = under(win.x + win.w / 2, win.y + win.h / 2, body.shoulderHeight * k);
        if (!inRoom(p)) continue;
        thing.hand = [p.x, p.y, p.z];
        break;
      }
      return thing;
    }
    // A hand comes to the nearest place just outside the frame (its bottom, the lower sides).
    let best = Infinity;
    for (const [x, y] of edgeSamples({ left: win.x, top: win.y, right: win.x + win.w, bottom: win.y + win.h }, 10))
      for (const k of REACH) {
        const p = under(x, y, body.shoulderHeight * k);
        if (!inRoom(p)) continue;
        const far = Math.hypot(p.x - from.x, p.z - from.z);
        if (far < best) {
          best = far;
          thing.hand = [p.x, p.y, p.z];
        }
      }
    // It sits on the middle of the top edge, facing the viewer. The seat is somewhere on the line
    // of sight through that point: the depths of the room are tried from its middle outward, and
    // the first where the line is at a height it can jump to is taken (a window low on the screen
    // is a hop up, one high on it a great leap).
    const { origin, direction } = sight(win.x + win.w / 2, win.y - 2);
    if (direction.z < -1e-4)
      for (const z of PERCH_DEPTHS) {
        const seat = origin.clone().addScaledVector(direction, (z - origin.z) / direction.z);
        const up = (seat.y - env.floorY) / body.height;
        if (up < 0.6 || up > 2.5 || !inRoom(seat, -0.35)) continue;
        thing.perch = {
          at: [seat.x, seat.y, seat.z],
          heading: Math.atan2(camera.position.x - seat.x, camera.position.z - seat.z),
        };
        break;
      }
    return thing;
  };
  const stage = (): StageView => {
    const state = view.state();
    // (At a live the windows are away and the player is the screen: nothing of it to play with.)
    if (!resident || !state.open || state.live) return { open: state.open };
    const front = focused(state);
    const ball = state.windows.find((w) => w.id === 'ball');
    return {
      open: true,
      ...(front ? { window: thingOf(front) } : {}),
      ...(ball ? { ball: thingOf(ball) } : {}),
    };
  };

  function act(a: StageAct, state: DesktopState) {
    switch (a.type) {
      case 'open':
      case 'close':
        view.dispatch({ type: a.type });
        break;
      case 'app':
        view.dispatch({ type: 'app', id: a.id });
        break;
      case 'wallpaper':
        view.dispatch({ type: 'wallpaper', index: a.index });
        break;
      case 'sit': {
        const id = focused(state)?.id;
        if (id) view.sit(id, a.on);
        break;
      }
      case 'knock': {
        // Its knuckles on the glass: a ring spreads on the screen from where they are.
        const [x, y] = onScreen(resident!.chest());
        view.ripple(x, y - window.innerHeight * 0.03);
        break;
      }
      case 'impulse': {
        const id: AppId | undefined = a.thing === 'ball' ? 'ball' : focused(state)?.id;
        const win = id && state.windows.find((w) => w.id === id);
        if (!id || !win) break;
        // Away from where it stands on the screen (a pull is toward it); the ball is batted
        // back over the room, a little to one side and the other in turn.
        const [sx, sy] = onScreen(resident!.chest());
        let dx = win.x + win.w / 2 - sx,
          dy = win.y + win.h / 2 - sy;
        const far = Math.hypot(dx, dy) || 1;
        dx /= far;
        dy /= far;
        if (a.kind === 'bat') {
          const cx = window.innerWidth * 0.46 - (win.x + win.w / 2),
            cy = window.innerHeight * 0.55 - (win.y + win.h / 2);
          const toMiddle = Math.hypot(cx, cy) || 1;
          const turn = (bats++ % 2 ? 1 : -1) * 0.55;
          const mx = dx * 0.5 + (cx / toMiddle) * 0.9,
            my = dy * 0.5 + (cy / toMiddle) * 0.9;
          dx = mx * Math.cos(turn) - my * Math.sin(turn);
          dy = mx * Math.sin(turn) + my * Math.cos(turn);
          const n = Math.hypot(dx, dy) || 1;
          dx /= n;
          dy /= n;
        }
        view.impulse(id, dx * SHOVE[a.kind], dy * SHOVE[a.kind]);
        // (What it sent off itself does not startle it as it leaves.)
        whooshedAt = performance.now();
        break;
      }
    }
    env.wake();
  }

  return {
    stage,
    update(dt, now, acts) {
      for (const a of acts) act(a, view.state());
      sliding = view.step(dt, now);
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
      // A live takes the room over: the desktop's own glow goes out, and the desk's baked light
      // (the layer baked for the monitor, behind the live's screen) shows the picture's colour
      // as the screen's bounce off what is behind it.
      live.update(dt, now, state, camera);
      const staged = live.amount,
        plain = 1 - staged,
        picture = live.light.all;
      glow.layer(
        'screen',
        screen.x * plain + picture[0] * staged,
        screen.y * plain + picture[1] * staged,
        screen.z * plain + picture[2] * staged,
        GAIN.screen * plain + GAIN.liveScreen * staged,
      );
      glow.layer('ui', ui.x, ui.y, ui.z, GAIN.ui * amount * plain);
      uiLamp.color.setRGB(ui.x, ui.y, ui.z);
      uiLamp.intensity = GAIN.uiBody * amount * plain;
      screenLamp.color.setRGB(screen.x, screen.y, screen.z);
      screenLamp.intensity = GAIN.screenBody * plain;
      settled =
        amount === target &&
        screen.distanceToSquared(want.set(light.screen[0], light.screen[1], light.screen[2])) < 1e-6 &&
        (!state.open || ui.distanceToSquared(want.set(light.ui[0], light.ui[1], light.ui[2])) < 1e-6);

      // Under each window and the ball: its light on what is behind it, its shadow on the floor.
      // They are where the thing is on the screen, so they go with it when it is dragged or thrown.
      const paper = WALLPAPERS[state.wallpaper] ?? WALLPAPERS[0]!;
      const [ar, ag, ab] = linear(paper.accent);
      accent.setRGB(ar, ag, ab);
      const front = focused(state)?.id;
      windowLamp.intensity = 0;
      for (let i = 0; i < GLOW_SLOTS - 1; i++) {
        // (At a live these lamps are the picture's: live/stage.ts sets them.)
        if (staged > 0.004) {
          shadows[i]!.visible = false;
          continue;
        }
        const win = amount > 0.01 ? state.windows[i] : undefined;
        const shadow = shadows[i]!;
        const cx = win ? win.x + win.w / 2 : 0;
        // The panes hang upright in the front of the room: that is where this one's light is.
        const hang = win && onPane(cx, win.y + win.h / 2);
        if (!win || !hang || Math.abs(hang.x) > 4.2 || hang.y > env.floorY + 3.4 || hang.y < env.floorY - 0.4) {
          glow.off(i + 1);
          shadow.visible = false;
          continue;
        }
        const ball = win.id === 'ball';
        // It shines into the room: the way the viewer looks, levelled a little.
        camera.getWorldDirection(into);
        into.y *= 0.35;
        glow.set(
          i + 1,
          hang,
          into,
          accent,
          (ball ? GAIN.ball : GAIN.pool * Math.sqrt((win.w * win.h) / 90000)) * amount,
        );
        if (win.id === front || (ball && !front)) {
          windowLamp.position.copy(hang);
          windowLamp.color.copy(accent);
          windowLamp.intensity = GAIN.poolBody * amount;
        }
        // Its shadow lies on the floor straight under it, fainter the higher it hangs.
        const across = onPane(cx + 100, win.y + win.h / 2);
        const high = (hang.y - env.floorY) / 3;
        if (Math.abs(hang.x) < 2.9 && across && high < 1) {
          const metres = (hang.distanceTo(across) / 100) * win.w;
          shadow.visible = true;
          shadow.position.set(hang.x, env.floorY + 0.045, hang.z);
          shadow.scale.set(metres * 1.15, metres * (ball ? 1.15 : 0.42), 1);
          (shadow.material as MeshBasicMaterial).opacity = (ball ? 0.5 : 0.38) * (1 - 0.7 * Math.max(0, high)) * amount;
        } else shadow.visible = false;
      }

      // The monitor: the mirrored picture, or the desktop painted when it changes (and on the minute).
      if (source.state === 'on') {
        if (!shared) {
          shared = tune(new VideoTexture(view.mirrorVideo));
          faceMaterial.map = shared;
          faceMaterial.needsUpdate = true;
        }
      } else {
        if (shared) {
          shared.dispose();
          shared = undefined;
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

      if (resident) {
        // A window or the ball flying past where it stands gives it a start.
        if (state.open && !resident.front && now - whooshedAt > 2500) {
          const [sx, sy] = onScreen(resident.chest());
          for (const win of state.windows)
            if (
              view.speed(win.id) > WHOOSH &&
              sx > win.x - 30 &&
              sx < win.x + win.w + 30 &&
              sy > win.y - 30 &&
              sy < win.y + win.h + 30
            ) {
              resident.notice('whoosh');
              whooshedAt = now;
              break;
            }
        }
        view.setResident(resident.readout());
      }
    },
    get busy() {
      return !settled || sliding || source.state === 'on' || live.amount > 0;
    },
    get mirroring() {
      return source.state === 'on';
    },
    get open() {
      return view.state().open;
    },
    state: () => view.state(),
    dispatch: (action) => view.dispatch(action),
    live,
  };
}
