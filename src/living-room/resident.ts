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
import { loadLivingBody, type LivingBodyFacts } from '../renderers/three/living-body';
import { approachIntent, startApproach, stepApproach, type ApproachState } from '../characters/approach';
import type { Vec3 } from '../characters/two-bone-ik';
import { standPoint, type RoomLayout } from '../world/room-life';

interface CharacterManifest {
  vrm: string;
  idle: string;
  walk: string;
}

export interface LivingResident {
  update(dt: number, camera: Camera): void;
  /** A point in the room's metres to notice, walk to and touch; undefined takes it away. */
  setTarget(target: Vec3 | undefined): void;
  state(): ApproachState & { target: Vec3 | undefined };
  facts(): LivingBodyFacts;
  metrics(): { arm: number; shoulderHeight: number; walkSpeed: number; height: number };
}

const bytes = async (url: URL) => {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`キャラクターの素材を読み込めませんでした：${url.pathname}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function loadLivingResident(scene: Scene, base: URL, layout: RoomLayout): Promise<LivingResident> {
  const folder = new URL('character/', base);
  const manifest = (await (
    await fetch(new URL('character.json', folder), { credentials: 'omit' })
  ).json()) as CharacterManifest;
  const file = (name: string) => {
    if (!/^[\w.-]{1,80}$/.test(name)) throw new Error('キャラクターの素材の名前が正しくありません。');
    return new URL(name, folder);
  };
  const [vrm, idle, walk] = await Promise.all([
    bytes(file(manifest.vrm)),
    bytes(file(manifest.idle)),
    bytes(file(manifest.walk)),
  ]);
  const prepared = prepareVerifiedSource(vrm, 'model/gltf-binary');
  if (!prepared.modelBuffer) throw new Error('キャラクターのモデルを検証できませんでした。');
  const body = await loadLivingBody(prepared.modelBuffer, { idle, walk });
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
  const limits = {
    maxSpeed: Math.min(0.9, body.metrics.walkSpeed),
    accel: body.metrics.walkSpeed * 1.5,
    decel: body.metrics.walkSpeed * 1.9,
    // A turn on the spot is made of small steps (foot-plant): faster than this the feet cannot keep up.
    turnRate: 2.1,
  };
  return {
    update(dt, camera) {
      state = stepApproach(state, { dt, layout, body: body.metrics, limits, ...(target ? { target } : {}) });
      body.update(approachIntent(state, target), dt, layout.floorY);
      marker.visible = Boolean(target);
      if (target) {
        marker.position.set(target[0], target[1], target[2]);
        marker.quaternion.copy(camera.quaternion);
      }
    },
    setTarget(next) {
      target = next && next.every(Number.isFinite) ? [next[0], next[1], next[2]] : undefined;
    },
    state: () => ({ ...state, target }),
    facts: () => body.facts(),
    metrics: () => ({ ...body.metrics }),
  };
}
