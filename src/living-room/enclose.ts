/**
 * The room closed in for the view from inside (docs/living-shell.md). The room file is a cutaway
 * made to be looked down on: its right wall stops at the waist and it has no ceiling, which from
 * eye height at the open front reads as the room ending in nothing. A plain wall and a ceiling
 * are put where the cutaway left them out: unlit, in the dark of the room's own far corners,
 * shaded a little from the lit end to the dark one. They take no light and cast none; they are
 * there so the eye finds corners where it expects them.
 */
import { Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import type { Object3D } from 'three';

type Corner = readonly [x: number, y: number, z: number, shade: number];

function panel(corners: readonly [Corner, Corner, Corner, Corner], lit: Color, dark: Color) {
  const geometry = new BufferGeometry();
  const tint = new Color();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      corners.flatMap(([x, y, z]) => [x, y, z]),
      3,
    ),
  );
  geometry.setAttribute(
    'color',
    new Float32BufferAttribute(
      corners.flatMap(([, , , shade]) => tint.copy(dark).lerp(lit, shade).toArray()),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
}

/** The wall on the right and the ceiling, to add to the scene. `shell` is the room's walls and floor. */
export function enclose(shell: Box3, floorY: number): Object3D[] {
  const { min, max } = shell;
  const top = max.y;
  // (A hair outside the low wall that is there, so the two never fight for the same pixels.)
  const right = max.x + 0.01;
  const wall = panel(
    [
      [right, floorY, min.z, 0.55],
      [right, floorY, max.z + 2, 0],
      [right, top, max.z + 2, 0],
      [right, top, min.z, 1],
    ],
    new Color(0x121938),
    new Color(0x060a1c),
  );
  const ceiling = panel(
    [
      [min.x, top, min.z, 1],
      [right, top, min.z, 0.8],
      [right, top, max.z + 2, 0],
      [min.x, top, max.z + 2, 0],
    ],
    new Color(0x101a40),
    new Color(0x050818),
  );
  return [wall, ceiling];
}
