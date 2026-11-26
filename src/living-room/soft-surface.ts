// Soft furniture that gives under a body: the bed's duvet, sheet and pillows (and the beanbag,
// the floor cushion) sink where the character sits or lies, bounce when it drops onto them, and
// come back slowly when it gets up. No cloth simulation: the vertices near each point the body
// rests on are pushed down by a smooth bump whose depth is one spring, and darkened a little (the
// room's light is baked into vertex colours, so a dent would otherwise not read). The baked room
// file is not changed.
//
// A seated body rests on one point (its hips). A lying one on several (chest, belly, hips,
// thighs, knees, forearms; docs/living-life.md), each with its own share of the weight: the
// bump under each is the share of the one depth, so the dents move together, and a share that
// changes (a knee lifting as the leg swings) lifts that dent alone.
import { Vector3, type BufferAttribute, type Mesh } from 'three';

export type Contact = readonly [number, number, number];
/** A point the body rests on, and how much of its weight is there (0–1, 1 by default). */
export interface Press {
  at: Contact;
  share?: number;
}

export interface SoftSurface {
  /**
   * One frame. `at` is where the weight rests (the room's metres; undefined: nothing rests), or
   * several points (lying); `weight` 0–1 how much of the body is on it. Returns how far the
   * surface is down at the first point now, in metres (the body rides it).
   */
  press(at: Contact | readonly Press[] | undefined, weight: number, dt: number): number;
  /** A drop onto the surface: a push down that the spring then throws back. */
  kick(strength: number): void;
}

const RADIUS = 0.42;
/** Lying, the weight is spread: smaller dents under each point. */
const SPREAD_RADIUS = 0.26;
const DEPTH = 0.075;
/** Down goes quickly and overshoots (a plop); up comes back slowly and does not (a duvet). */
const SINK = { stiff: 11, damp: 0.32 };
const RISE = { stiff: 3.6, damp: 0.95 };

interface Patch {
  position: BufferAttribute;
  color: BufferAttribute | undefined;
  /** Per vertex: its index, its place and colour as baked, and how much of each point's bump it
   * gets (one number a point). */
  index: number[];
  rest: number[];
  tint: number[];
  share: number[];
}

export function softSurface(meshes: readonly Mesh[]): SoftSurface {
  let patches: Patch[] = [];
  let centres: Vector3[] = [];
  let sink = 0,
    speed = 0,
    drawn = 0,
    drawnShares = '';
  let shares: number[] = [];
  const world = new Vector3();

  const restore = () => {
    for (const patch of patches) write(patch, 0, []);
    patches = [];
  };
  const write = (patch: Patch, amount: number, weights: readonly number[]) => {
    const { position, color } = patch;
    const n = Math.max(1, centres.length);
    for (let k = 0; k < patch.index.length; k++) {
      const i = patch.index[k]!;
      // The deepest of the bumps over this vertex (where dents meet, they do not add up).
      let share = 0;
      for (let c = 0; c < n; c++) share = Math.max(share, patch.share[k * n + c]! * (weights[c] ?? 1));
      // Down in the middle, and a slight swell around it (the filling goes somewhere).
      const swell = 4 * share * (1 - share);
      position.setY(i, patch.rest[k]! - amount * DEPTH * (share - 0.18 * swell));
      if (color) {
        const shade = 1 - 0.32 * Math.max(0, amount) * share;
        color.setXYZ(i, patch.tint[k * 3]! * shade, patch.tint[k * 3 + 1]! * shade, patch.tint[k * 3 + 2]! * shade);
      }
    }
    position.needsUpdate = true;
    if (color) color.needsUpdate = true;
  };
  const gather = (at: readonly Vector3[], radius: number) => {
    restore();
    centres = at.map((p) => p.clone());
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position') as BufferAttribute;
      const color = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
      const patch: Patch = { position, color, index: [], rest: [], tint: [], share: [] };
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const near = at.map((c) => {
          const flat = Math.hypot(world.x - c.x, world.z - c.z);
          // Only the surface round the point: not the bed's frame under it, not what hangs down.
          if (flat >= radius || Math.abs(world.y - c.y) > 0.22) return 0;
          const k = 1 - (flat / radius) ** 2;
          return k * k;
        });
        if (!near.some((k) => k > 0)) continue;
        patch.index.push(i);
        patch.rest.push(position.getY(i));
        patch.share.push(...near);
        if (color) patch.tint.push(color.getX(i), color.getY(i), color.getZ(i));
      }
      if (patch.index.length) patches.push(patch);
    }
  };

  return {
    press(at, weight, dt) {
      const points: readonly Press[] | undefined =
        at === undefined ? undefined : isContact(at) ? [{ at }] : (at as readonly Press[]);
      if (points?.length) {
        const moved =
          points.length !== centres.length ||
          points.some((p, i) => centres[i]!.distanceTo(world.set(p.at[0], p.at[1], p.at[2])) > 0.05);
        if (moved)
          gather(
            points.map((p) => new Vector3(p.at[0], p.at[1], p.at[2])),
            points.length > 1 ? SPREAD_RADIUS : RADIUS,
          );
        shares = points.map((p) => Math.min(1, Math.max(0, p.share ?? 1)));
      }
      const goal = points?.length ? Math.min(1, Math.max(0, weight)) : 0;
      const { stiff, damp } = goal > sink ? SINK : RISE;
      for (let left = Math.min(0.1, Math.max(0, dt)); left > 1e-6; left -= 1 / 240) {
        const h = Math.min(1 / 240, left);
        speed += (-stiff * stiff * (sink - goal) - 2 * damp * stiff * speed) * h;
        sink += speed * h;
      }
      sink = Math.min(1.5, Math.max(-0.25, sink));
      if (Math.abs(sink) < 1e-4 && Math.abs(speed) < 1e-3 && goal === 0) sink = speed = 0;
      // Vertices are written only while the surface or the shares move.
      const key = shares.map((s) => s.toFixed(3)).join();
      if (Math.abs(sink - drawn) > 1e-4 || key !== drawnShares) {
        drawn = sink;
        drawnShares = key;
        for (const patch of patches) write(patch, sink, shares);
      }
      return sink * DEPTH * (shares[0] ?? 1);
    },
    kick(strength) {
      speed += strength;
    },
  };
}

const isContact = (at: Contact | readonly Press[]): at is Contact => typeof at[0] === 'number';
