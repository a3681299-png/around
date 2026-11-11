// Soft furniture that gives under a body: the bed's duvet and sheet (and the beanbag, the floor
// cushion) sink where the character sits, bounce a little when it drops onto them, and come back
// slowly when it gets up. No cloth simulation: the vertices near the seat are pushed down by a
// smooth bump whose depth is one spring, and darkened a little (the room's light is baked into
// vertex colours, so a dent would otherwise not read). The baked room file is not changed.
import { Vector3, type BufferAttribute, type Mesh } from 'three';

export interface SoftSurface {
  /**
   * One frame. `at` is where the weight rests (the room's metres; undefined: nothing rests),
   * `weight` 0–1 how much of it. Returns how far the surface is down there now, in metres (the
   * body rides it).
   */
  press(at: readonly [number, number, number] | undefined, weight: number, dt: number): number;
  /** A drop onto the surface: a push down that the spring then throws back. */
  kick(strength: number): void;
}

const RADIUS = 0.42;
const DEPTH = 0.075;
/** Down goes quickly and overshoots (a plop); up comes back slowly and does not (a duvet). */
const SINK = { stiff: 11, damp: 0.32 };
const RISE = { stiff: 3.6, damp: 0.95 };

interface Patch {
  position: BufferAttribute;
  color: BufferAttribute | undefined;
  /** Per vertex: its index, its place and colour as baked, and how much of the bump it gets. */
  index: number[];
  rest: number[];
  tint: number[];
  share: number[];
}

export function softSurface(meshes: readonly Mesh[]): SoftSurface {
  let patches: Patch[] = [];
  let centre: Vector3 | undefined;
  let sink = 0,
    speed = 0,
    drawn = 0;
  const local = new Vector3(),
    world = new Vector3();

  const restore = () => {
    for (const patch of patches) write(patch, 0);
    patches = [];
  };
  const write = (patch: Patch, amount: number) => {
    const { position, color } = patch;
    for (let k = 0; k < patch.index.length; k++) {
      const i = patch.index[k]!,
        share = patch.share[k]!;
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
  const gather = (at: Vector3) => {
    restore();
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position') as BufferAttribute;
      const color = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
      const patch: Patch = { position, color, index: [], rest: [], tint: [], share: [] };
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const flat = Math.hypot(world.x - at.x, world.z - at.z);
        // Only the surface around the seat: not the bed's frame under it, not what hangs to the floor.
        if (flat >= RADIUS || Math.abs(world.y - at.y) > 0.22) continue;
        const k = 1 - (flat / RADIUS) ** 2;
        patch.index.push(i);
        patch.rest.push(position.getY(i));
        patch.share.push(k * k);
        if (color) patch.tint.push(color.getX(i), color.getY(i), color.getZ(i));
      }
      if (patch.index.length) patches.push(patch);
    }
  };

  return {
    press(at, weight, dt) {
      if (at && (!centre || centre.distanceTo(local.set(at[0], at[1], at[2])) > 0.05)) {
        centre = new Vector3(at[0], at[1], at[2]);
        gather(centre);
      }
      const goal = at ? Math.min(1, Math.max(0, weight)) : 0;
      const { stiff, damp } = goal > sink ? SINK : RISE;
      for (let left = Math.min(0.1, Math.max(0, dt)); left > 1e-6; left -= 1 / 240) {
        const h = Math.min(1 / 240, left);
        speed += (-stiff * stiff * (sink - goal) - 2 * damp * stiff * speed) * h;
        sink += speed * h;
      }
      sink = Math.min(1.5, Math.max(-0.25, sink));
      if (Math.abs(sink) < 1e-4 && Math.abs(speed) < 1e-3 && goal === 0) sink = speed = 0;
      // Vertices are written only while the surface moves.
      if (Math.abs(sink - drawn) > 1e-4) {
        drawn = sink;
        for (const patch of patches) write(patch, sink);
      }
      return sink * DEPTH;
    },
    kick(strength) {
      speed += strength;
    },
  };
}
