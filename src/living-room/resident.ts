// The character in the living room: loads a local VRM and its motions, and runs the behaviour
// (src/characters/approach.ts) and the body (src/renderers/three/living-body.ts) on the page's
// clock. The character's files are not part of the repository or of a public build: the build
// copies them only when WW_LIVING_CHARACTER names a local folder (docs/living-body.md).
//
// Its everyday life (docs/living-life.md): a day's script (life-script.ts) sends it between the
// desk chair and the bed; the phone routine (src/characters/phone-routine.ts) has it pick up its
// phone, put the earphones in, scroll and tap, carry the phone along and put it down. The chair
// gives (chair-give.ts, chair-rig.ts), the bed gives (soft-surface.ts), the screen lights the
// room and the face (screen-glow.ts, a point light), the cord hangs and swings (cord.ts).
import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SpotLight,
  Vector3,
  type Camera,
  type Object3D,
  type Scene,
} from 'three';
import { prepareVerifiedSource } from '../assets/verified-source';
import { loadLivingBody, type LivingBody, type LivingBodyFacts } from '../renderers/three/living-body';
import {
  approachIntent,
  startApproach,
  stepApproach,
  type ApproachState,
  type BodyIntent,
  type HandGoal,
  type Mood,
  type Seat,
} from '../characters/approach';
import {
  phoneIntent,
  startPhone,
  stepPhone,
  type HandAim,
  type HandPlace,
  type PhoneState,
} from '../characters/phone-routine';
import { makeCord, stepCord } from '../characters/cord';
import type { SoftSurface, Press } from './soft-surface';
import type { ScreenGlow } from './screen-glow';
import { startChair, stepChair, type ChairState } from './chair-give';
import { chairRig, type ChairRig } from './chair-rig';
import { phoneProp, PHONE_SIZE } from './phone-prop';
import { lifeOrders, startLife, stepLife, type LifeState, type Place } from './life-script';
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
  /** Its everyday life (the day's script) on or off. Off, it stays where `sit` puts it. */
  live(on: boolean): void;
  state(): ApproachState & { target: Vec3 | undefined };
  /** What the everyday life is doing (the test hook and the recordings). */
  life(): {
    step: string;
    phone: PhoneState['phase'];
    body: string;
    chair: ChairState;
    lit: boolean;
    /** Where the phone and the head are (the room's metres), the screen's facing. */
    phoneAt: Vec3;
    screenFacing: Vec3;
    head: Vec3;
  };
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

/** What of the room the life needs: its scene (for the `pose_` empties and the chair) and the
 * glow of small screens on its baked surfaces. */
export interface ResidentRoom {
  root: Object3D;
  glow: ScreenGlow;
}

const bytes = async (url: URL) => {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`キャラクターの素材を読み込めませんでした：${url.pathname}`);
  return new Uint8Array(await response.arrayBuffer());
};

/** How bright the phone's screen lights the character (its spot) and the room (screen-glow). */
const GLOW = { face: 1.0, room: 0.35 };

const v = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
const tuple = (p: Vector3): Vec3 => [p.x, p.y, p.z];

export async function loadLivingResident(
  scene: Scene,
  base: URL,
  layout: RoomLayout,
  soft: SoftSurface,
  room: ResidentRoom,
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

  // --- the everyday life's places -----------------------------------------------------------
  const scale = body.metrics.height / 1.19;
  const pose = (name: string) => {
    const o = room.root.getObjectByName(name);
    if (!o) return undefined;
    o.updateWorldMatrix(true, false);
    const at = o.getWorldPosition(new Vector3());
    const forward = new Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    return { at, heading: Math.atan2(forward.x, forward.z) };
  };
  const seatOf = (id: string): Seat | undefined => {
    const spot = layout.spots.find((s) => s.id === id && s.kind === 'sit');
    return spot && { x: spot.x, y: spot.y, z: spot.z, heading: spot.heading, stand: standPoint(layout, spot) };
  };
  const lieOn = pose('pose_lie_bed');
  const chairSeat = seatOf('sit_chair');
  const bedSeat = seatOf('sit_bed');
  const bedLie: Seat | undefined =
    bedSeat && lieOn
      ? { ...bedSeat, lie: { x: lieOn.at.x, y: lieOn.at.y, z: lieOn.at.z, heading: lieOn.heading } }
      : undefined;
  const rests: Record<Place, { at: Vector3; heading: number } | undefined> = {
    chair: pose('pose_phone_desk'),
    bed: pose('pose_phone_bed'),
  };
  const places: Record<Place, Seat | undefined> = { chair: chairSeat, bed: bedLie };
  const lifeReady = Boolean(chairSeat && bedLie && rests.chair && rests.bed);

  // --- the chair --------------------------------------------------------------------------
  const chairMesh = room.root.getObjectByName('tex_chair') as Mesh | undefined;
  const chair: ChairRig | undefined = chairMesh?.isMesh ? chairRig(chairMesh) : undefined;
  let chairState = startChair();

  // --- the phone, its earphones and the cord ---------------------------------------------------
  const phone = phoneProp();
  scene.add(phone.root);
  let phoneState = startPhone();
  const cord = makeCord([0, 1, 0], { main: 0.42 * scale, branch: 0.3 * scale });
  // The screen's light on the face, the hands and the hair (the character is lit by lamps). A
  // point light at the screen itself would burn out the hands holding it (they are a few
  // centimetres away) long before it reached the face: the light starts a little behind the phone
  // and shines out through it, in a wide cone, so the hands and the face get about the same.
  const screenLight = new SpotLight(0xb8c8ff, 0, 2.4, 0.75, 1, 2);
  scene.add(screenLight, screenLight.target);
  let lifeState: LifeState = startLife();
  let living = lifeReady;

  const center = layout.spots.find((spot) => spot.id === 'stand_center') ?? layout.spots[0];
  const [x, z] = center ? standPoint(layout, center) : [0, 0];
  let state = startApproach(x, z, center?.heading ?? 0);
  let target: Vec3 | undefined;
  let seat: Seat | undefined;
  let mood: Mood = 'calm';
  let cheers = 0;
  let tracing = false;
  const frames: TraceFrame[] = [];
  let seated = 0,
    landed = 0,
    lastThumb = 0,
    smileUntil = 0,
    smileDraws = 0,
    clock = 0;
  // An eager dart is a share of the run, not the run itself: the room is a few steps across.
  const measures = { ...body.metrics, runSpeed: Math.min(body.metrics.runSpeed, body.metrics.walkSpeed * 2.9) };

  const p1 = new Vector3(),
    p2 = new Vector3(),
    p3 = new Vector3();
  const up = new Vector3(0, 1, 0);
  const budAt = { left: new Vector3(), right: new Vector3() };

  /** A place a hand goes to, with the way its palm and fingers point there. */
  const placeOf = (place: HandPlace, intent: BodyIntent): { at: Vector3; palm: Vector3; fingers: Vector3 } => {
    const head = body.head();
    const headAt = v(head.at);
    const ahead = new Vector3(Math.sin(intent.heading), 0, Math.cos(intent.heading));
    const leftward = new Vector3(Math.cos(intent.heading), 0, -Math.sin(intent.heading));
    const lying = intent.lie > 0.5;
    const restAt = rests[lifeOrders(lifeState).restAt];
    switch (place) {
      case 'rest': {
        const at = (restAt?.at.clone() ?? headAt.clone()).add(p1.set(0, 0.03, 0));
        // Down onto it, the fingers the way from the body to it.
        const fingers = at.clone().sub(headAt).setY(0);
        if (fingers.lengthSq() < 1e-6) fingers.copy(ahead);
        return { at, palm: new Vector3(0, -1, 0), fingers: fingers.normalize() };
      }
      case 'view':
      case 'grip': {
        // In front of the face, a little low: sitting, at the chest. Lying on the front, ahead of
        // the face near the bed. On the back, held up over the face, its top past the head.
        const onBack = lying ? intent.roll : 0;
        const front = lying
          ? headAt
              .clone()
              .addScaledVector(ahead, 0.2 * scale)
              .setY(Math.max(headAt.y - 0.1 * scale, (intent.lieAt?.[1] ?? 0) + 0.08 * scale))
          : headAt
              .clone()
              .addScaledVector(ahead, 0.25 * scale)
              .addScaledVector(up, -0.17 * scale);
        // On the back: over the chin, a forearm's height up, the elbows bent at the sides.
        const above = headAt
          .clone()
          .addScaledVector(up, 0.17 * scale)
          .addScaledVector(ahead, -0.14 * scale);
        const at = front.lerp(above, onBack);
        // The right hand a little right, the second hand beside it. (On the back, the body's
        // left is the other way round as seen from above: `leftward` is the standing body's.)
        at.addScaledVector(leftward, (place === 'grip' ? 0.035 : -0.012) * scale * (1 - 2 * onBack));
        const palm = headAt.clone().sub(at).normalize();
        // (On the back the phone's top points past the head and tips up a little toward the eyes.)
        const fingers = up
          .clone()
          .addScaledVector(ahead, lying ? 0.15 : 0.35)
          .normalize()
          .lerp(ahead.clone().addScaledVector(up, 0.45).normalize(), onBack)
          .normalize();
        return { at, palm, fingers };
      }
      case 'budL':
      case 'budR': {
        const at = (place === 'budL' ? budAt.left : budAt.right).clone();
        return { at, palm: headAt.clone().sub(at).normalize(), fingers: up.clone() };
      }
      case 'earL':
      case 'earR': {
        const s = place === 'earL' ? 1 : -1;
        const ear = headAt
          .clone()
          .addScaledVector(v(head.left), s * 0.058 * scale)
          .addScaledVector(v(head.up), 0.005);
        // The hand just outside the ear, palm in.
        const at = ear.clone().addScaledVector(v(head.left), s * 0.03 * scale);
        return { at, palm: v(head.left).multiplyScalar(-s), fingers: v(head.up) };
      }
      case 'free':
        // (Never weighted in: a free hand is the motion's own.)
        return { at: headAt, palm: new Vector3(0, -1, 0), fingers: ahead };
    }
  };
  const goalOf = (aim: HandAim, intent: BodyIntent): HandGoal | undefined => {
    if (aim.weight <= 1e-3) return undefined;
    const a = placeOf(aim.from, intent),
      b = placeOf(aim.to, intent);
    const k = aim.k * aim.k * (3 - 2 * aim.k);
    // On the way between two places the hand passes a little up (an arc, not a slide).
    const arc = Math.sin(Math.PI * k) * (aim.from === aim.to ? 0 : 0.05);
    const at = a.at.lerp(b.at, k).addScaledVector(up, arc);
    return {
      at: tuple(at),
      weight: aim.weight,
      palm: tuple(a.palm.lerp(b.palm, k).normalize()),
      fingers: tuple(a.fingers.lerp(b.fingers, k).normalize()),
      grip: aim.grip,
    };
  };
  /** Bed and desk tops and the floor: what the cord comes to rest on. */
  const groundAt = (gx: number, gz: number) => {
    let y = layout.floorY;
    if (lieOn) {
      const dx = gx - lieOn.at.x,
        dz = gz - lieOn.at.z;
      const along = dx * Math.sin(lieOn.heading) + dz * Math.cos(lieOn.heading),
        across = dx * Math.cos(lieOn.heading) - dz * Math.sin(lieOn.heading);
      if (Math.abs(across) < 0.68 && along > -1.45 && along < 0.95) y = Math.max(y, lieOn.at.y - 0.02);
    }
    const desk = rests.chair;
    if (desk && Math.hypot(gx - desk.at.x, gz - desk.at.z) < 0.4) y = Math.max(y, desk.at.y);
    return y;
  };

  return {
    update(dt, camera) {
      clock += dt;
      // The day's script: where to be, what the phone is for. A thing to notice comes first: the
      // phone is kept in hand (not used) while it is seen to.
      const orders = lifeOrders(lifeState);
      if (living) seat = target ? undefined : places[orders.seat ?? 'chair'];
      phoneState = stepPhone(phoneState, {
        dt,
        use: living && !target && orders.use,
        buds: orders.buds,
        hold: living && (Boolean(target) || orders.hold),
      });
      const held = phoneIntent(phoneState);
      state = stepApproach(state, {
        dt,
        layout,
        body: measures,
        mood,
        cheer: cheers,
        ...(target ? { target } : {}),
        ...(seat ? { seat } : {}),
      });
      if (living)
        lifeState = stepLife(
          lifeState,
          {
            body: state.phase,
            phone: phoneState.phase,
            budsIn: phoneState.budL === 'ear' && phoneState.budR === 'ear',
          },
          dt,
        );
      const intent = approachIntent(state, target);
      const onChair = Boolean(
        seat && chairSeat && !seat.lie && Math.hypot(seat.x - chairSeat.x, seat.z - chairSeat.z) < 0.05,
      );

      // The chair under a seated body: a drop onto it kicks it; the body rides its seat.
      if (chair) {
        const drop = onChair && intent.seated > 0.55 && seated <= 0.55;
        chairState = stepChair(chairState, {
          dt,
          seated: onChair ? intent.seated : 0,
          ...(drop ? { impact: 1.4 } : {}),
          lean: onChair && held.look > 0.5 ? 0.6 : 0.2,
        });
        chair.update(chairState);
      }
      // The bed under a body that sits on it or lies on it.
      let sunk = 0;
      if (intent.lieAt && intent.lie > 0.01) {
        if (intent.landed > 0.5 && landed <= 0.5) soft.kick(3.4);
        const at = intent.lieAt;
        const d = [Math.sin(intent.heading), Math.cos(intent.heading)] as const,
          s = [Math.cos(intent.heading), -Math.sin(intent.heading)] as const;
        const along = (k: number, side = 0): Press['at'] => [
          at[0] + d[0] * k * scale + s[0] * side * scale,
          at[1],
          at[2] + d[1] * k * scale + s[1] * side * scale,
        ];
        // The legs swing up from the knees: a lifted knee presses less.
        const knee = 0.55 * (1 - 0.4 * intent.kickLegs);
        const contacts: Press[] = [
          { at: along(0) },
          { at: along(-0.16) },
          { at: along(-0.3), share: 0.9 },
          { at: along(-0.45), share: 0.6 },
          { at: along(-0.58), share: knee },
          { at: along(0.17, 0.13), share: 0.45 },
          { at: along(0.17, -0.13), share: 0.45 },
        ];
        sunk = soft.press(contacts, intent.lie, dt);
        intent.lieAt = [at[0], at[1] - sunk, at[2]];
      } else if (!onChair) {
        if (intent.seated > 0.55 && seated <= 0.55) soft.kick(2.2);
        sunk = soft.press(intent.seat, intent.seated, dt);
      } else soft.press(undefined, 0, dt);
      landed = intent.landed;
      seated = intent.seated;
      // The room's marker is on the seat's surface; the hip joints rest a little above it (the
      // body sits on the surface, not in it), less what the surface has given.
      if (intent.seat) {
        const rest: Vec3 = [intent.seat[0], intent.seat[1] + body.metrics.height * 0.06 - sunk, intent.seat[2]];
        intent.seat = onChair && chair ? chair.carry([rest[0], rest[1] - chairState.drop, rest[2]]) : rest;
      }

      // The phone in the hands: where each hand goes, the thumb, the eyes on the screen.
      const hold: NonNullable<BodyIntent['hold']> = {};
      const leftGoal = goalOf(held.left, intent),
        rightGoal = goalOf(held.right, intent);
      if (leftGoal) hold.left = leftGoal;
      if (rightGoal) hold.right = rightGoal;
      // (While a thing in the room is being touched, the arm is the touch's: the phone waits.)
      if (!(intent.reach && intent.reachWeight !== 0)) intent.hold = hold;
      intent.thumb = held.thumb;
      if (held.look > intent.lookWeight && phone.frame.at.lengthSq() > 0) {
        intent.look = tuple(phone.frame.at);
        intent.lookWeight = held.look;
      }
      // Now and then something on the screen makes it smile (and its tail wag).
      const tapped = held.thumb > 0.5 && lastThumb <= 0.5;
      lastThumb = held.thumb;
      if (tapped && (smileDraws++ * 0.618) % 1 < 0.3) smileUntil = clock + 1.6;
      if (clock < smileUntil) intent.joy = Math.max(intent.joy, 0.75);

      body.update(intent, dt, layout.floorY, [camera.position.x, camera.position.y, camera.position.z]);

      // The phone where it is: in the right hand, or on its rest.
      if (held.phone === 'hand') {
        const hand = body.hand('right');
        const fingers = v(hand.fingers),
          palm = v(hand.palm);
        phone.place(
          v(hand.wrist)
            .addScaledVector(fingers, PHONE_SIZE.height * 0.5)
            .addScaledVector(palm, 0.011 * scale),
          fingers,
          palm,
        );
      } else {
        const rest = rests[lifeOrders(lifeState).restAt] ?? rests.chair;
        if (rest)
          phone.place(
            p1.copy(rest.at).add(p2.set(0, PHONE_SIZE.depth / 2 + 0.002, 0)),
            p3.set(Math.sin(rest.heading), 0, Math.cos(rest.heading)),
            up,
          );
      }
      // The buds: on the phone, in the left hand's fingers, or in the ears.
      const head = body.head();
      for (const [side, holder] of [
        [1, held.budL],
        [-1, held.budR],
      ] as const) {
        const at = side > 0 ? budAt.left : budAt.right;
        let out: Vector3;
        if (holder === 'ear') {
          at.copy(v(head.at))
            .addScaledVector(v(head.left), side * 0.056 * scale)
            .addScaledVector(v(head.up), 0.005);
          out = v(head.left).multiplyScalar(side);
        } else if (holder === 'hand') {
          const hand = body.hand('left');
          at.copy(v(hand.wrist))
            .addScaledVector(v(hand.fingers), 0.07 * scale)
            .addScaledVector(v(hand.palm), 0.012);
          out = v(hand.palm).negate();
        } else {
          phone.budHome(side, at);
          out = phone.frame.facing.clone();
        }
        phone.placeBud(side, at, out);
      }
      stepCord(
        cord,
        dt,
        new Map([
          [cord.jack, tuple(phone.jack(p1))],
          [cord.budL, tuple(budAt.left)],
          [cord.budR, tuple(budAt.right)],
        ]),
        groundAt,
      );
      phone.drawCord(cord);

      // The screen's light: on the character (a lamp) and on the room's baked surfaces.
      const light = phone.screen(held.screen, tapped, dt);
      if (light.power > 0.01) {
        const at = p1.copy(phone.frame.at).addScaledVector(phone.frame.facing, 0.03);
        screenLight.position.copy(phone.frame.at).addScaledVector(phone.frame.facing, -0.4);
        screenLight.target.position.copy(phone.frame.at).addScaledVector(phone.frame.facing, 1);
        screenLight.target.updateMatrixWorld();
        screenLight.color.copy(light.color);
        screenLight.intensity = GLOW.face * light.power;
        room.glow.set(0, at, phone.frame.facing, light.color, GLOW.room * light.power);
      } else {
        screenLight.intensity = 0;
        room.glow.off(0);
      }

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
      living = false;
      const spot = id ? layout.spots.find((s) => s.id === id && s.kind === 'sit') : undefined;
      seat =
        spot && sit
          ? { x: spot.x, y: spot.y, z: spot.z, heading: spot.heading, stand: standPoint(layout, spot) }
          : undefined;
      if (id === 'lie_bed' && bedLie) seat = bedLie;
      return Boolean(seat);
    },
    live(on) {
      // Stopped, it is left where it is, standing: not sent on to the place the day had chosen.
      if (living && !on) seat = undefined;
      living = on && lifeReady;
    },
    setMood(next) {
      mood = next === 'interest' ? 'interest' : 'calm';
    },
    cheer() {
      cheers++;
    },
    state: () => ({ ...state, target }),
    life: () => ({
      step: lifeOrders(lifeState).step,
      phone: phoneState.phase,
      body: state.phase,
      chair: { ...chairState },
      lit: room.glow.lit,
      phoneAt: tuple(phone.frame.at),
      screenFacing: tuple(phone.frame.facing),
      head: body.head().at,
    }),
    facts: () => body.facts(),
    trace() {
      tracing = true;
      return frames.splice(0);
    },
    metrics: () => ({ ...body.metrics }),
  };
}
