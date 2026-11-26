// The resident's phone, its wired earphones and the cord between them (docs/living-life.md).
// Built here from a few primitives (nothing loaded): the phone a dark slab with a screen that
// draws a scrolling feed of its own, the buds two small white pods, the cord a thin tube whose
// points the cord physics (src/characters/cord.ts) moves. The screen's average colour is what it
// lights the room and the face with.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  CylinderGeometry,
} from 'three';
import { draw } from '../world/room-life';
import type { Cord } from '../characters/cord';

const vec = (c: Color) => new Vector3(c.r, c.g, c.b);

/** Sized for the resident's small hands (it is about 1.2 m tall). */
export const PHONE_SIZE = { width: 0.058, height: 0.12, depth: 0.008 } as const;
const SCREEN_W = 96,
  SCREEN_H = 192;

export interface PhoneProp {
  readonly root: Group;
  /** Puts the phone: its middle, the way its top points, the way its screen faces. */
  place(at: Vector3, up: Vector3, facing: Vector3): void;
  /** The phone's own frame as last placed. */
  readonly frame: { at: Vector3; up: Vector3; facing: Vector3; side: Vector3 };
  /** Where the cord leaves the phone (its bottom edge). */
  jack(out: Vector3): Vector3;
  /** Where a bud sits when it rests on the phone (beside the jack). */
  budHome(side: -1 | 1, out: Vector3): Vector3;
  /** Puts a bud: where it is, and the way it points (out of the ear). */
  placeBud(side: -1 | 1, at: Vector3, out: Vector3): void;
  /** Redraws the cord tube from the cord's points. */
  drawCord(cord: Cord): void;
  /**
   * The screen this frame: `level` 0 dark to 1 on, `tap` a touch (the feed jumps on). Returns its
   * light: the average colour and how bright (0 when dark).
   */
  screen(level: number, tap: boolean, dt: number): { color: Color; power: number };
}

export function phoneProp(seed = 3): PhoneProp {
  const root = new Group();
  root.name = 'resident_phone';
  const phone = new Group();
  const body = new Mesh(
    new BoxGeometry(PHONE_SIZE.width, PHONE_SIZE.height, PHONE_SIZE.depth),
    new MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.35, metalness: 0.4 }),
  );
  const canvas = new OffscreenCanvas(SCREEN_W, SCREEN_H);
  const g = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  // Above 1: the bloom catches it like the room's other screens.
  const screenMaterial = new MeshBasicMaterial({ map: texture, color: new Color(1.6, 1.6, 1.6), toneMapped: false });
  const screen = new Mesh(new PlaneGeometry(PHONE_SIZE.width * 0.9, PHONE_SIZE.height * 0.93), screenMaterial);
  screen.position.z = PHONE_SIZE.depth / 2 + 0.0004;
  phone.add(body, screen);
  root.add(phone);

  const budMaterial = new MeshStandardMaterial({ color: 0xe9edf6, roughness: 0.4 });
  const buds = ([-1, 1] as const).map(() => {
    const bud = new Group();
    const pod = new Mesh(new SphereGeometry(0.0062, 12, 8), budMaterial);
    const stem = new Mesh(new CylinderGeometry(0.0022, 0.0018, 0.013, 8), budMaterial);
    stem.position.y = -0.008;
    bud.add(pod, stem);
    root.add(bud);
    return bud;
  });

  // The cord: three strands (main, left, right), a ring of four points at each cord point.
  const RING = 4,
    RADIUS = 0.0012;
  const strands = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [8, 9, 10, 11, 12, 13],
    [8, 14, 15, 16, 17, 18],
  ];
  const points = strands.reduce((n, s) => n + s.length, 0);
  const cordPositions = new Float32Array(points * RING * 3);
  const index: number[] = [];
  let base = 0;
  for (const strand of strands) {
    for (let i = 0; i < strand.length - 1; i++)
      for (let r = 0; r < RING; r++) {
        const a = base + i * RING + r,
          b = base + i * RING + ((r + 1) % RING),
          c = a + RING,
          d = b + RING;
        index.push(a, c, b, b, c, d);
      }
    base += strand.length * RING;
  }
  const cordGeometry = new BufferGeometry();
  cordGeometry.setAttribute('position', new BufferAttribute(cordPositions, 3));
  cordGeometry.setIndex(index);
  const cordMesh = new Mesh(cordGeometry, new MeshStandardMaterial({ color: 0xdfe3ee, roughness: 0.6 }));
  // Its points move every frame, anywhere in the room: never culled by a stale box.
  cordMesh.frustumCulled = false;
  root.add(cordMesh);

  const frame = {
    at: new Vector3(),
    up: new Vector3(0, 1, 0),
    facing: new Vector3(0, 0, 1),
    side: new Vector3(1, 0, 0),
  };
  const m = new Matrix4();
  const a = new Vector3(),
    b = new Vector3(),
    t = new Vector3(),
    n1 = new Vector3(),
    n2 = new Vector3();

  // The feed: cards of colour, scrolled. Each card's colour comes from a fixed sequence.
  let scroll = 0,
    speed = 22,
    drawn = 0,
    redrawIn = 0,
    lastLevel = -1;
  const cards: { hue: number; light: number; tall: number }[] = [];
  const cardAt = (i: number) => {
    while (cards.length <= i) {
      const k = cards.length;
      cards.push({
        hue: draw(seed, k * 3) * 360,
        light: 45 + draw(seed, k * 3 + 1) * 25,
        tall: 60 + draw(seed, k * 3 + 2) * 70,
      });
    }
    return cards[i]!;
  };
  const light = { color: new Color(0.6, 0.65, 0.8), power: 0 };
  // The page's colours, linear (as Color holds them): the paper, the text lines, the app bar.
  const PAPER = vec(new Color('#f2f3f8')),
    LINE = vec(new Color('#c9cede')),
    BAR = vec(new Color('#20263a'));
  const sum = new Vector3(),
    swatch = new Vector3(),
    cardTone = new Vector3(),
    cardColor = new Color();
  const repaint = () => {
    g.fillStyle = '#f2f3f8';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // The light's colour is the screen's average, summed from what is drawn (by area) as it is
    // drawn: reading the pixels back would stall the page on the GPU (a CPU profile found a
    // quarter of the frame time in it).
    const pageArea = SCREEN_W * SCREEN_H;
    sum.copy(PAPER).multiplyScalar(pageArea);
    const fill = (style: string, color: Vector3, x: number, top: number, w: number, h: number) => {
      const y0 = Math.max(14, top),
        y1 = Math.min(SCREEN_H, top + h);
      if (y1 <= y0) return;
      g.fillStyle = style;
      g.fillRect(x, top, w, h);
      sum.addScaledVector(swatch.copy(color).sub(PAPER), w * (y1 - y0));
    };
    // Cards down the screen from the scroll position.
    let y = -(scroll % 1e9),
      i = 0;
    while (y < SCREEN_H) {
      const card = cardAt(i++);
      if (y + card.tall > 0) {
        cardColor.setHSL(card.hue / 360, 0.62, card.light / 100, SRGBColorSpace);
        fill(
          `hsl(${card.hue},62%,${card.light}%)`,
          cardTone.set(cardColor.r, cardColor.g, cardColor.b),
          6,
          y + 4,
          SCREEN_W - 12,
          card.tall - 26,
        );
        fill('#c9cede', LINE, 6, y + card.tall - 18, SCREEN_W * 0.6, 4);
        fill('#c9cede', LINE, 6, y + card.tall - 11, SCREEN_W * 0.35, 4);
      }
      y += card.tall;
    }
    // A bar at the top (the app).
    g.fillStyle = '#20263a';
    g.fillRect(0, 0, SCREEN_W, 14);
    sum.addScaledVector(swatch.copy(BAR).sub(PAPER), SCREEN_W * 14);
    texture.needsUpdate = true;
    sum.multiplyScalar(1 / pageArea);
    light.color.setRGB(sum.x, sum.y, sum.z);
  };
  repaint();

  return {
    root,
    frame,
    place(at, up, facing) {
      frame.at.copy(at);
      frame.facing.copy(facing).normalize();
      frame.up.copy(up).addScaledVector(frame.facing, -frame.up.dot(frame.facing)).normalize();
      frame.side.crossVectors(frame.up, frame.facing);
      m.makeBasis(frame.side, frame.up, frame.facing).setPosition(at);
      phone.matrix.copy(m);
      phone.matrixAutoUpdate = false;
      phone.matrixWorldNeedsUpdate = true;
    },
    jack(out) {
      return out.copy(frame.at).addScaledVector(frame.up, -PHONE_SIZE.height / 2);
    },
    budHome(side, out) {
      return out
        .copy(frame.at)
        .addScaledVector(frame.up, -PHONE_SIZE.height / 2 - 0.006)
        .addScaledVector(frame.side, side * 0.012)
        .addScaledVector(frame.facing, -PHONE_SIZE.depth);
    },
    placeBud(side, at, out) {
      const bud = buds[side < 0 ? 0 : 1]!;
      bud.position.copy(at);
      // The pod's stem (−Y) points down along the cord; the pod faces `out`.
      b.copy(out).normalize();
      a.set(0, 1, 0).addScaledVector(b, -b.y);
      if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
      a.normalize();
      t.crossVectors(a, b);
      bud.quaternion.setFromRotationMatrix(m.makeBasis(t, a, b));
    },
    drawCord(cord) {
      let o = 0;
      for (const strand of strands)
        for (let i = 0; i < strand.length; i++) {
          const p = strand[i]!;
          const q = strand[Math.min(strand.length - 1, i + 1)]!,
            r = strand[Math.max(0, i - 1)]!;
          a.set(...cord.node(p));
          t.set(...cord.node(q)).sub(n1.set(...cord.node(r)));
          if (t.lengthSq() < 1e-10) t.set(0, 1, 0);
          t.normalize();
          // Two directions across the cord at this point.
          n1.set(0, 1, 0).cross(t);
          if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0).cross(t);
          n1.normalize();
          n2.crossVectors(t, n1);
          for (let k = 0; k < RING; k++) {
            const ang = (k / RING) * Math.PI * 2;
            b.copy(a)
              .addScaledVector(n1, Math.cos(ang) * RADIUS)
              .addScaledVector(n2, Math.sin(ang) * RADIUS);
            cordPositions[o++] = b.x;
            cordPositions[o++] = b.y;
            cordPositions[o++] = b.z;
          }
        }
      (cordGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      cordGeometry.computeVertexNormals();
    },
    screen(level, tap, dt) {
      const on = Math.min(1, Math.max(0, level));
      screen.visible = on > 0.01;
      screenMaterial.color.setScalar(1.6 * on);
      if (on > 0.01) {
        // A tap flicks the feed on (fast, slowing down); otherwise it drifts.
        if (tap) speed = 260 + draw(seed, 9000 + drawn) * 200;
        speed += (18 - speed) * (1 - Math.exp(-3 * dt));
        scroll += speed * dt;
        // Redrawn about ten times a second (and when it comes on): enough for a small feed.
        redrawIn -= dt;
        if (redrawIn <= 0 || lastLevel <= 0.01) {
          repaint();
          drawn++;
          redrawIn = 0.1;
        }
      }
      lastLevel = on;
      light.power = on;
      return light;
    },
  };
}
