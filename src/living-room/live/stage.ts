/**
 * The room as a live (docs/living-live.md). The player's card hangs in the room as a screen (the
 * page puts the card where this says the camera sees it), and the room around it becomes the
 * place the picture is shown in:
 *
 *   the house lights    the room's own baked light goes down
 *   the picture's light its left, middle and right light the room from the screen as three
 *                       lamps (the furniture catches them by its own colour and facing); the
 *                       resident is lit from behind by the screen's two sides
 *   the spill           the picture's edges run on over the floor, the ceiling and the two side
 *                       walls: the same small copy of the frame the light is read from, drawn
 *                       stretched away from the screen and fading, so what is at the picture's
 *                       edge is what lies on the room beside it
 *   a glow              the same copy, soft, behind the screen and wider than it
 *   beams               from above the screen, in the colours of the picture's top edge, when
 *                       the music is lively; they lean with the beat
 *   the view            two places to watch from: near (the screen fills the view, the
 *                       resident's head and shoulders before it) and back (the whole room, the
 *                       resident dancing in it)
 *
 * Nothing here is drawn over the picture: the player is a card of the page and always in front.
 * The light follows the picture only (frame-light.ts softens it); the beat moves the beams, the
 * camera and the resident, never the room's light.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  RGBAFormat,
  Raycaster,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type Box3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { ScreenGlow } from '../screen-glow';
import { GRID_H, GRID_W, type FrameLight } from './frame-light';
import type { Point } from './homography';
import type { LiveViewName } from './player';

export interface LiveStageEnv {
  scene: Scene;
  glow: ScreenGlow;
  /** The room's walls and floor (their box, and the meshes themselves to find their faces by). */
  shell: Box3;
  shellMeshes: readonly Object3D[];
  /** The wall and ceiling the page added (unlit): they go down with the house lights. */
  added: readonly Object3D[];
  floorY: number;
  /** Whether there is a resident to light. */
  resident: boolean;
}

export interface LiveView {
  position: Vector3;
  target: Vector3;
  fov: number;
}

export interface LiveStage {
  /** 0 the room as it is, 1 a live (eased). */
  readonly amount: number;
  /** Where the camera goes for a view. */
  /** `low`: the resident is off its feet (sitting, lying): the near view takes in the floor. */
  view(name: LiveViewName, low?: boolean): LiveView;
  /** The screen's size and the room's inner faces, metres (for the checks). */
  readonly metrics: Record<'width' | 'height' | 'bottom' | 'top' | 'leftX' | 'rightX' | 'floorY', number>;
  /** Where the resident stands, facing the screen, and what it watches. */
  readonly spot: { x: number; z: number; heading: number };
  /** Where it lies on the floor when it is worn out (its chest; its head toward the screen). */
  readonly rest: { x: number; z: number; heading: number };
  readonly look: [number, number, number];
  /** The screen's four corners on the page (top-left, top-right, bottom-right, bottom-left). */
  corners(camera: PerspectiveCamera): [Point, Point, Point, Point] | undefined;
  /**
   * One frame: `on` is live mode, `light` the picture's light (eased), `cells` the picture itself
   * (GRID_W × GRID_H RGBA bytes), `energy` and `pulse` and `beat` the music.
   */
  update(
    dt: number,
    input: {
      on: boolean;
      light: FrameLight;
      cells: Uint8ClampedArray | undefined;
      energy: number;
      pulse: number;
      beat: number;
    },
  ): void;
}

/** How strongly each part shows. Set by eye on the real page, on real videos. */
/** (The house lights go nearly out: the room is what the picture's light finds of it.) */
const GAIN = {
  lamps: 1.7,
  spill: 0.36,
  halo: 0.3,
  beam: 0.2,
  body: 2.2,
  fill: 0.5,
  over: 0.7,
  under: 0.45,
  house: 0.16,
};
/**
 * Going into a live is a sequence, not a fade (0–1 of `amount`): the house lights go down first,
 * and only in the dark does the picture's light come up in the room. Coming out, the same in
 * reverse: the picture's light leaves, then the room's own returns.
 */
const HOUSE_DOWN_BY = 0.6;
const PICTURE_FROM = 0.4;
const smooth = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
};
/** Metres from the room's middle to the screen (it hangs before the desk), and its bottom edge. */
const SCREEN_Z = -0.95;
const SCREEN_BOTTOM = 1.12;
const BEAMS = 6;

/** A flat panel whose corners carry how much it shows (it is drawn added to the room). */
function spill(
  corner: (s: number, t: number) => [number, number, number],
  uv: (s: number, t: number) => [number, number],
  fade: (s: number, t: number) => number,
  map: DataTexture,
) {
  const S = 16,
    T = 8;
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [],
    index: number[] = [];
  for (let j = 0; j <= T; j++)
    for (let i = 0; i <= S; i++) {
      const s = i / S,
        t = j / T;
      positions.push(...corner(s, t));
      uvs.push(...uv(s, t));
      const k = Math.max(0, fade(s, t));
      colors.push(k, k, k);
    }
  for (let j = 0; j < T; j++)
    for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i;
      index.push(a, a + 1, a + S + 2, a, a + S + 2, a + S + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

export function liveStage(env: LiveStageEnv): LiveStage {
  const { scene, glow, shell, floorY } = env;
  // --- where things are -------------------------------------------------------------------------
  // The room's inner faces: a ray from the room's middle to each side, against its walls only.
  const ray = new Raycaster();
  const inner = (direction: Vector3, fallback: number) => {
    ray.set(new Vector3(0, floorY + Math.min(2.1, shell.max.y - floorY - 0.25), 0.6), direction);
    const hit = ray.intersectObjects(env.shellMeshes as Object3D[], false)[0];
    return hit ? hit.distance : fallback;
  };
  const leftX = -inner(new Vector3(-1, 0, 0), -shell.min.x - 0.1) + 0.02;
  const rightX = shell.max.x - 0.02;
  const top = shell.max.y - 0.02;
  // The screen: as tall as the room lets it be over the desk, 16:9, in the middle.
  const bottom = floorY + SCREEN_BOTTOM;
  const height = Math.max(0.9, Math.min(1.6, top - 0.1 - bottom));
  const width = (height * 16) / 9;
  const midY = bottom + height / 2;
  const frontZ = Math.min(shell.max.z, SCREEN_Z + 4.2);
  const corners3 = [
    new Vector3(-width / 2, bottom + height, SCREEN_Z),
    new Vector3(width / 2, bottom + height, SCREEN_Z),
    new Vector3(width / 2, bottom, SCREEN_Z),
    new Vector3(-width / 2, bottom, SCREEN_Z),
  ];
  const views: Record<LiveViewName, LiveView> = {
    // Near: from above head height, looking a little down. The screen fills the upper half and
    // more of the view; under its bottom edge is the floor before it, and the resident on it
    // (it is small: its ears come just under the screen's edge).
    stage: {
      position: new Vector3(0.15, bottom + height * 0.52, SCREEN_Z + height * 2.12),
      target: new Vector3(0, bottom + height * 0.13, SCREEN_Z),
      fov: 50,
    },
    // Back and higher: the room as a hall, the resident whole on the floor before the screen.
    floor: {
      position: new Vector3(0.9, bottom + height * 0.7, SCREEN_Z + height * 3.35),
      target: new Vector3(0.1, bottom + 0.03, SCREEN_Z + 0.35),
      fov: 46,
    },
  };
  // Near, but with the resident sitting or lying on the floor: a step back and higher, tipped
  // down, so the screen keeps the top of the view and the floor before it (and who is on it)
  // comes into the bottom. The camera eases between the two as it gets down and up.
  const stageLow: LiveView = {
    position: new Vector3(0.2, bottom + height * 0.78, SCREEN_Z + height * 2.55),
    target: new Vector3(0.05, bottom - height * 0.2, SCREEN_Z + 0.2),
    fov: 54,
  };
  // The resident: on the floor before the screen, a little to one side of its middle.
  const spot = { x: 0.5, z: SCREEN_Z + 0.85, heading: 0 };
  spot.heading = Math.atan2(0 - spot.x, SCREEN_Z - spot.z);
  // Worn out, it lies a step further back, on the rug, its head to the screen: far enough from
  // the screen to look up at it, near enough to be under its light.
  const rest = { x: 0.45, z: SCREEN_Z + 1.3, heading: 0 };
  rest.heading = Math.atan2(0 - rest.x, SCREEN_Z - rest.z);

  // --- the picture, small -----------------------------------------------------------------------
  const pixels = new Uint8Array(GRID_W * GRID_H * 4);
  const frame = new DataTexture(pixels, GRID_W, GRID_H, RGBAFormat, UnsignedByteType);
  frame.colorSpace = SRGBColorSpace;
  frame.magFilter = frame.minFilter = LinearFilter;
  frame.needsUpdate = true;
  // (The texture's first row is the picture's top row: v = 0 is the top, v = 1 the bottom.)
  const depth = frontZ - SCREEN_Z;
  const wide = width * 0.5 + 0.9;
  const sides = (s: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, s))) ** 0.5;
  const away = (t: number) => (1 - t) ** 1.7;
  const parts: Mesh[] = [
    // The floor before the screen: the picture's bottom edge, running toward the viewer.
    spill(
      // (Over the rug too: a little above the floor, so the rug does not cut a hole in it.)
      (s, t) => [-wide + 2 * wide * s, floorY + 0.055, SCREEN_Z + depth * t],
      (s, t) => [0.5 + (s - 0.5) * (1 + 0.25 * (1 - t)), 0.97 - 0.3 * t],
      (s, t) => 0.55 * away(t) * sides(s) * Math.min(1, t * 6),
      frame,
    ),
    // The ceiling: its top edge.
    spill(
      (s, t) => [-wide + 2 * wide * s, top - 0.02, SCREEN_Z + depth * t],
      (s, t) => [0.5 + (s - 0.5) * (1 + 0.25 * (1 - t)), 0.03 + 0.3 * t],
      (s, t) => 0.45 * away(t) * sides(s),
      frame,
    ),
    // The walls on either side: its left and right edges.
    spill(
      (s, t) => [leftX, floorY + (top - floorY) * (1 - s), SCREEN_Z + depth * t],
      (s, t) => [0.03 + 0.28 * t, s],
      (s, t) => 0.9 * away(t) * (0.35 + 0.65 * sides(s)),
      frame,
    ),
    spill(
      (s, t) => [rightX, floorY + (top - floorY) * (1 - s), SCREEN_Z + depth * t],
      (s, t) => [0.97 - 0.28 * t, s],
      (s, t) => 0.9 * away(t) * (0.35 + 0.65 * sides(s)),
      frame,
    ),
  ];
  // A glow behind the screen, wider than it: the picture, out of focus.
  const halo = spill(
    (s, t) => [(s - 0.5) * width * 1.9, midY + (0.5 - t) * height * 1.9, SCREEN_Z - 0.03],
    (s, t) => [s, t],
    (s, t) => sides(s) ** 2 * sides(t) ** 2,
    frame,
  );
  // And the back of the screen itself, black: what is behind the player is the dark of a stage.
  const back = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ color: 0x000000 }));
  back.position.set(0, midY, SCREEN_Z - 0.01);
  back.visible = false;
  scene.add(...parts, halo, back);

  // --- beams ------------------------------------------------------------------------------------
  const beamGeometry = (() => {
    // A long thin wedge, bright at its source and gone at its end; two of them crossed, so it
    // has some body from any side.
    const geometry = new BufferGeometry();
    const positions: number[] = [],
      colors: number[] = [],
      uvs: number[] = [],
      index: number[] = [];
    const L = 3.2,
      STEPS = 6;
    [0, Math.PI / 2].forEach((turn, n) => {
      const c = Math.cos(turn),
        s = Math.sin(turn);
      const base = n * (STEPS + 1) * 2;
      for (let j = 0; j <= STEPS; j++) {
        const t = j / STEPS;
        // (It widens as it goes and is gone well before its end: light thinning out in air.)
        const half = 0.04 + 0.15 * t,
          k = (1 - t) ** 2.4;
        for (const side of [-1, 1]) {
          positions.push(side * half * c, -L * t, side * half * s);
          colors.push(k, k, k);
          uvs.push(side < 0 ? 0 : 1, 0.5);
        }
        if (j < STEPS) {
          const a = base + j * 2;
          index.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
      }
    });
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    return geometry;
  })();
  // (Soft across its width: bright down its middle, nothing at its edges.)
  const soft = new DataTexture(
    Uint8Array.from({ length: 32 * 4 }, (_, i) => {
      const x = ((i >> 2) + 0.5) / 32;
      return i % 4 === 3 ? 255 : Math.round(255 * Math.sin(Math.PI * x) ** 3);
    }),
    32,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  soft.magFilter = soft.minFilter = LinearFilter;
  soft.needsUpdate = true;
  const beams = Array.from({ length: BEAMS }, (_, i) => {
    const mesh = new Mesh(
      beamGeometry,
      new MeshBasicMaterial({
        map: soft,
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    // Along the top of the screen, a little before it.
    mesh.position.set((i / (BEAMS - 1) - 0.5) * width * 1.1, top - 0.06, SCREEN_Z + 0.2);
    mesh.renderOrder = 3;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

  // --- lamps for the resident -------------------------------------------------------------------
  const lampL = new PointLight(0xffffff, 0, 7, 1.6),
    lampR = new PointLight(0xffffff, 0, 7, 1.6);
  lampL.position.set(-width * 0.36, midY, SCREEN_Z + 0.25);
  lampR.position.set(width * 0.36, midY, SCREEN_Z + 0.25);
  // What comes back off the room at it from the viewer's side: a little, in the picture's colour.
  const fill = new DirectionalLight(0xffffff, 0);
  fill.position.set(0.4, 1.8, 6);
  // The picture's top edge from above and behind (a rim on the head and shoulders), its bottom
  // edge up off the floor before the screen: the body stands in the picture's light, not in
  // front of a lamp.
  const over = new DirectionalLight(0xffffff, 0),
    under = new DirectionalLight(0xffffff, 0);
  over.position.set(0, 4, SCREEN_Z - 1.2);
  under.position.set(0, -2.5, SCREEN_Z + 0.4);
  for (const lamp of [over, under]) lamp.target.position.set(0, midY - 0.6, SCREEN_Z + 1);
  if (env.resident) scene.add(lampL, lampR, fill, fill.target, over, over.target, under, under.target);

  const added = env.added.map((object) => (object as Mesh).material as Material & { color: Color });
  const slotAt = [-1, 0, 1].map((k) => new Vector3(k * width * 0.34, midY, SCREEN_Z + 0.05));
  const ahead = new Vector3(0, -0.12, 1).normalize();
  const tint = new Color();
  const projected = new Vector3();
  let amount = 0;
  let energy = 0;

  return {
    get amount() {
      return amount;
    },
    view: (name, low) => (low && name === 'stage' ? stageLow : views[name]),
    metrics: { width, height, bottom, top, leftX, rightX, floorY },
    spot,
    rest,
    look: [0, midY, SCREEN_Z],
    corners(camera) {
      const out: Point[] = [];
      for (const corner of corners3) {
        projected.copy(corner).project(camera);
        // (Behind the eye: no screen to show.)
        if (projected.z > 1 || projected.z < -1) return undefined;
        out.push([((projected.x + 1) / 2) * window.innerWidth, ((1 - projected.y) / 2) * window.innerHeight]);
      }
      return out as [Point, Point, Point, Point];
    },
    update(dt, input) {
      const target = input.on ? 1 : 0;
      amount += (target - amount) * (1 - Math.exp(-(input.on ? 1.5 : 2.2) * dt));
      if (Math.abs(target - amount) < 0.002) amount = target;
      energy += (input.energy - energy) * (1 - Math.exp(-dt / 0.6));
      const shown = amount > 0.004;
      for (const part of parts) part.visible = shown;
      halo.visible = back.visible = shown;
      // The house lights, first; the picture's light after them.
      const house = 1 - (1 - GAIN.house) * smooth(amount / HOUSE_DOWN_BY);
      const picture = smooth((amount - PICTURE_FROM) / (1 - PICTURE_FROM));
      glow.dim(house);
      for (const material of added) material.color.setScalar(house);
      if (!shown) {
        for (const beam of beams) beam.visible = false;
        lampL.intensity = lampR.intensity = fill.intensity = over.intensity = under.intensity = 0;
        return;
      }
      if (input.cells) {
        pixels.set(input.cells);
        frame.needsUpdate = true;
      }
      const { light } = input;
      // The picture's light in the room: three lamps at the screen, each third's colour.
      (
        [
          [1, light.left],
          [2, light.centre],
          [3, light.right],
        ] as const
      ).forEach(([slot, c], i) => {
        tint.setRGB(c[0], c[1], c[2]);
        glow.set(slot, slotAt[i]!, ahead, tint, GAIN.lamps * picture);
      });
      // The middle lamp is where the picture's own light is: a singer in a spot at the left of
      // the frame lights the room from the left of the screen, a sunset low in it from low down.
      slotAt[1]!.set(light.focus[0] * width * 0.34, midY + light.focus[1] * height * 0.32, SCREEN_Z + 0.05);
      glow.off(4);
      for (const part of parts) (part.material as MeshBasicMaterial).color.setScalar(GAIN.spill * picture);
      (halo.material as MeshBasicMaterial).color.setScalar(GAIN.halo * picture);
      lampL.color.setRGB(light.left[0], light.left[1], light.left[2]);
      lampR.color.setRGB(light.right[0], light.right[1], light.right[2]);
      // (The two side lamps lean with the picture's light too: the brighter side is the nearer.)
      lampL.position.y = lampR.position.y = midY + light.focus[1] * height * 0.3;
      lampL.intensity = GAIN.body * picture * (1 - 0.35 * light.focus[0]);
      lampR.intensity = GAIN.body * picture * (1 + 0.35 * light.focus[0]);
      fill.color.setRGB(light.all[0], light.all[1], light.all[2]);
      fill.intensity = GAIN.fill * picture;
      over.color.setRGB(light.top[0], light.top[1], light.top[2]);
      under.color.setRGB(light.bottom[0], light.bottom[1], light.bottom[2]);
      over.intensity = GAIN.over * picture;
      under.intensity = GAIN.under * picture;

      // Beams: only to lively music; each takes the colour over it at the picture's top, and
      // they lean one way and the other with the beat.
      const lively = Math.max(0, (energy - 0.35) / 0.4);
      const power = GAIN.beam * picture * Math.min(1, lively) * (0.55 + 0.45 * input.pulse);
      beams.forEach((beam, i) => {
        beam.visible = power > 0.01;
        if (!beam.visible) return;
        const column = Math.round((i / (BEAMS - 1)) * (GRID_W - 1));
        const at = (GRID_W + column) * 4;
        // (sRGB bytes to light. The beam keeps the picture's hue at a brightness of its own, but
        // a dark picture gives dim beams: they are its light, not a show beside it.)
        tint.setRGB(pixels[at]! / 255, pixels[at + 1]! / 255, pixels[at + 2]! / 255, SRGBColorSpace);
        const dim = Math.max(tint.r, tint.g, tint.b, 1e-3);
        const shown = Math.min(1, 0.25 + 2.2 * Math.max(dim, input.light.level));
        (beam.material as MeshBasicMaterial).color.copy(tint).multiplyScalar((power * shown) / Math.max(0.3, dim));
        const fan = (i / (BEAMS - 1) - 0.5) * 2;
        // Fanned out to the sides and tipped toward the viewer; half a turn of sway every two beats.
        beam.rotation.set(
          -0.5 - 0.18 * Math.sin(input.beat * Math.PI * 0.5 + i * 1.3),
          0,
          fan * 0.75 + 0.22 * Math.sin(input.beat * Math.PI * 0.5 + i * 0.9),
        );
      });
    },
  };
}
