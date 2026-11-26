// The desk chair of the room file (`tex_chair`, with its two shape keys) made to move: its seat
// sinks and its back gives by the shape keys, and the whole chair rocks on its base. The springs
// are chair-give.ts; this only plays them on the mesh (docs/living-life.md).
import { Group, Vector3, type Mesh } from 'three';
import type { ChairState } from './chair-give';

export interface ChairRig {
  /** Plays the chair's state; a point on the seat (the room's metres) as the rocking carries it. */
  update(state: ChairState): void;
  /** Where a point that sits on the chair is now (the rock carries it). */
  carry(point: readonly [number, number, number]): [number, number, number];
}

export function chairRig(mesh: Mesh): ChairRig {
  // The baked room keeps every vertex in room coordinates: rock about the base's middle.
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  mesh.updateWorldMatrix(true, false);
  const pivot = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).applyMatrix4(
    mesh.matrixWorld,
  );
  const holder = new Group();
  holder.name = 'chair_rock';
  mesh.parent!.add(holder);
  holder.position.copy(pivot);
  holder.attach(mesh);
  // The chair now moves: it may lean out of its rest box.
  mesh.frustumCulled = false;
  const dictionary = mesh.morphTargetDictionary ?? {};
  const sink = dictionary['seat_sink'],
    back = dictionary['back_recline'];
  const p = new Vector3();
  let shown = '';
  return {
    update(state) {
      const key = `${state.sink.toFixed(4)} ${state.recline.toFixed(4)} ${state.rock.toFixed(5)}`;
      if (key === shown) return;
      shown = key;
      if (mesh.morphTargetInfluences) {
        if (sink !== undefined) mesh.morphTargetInfluences[sink] = Math.max(0, state.sink);
        if (back !== undefined) mesh.morphTargetInfluences[back] = Math.max(0, state.recline);
      }
      // Back and forth on its base (its back is toward +Z), a little twist with it.
      holder.rotation.set(state.rock, state.rock * 0.35, 0);
    },
    carry(point) {
      holder.updateWorldMatrix(true, false);
      p.set(point[0] - pivot.x, point[1] - pivot.y, point[2] - pivot.z)
        .applyEuler(holder.rotation)
        .add(pivot);
      return [p.x, p.y, p.z];
    },
  };
}
