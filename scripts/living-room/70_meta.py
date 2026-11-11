# What the engine reads (部屋の素材の約束, src/renderers/three/room.ts readLayout): the walkable
# floor `navmesh_floor` and the places `marker_sit_*`, `marker_hide_*`, `marker_stand_*`.
# A marker's facing is its glTF +Z, which is Blender's local -Y.
C = wipe('meta_marks')


def marker(name, loc, face):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = 'ARROWS'
    o.empty_display_size = 0.2
    o.location = loc
    o.rotation_euler = (0, 0, math.atan2(face[0], -face[1]))
    C.objects.link(o)
    return o


# seats: the marker is where the hips go
marker('marker_sit_chair', (DX + 0.045, DY - 0.76, 0.56), (-0.2, 1))        # at the desk, back to the viewer
marker('marker_sit_bed', (HALF - 1.12 - 0.03 + 0.2, 0.75, 0.56), (-1, -0.15))  # on the bed's edge, facing the room
marker('marker_sit_beanbag', (-1.42, -1.12, 0.3), (0.8, 0.55))               # sunk into the beanbag, facing the desk
marker('marker_sit_cushion', (0.75, -0.95, 0.14), (-0.4, 1))                 # on the floor cushion
# hiding places: the far side of something, seen from the camera
marker('marker_hide_beanbag', (-1.75, -0.55, 0), (1, -0.6))
marker('marker_hide_chair', (DX + 0.5, DY - 0.55, 0), (0.3, -1))
marker('marker_hide_dresser', (HALF - 0.75, -2.15, 0), (-1, 0.2))
# standing places
marker('marker_stand_window', (0.85, 1.55, 0), (0.25, 1))
marker('marker_stand_shelf', (-1.75, 0.4, 0), (-1, 0))
marker('marker_stand_center', (0.1, -0.4, 0), (0, -1))
marker('marker_stand_front', (0.9, -1.9, 0), (0, -1))
marker('marker_stand_guitar', (HALF - 0.85, -0.45, 0), (1, 0.1))

# walkable floor: the room minus the furniture's footprints, merged into rectangles
OBST = [  # x0, y0, x1, y1
    (-2.4, 1.52, 0.72, 2.4),      # desk, PC, the big plant
    (-1.5, 0.82, -0.7, 1.52),     # chair
    (0.7, 1.9, 1.3, 2.4),         # nightstand
    (HALF - 1.12 - 0.08, 0.2, 2.4, 2.4),  # bed
    (-2.4, -0.28, -2.02, 0.98),   # bookshelf
    (-2.4, -0.7, -1.95, -0.28),   # snake plant
    (-2.05, -1.75, -0.98, -0.72),  # beanbag
    (-1.2, -2.0, -0.64, -1.44),   # side table
    (-2.4, -2.2, -1.86, -1.7),    # floor lamp base
    (HALF - 0.5, -2.05, 2.4, -0.85),  # dresser
    (HALF - 0.62, -0.72, 2.4, -0.12),  # guitar
    (0.48, -1.22, 1.02, -0.68),   # floor cushion
    (0.92, 0.28, 1.2, 0.64),      # slippers
    (-2.3, 1.05, -1.95, 1.45),    # backpack
]
CELL = 0.1
n = int(round(HALF * 2 / CELL))
free = [[True] * n for _ in range(n)]
for j in range(n):
    for i in range(n):
        x0, y0 = -HALF + i * CELL, -HALF + j * CELL
        for ox0, oy0, ox1, oy1 in OBST:
            if x0 + CELL > ox0 + 1e-6 and x0 < ox1 - 1e-6 and y0 + CELL > oy0 + 1e-6 and y0 < oy1 - 1e-6:
                free[j][i] = False
                break
# runs per row, then merge equal runs of neighbouring rows
rects, open_runs = [], {}
for j in range(n + 1):
    runs = set()
    if j < n:
        i = 0
        while i < n:
            if free[j][i]:
                k = i
                while k < n and free[j][k]:
                    k += 1
                runs.add((i, k))
                i = k
            else:
                i += 1
    for run in list(open_runs):
        if run not in runs:
            rects.append((run[0], open_runs.pop(run), run[1], j))
    for run in runs:
        open_runs.setdefault(run, j)
bm = bmesh.new()
for i0, j0, i1, j1 in rects:
    xa, xb, ya, yb = -HALF + i0 * CELL, -HALF + i1 * CELL, -HALF + j0 * CELL, -HALF + j1 * CELL
    bm.faces.new([bm.verts.new(p) for p in ((xa, ya, 0), (xb, ya, 0), (xb, yb, 0), (xa, yb, 0))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
o = bm_object('navmesh_floor', bm, mat('navmesh', '#33ff88', 1.0, alpha=0.3), C, smooth=False)
o.hide_render = True
o.display_type = 'WIRE'
print('meta done: rects', len(rects), 'markers', len([x for x in C.objects if x.type == 'EMPTY']))
