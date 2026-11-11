// The character in the living room: loads a local VRM and two motions, and runs the behaviour
// (src/characters/approach.ts) and the body (src/renderers/three/living-body.ts) on the page's
// clock. The character's files are not part of the repository or of a public build: the build
// copies them only when WW_LIVING_CHARACTER names a local folder (docs/living-body.md).
import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Camera,
  type Scene,
} from 'three';
import { prepareVerifiedSource } from '../assets/verified-source';
import { loadLivingBody, type LivingBody, type LivingBodyFacts } from '../renderers/three/living-body';
import {
  approachIntent,
  startApproach,
  stepApproach,
  type ApproachState,
  type Mood,
  type Seat,
} from '../characters/approach';
import type { SoftSurface } from './soft-surface';
import type { Vec3 } from '../characters/two-bone-ik';
import { standPoint, type RoomLayout } from '../world/room-life';

interface CharacterManifest {
  vrm: string;
  idle: string;
  walk: string;
  run?: string;
  sitDown?: string;
  sit?: string;
  standUp?: string;
}

export interface LivingResident {
  update(dt: number, camera: Camera): void;
  /** A point in the room's metres to notice, walk to and touch; undefined takes it away. */
  setTarget(target: Vec3 | undefined): void;
  /** A seat of the room by its id (sit_chair, sit_bed…) to go and sit on; undefined stands up. */
  sit(spot: string | undefined): boolean;
  /** How the next thing that appears is met: 'calm' walks over, 'interest' darts at it. */
  setMood(mood: Mood): void;
  /** The character's touch was answered (the thing was clicked): it is glad. */
  cheer(): void;
  state(): ApproachState & { target: Vec3 | undefined };
  facts(): LivingBodyFacts;
  metrics(): { arm: number; shoulderHeight: number; walkSpeed: number; height: number };
  /**
   * For measuring the motion (the test hook): starts keeping, each frame, the time, the phase,
   * where the main joints are and how far the planted feet have slid; returns what was kept since
   * the last call.
   */
  trace(): TraceFrame[];
}
export interface TraceFrame {
  t: number;
  phase: string;
  speed: number;
  slide: number;
  ground: number;
  feet: LivingBodyFacts['feet'];
  joints: ReturnType<LivingBody['joints']>;
}

const bytes = async (url: URL) => {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`キャラクターの素材を読み込めませんでした：${url.pathname}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function loadLivingResident(
  scene: Scene,
  base: URL,
  layout: RoomLayout,
  soft: SoftSurface,
): Promise<LivingResident> {
  const folder = new URL('character/', base);
  const manifest = (await (
    await fetch(new URL('character.json', folder), { credentials: 'omit' })
  ).json()) as CharacterManifest;
  const file = (name: string) => {
    if (!/^[\w.-]{1,80}$/.test(name)) throw new Error('キャラクターの素材の名前が正しくありません。');
    return new URL(name, folder);
  };
  const maybe = (name: string | undefined) => (name ? bytes(file(name)) : undefined);
  const [vrm, idle, walk, run, sitDown, sit, standUp] = await Promise.all([
    bytes(file(manifest.vrm)),
    bytes(file(manifest.idle)),
    bytes(file(manifest.walk)),
    maybe(manifest.run),
    maybe(manifest.sitDown),
    maybe(manifest.sit),
    maybe(manifest.standUp),
  ]);
  const prepared = prepareVerifiedSource(vrm, 'model/gltf-binary');
  if (!prepared.modelBuffer) throw new Error('キャラクターのモデルを検証できませんでした。');
  const body = await loadLivingBody(prepared.modelBuffer, {
    idle,
    walk,
    ...(run ? { run } : {}),
    ...(sitDown ? { sitDown } : {}),
    ...(sit ? { sit } : {}),
    ...(standUp ? { standUp } : {}),
  });
  scene.add(body.root);
  // The room's light is baked into unlit materials, so these reach only the character: a cool
  // night fill and a warmer key from the desk lamp's side.
  const fill = new AmbientLight(0xb9b4ff, 1.5);
  const key = new DirectionalLight(0xffe2d0, 1.6);
  key.position.set(-1.5, 3, 2.5);
  scene.add(fill, key, key.target);

  // The thing to notice: a small lit panel (a stand-in for a UI card). It always faces the viewer.
  const marker = new Mesh(
    new PlaneGeometry(0.14, 0.09),
    new MeshBasicMaterial({ color: 0x9fe8ff, side: DoubleSide, transparent: true, opacity: 0.9 }),
  );
  marker.visible = false;
  marker.renderOrder = 2;
  scene.add(marker);

  const center = layout.spots.find((spot) => spot.id === 'stand_center') ?? layout.spots[0];
  const [x, z] = center ? standPoint(layout, center) : [0, 0];
  let state = startApproach(x, z, center?.heading ?? 0);
  let target: Vec3 | undefined;
  let seat: Seat | undefined;
  let mood: Mood = 'calm';
  let cheers = 0;
  let tracing = false;
  const frames: TraceFrame[] = [];
  let seated = 0;
  // An eager dart is a share of the run, not the run itself: the room is a few steps across.
  const measures = { ...body.metrics, runSpeed: Math.min(body.metrics.runSpeed, body.metrics.walkSpeed * 2.9) };
  return {
    update(dt, camera) {
      state = stepApproach(state, {
        dt,
        layout,
        body: measures,
        mood,
        cheer: cheers,
        ...(target ? { target } : {}),
        ...(seat ? { seat } : {}),
      });
      const intent = approachIntent(state, target);
      // The seat gives under the body: dropping onto it kicks the surface, and the body rides it.
      if (intent.seated > 0.55 && seated <= 0.55) soft.kick(2.2);
      seated = intent.seated;
      const sunk = soft.press(intent.seat, intent.seated, dt);
      // The room's marker is on the seat's surface; the hip joints rest a little above it (the
      // body sits on the surface, not in it), less what the surface has given.
      if (intent.seat)
        intent.seat = [intent.seat[0], intent.seat[1] + body.metrics.height * 0.06 - sunk, intent.seat[2]];
      body.update(intent, dt, layout.floorY, [camera.position.x, camera.position.y, camera.position.z]);
      if (tracing && frames.length < 20000)
        frames.push({
          t: state.t,
          phase: state.phase,
          speed: state.mover.speed,
          slide: body.facts().slide,
          ground: body.facts().groundSlide,
          feet: body.facts().feet,
          joints: body.joints(),
        });
      marker.visible = Boolean(target);
      if (target) {
        marker.position.set(target[0], target[1], target[2]);
        marker.quaternion.copy(camera.quaternion);
      }
    },
    setTarget(next) {
      target = next && next.every(Number.isFinite) ? [next[0], next[1], next[2]] : undefined;
    },
    sit(id) {
      const spot = id ? layout.spots.find((s) => s.id === id && s.kind === 'sit') : undefined;
      seat =
        spot && sit
          ? { x: spot.x, y: spot.y, z: spot.z, heading: spot.heading, stand: standPoint(layout, spot) }
          : undefined;
      return Boolean(seat);
    },
    setMood(next) {
      mood = next === 'interest' ? 'interest' : 'calm';
    },
    cheer() {
      cheers++;
    },
    state: () => ({ ...state, target }),
    facts: () => body.facts(),
    trace() {
      tracing = true;
      return frames.splice(0);
    },
    metrics: () => ({ ...body.metrics }),
  };
}
