import { Vector3, type Mesh, type Object3D } from 'three';
import type { RoomLayout, RoomSpot } from '../../world/room-life';

/**
 * The room's layout from the asset contract (部屋の素材の約束): marker_sit_/marker_hide_/
 * marker_stand_ empties (position; the arrow, the empty's +Z, gives the way the character faces)
 * and the navmesh_floor mesh (its triangles, flattened onto the floor). Numbers only leave here.
 */
export function readLayout(root: Object3D): RoomLayout {
  root.updateWorldMatrix(true, true);
  const spots: RoomSpot[] = [];
  const floor: number[][] = [];
  let floorY = 0,
    heights = 0;
  const p = new Vector3(),
    forward = new Vector3();
  root.traverse((o) => {
    const marker = /^marker_(sit|hide|stand)_([a-z0-9_]{1,32})$/.exec(o.name);
    if (marker && spots.length < 32) {
      o.getWorldPosition(p);
      forward.set(0, 0, 1).transformDirection(o.matrixWorld);
      const heading = Math.hypot(forward.x, forward.z) > 0.2 ? Math.atan2(forward.x, forward.z) : 0;
      if ([p.x, p.y, p.z, heading].every(Number.isFinite))
        spots.push({
          id: `${marker[1]}_${marker[2]}`,
          kind: marker[1] as RoomSpot['kind'],
          x: p.x,
          y: p.y,
          z: p.z,
          heading,
        });
      return;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.name !== 'navmesh_floor') return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count && floor.length < 4096; i += 3) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
        tri.push(p.x, p.z);
        floorY += p.y;
        heights++;
      }
      if (tri.every(Number.isFinite)) floor.push(tri);
    }
  });
  return { floorY: heights ? floorY / heights : 0, floor, spots };
}
