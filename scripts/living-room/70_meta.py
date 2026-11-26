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
marker('marker_sit_bed', (B.location.x - BW / 2 + .2, B.location.y - .4, .56), (-1, -.15))
marker('marker_sit_beanbag', (-1.42, -1.12, 0.3), (0.8, 0.55))               # sunk into the beanbag, facing the desk
marker('marker_sit_cushion', (0.75, -0.95, 0.14), (-0.4, 1))                 # on the floor cushion
# hiding places: the far side of something, seen from the camera
marker('marker_hide_beanbag', (-1.75, -0.55, 0), (1, -0.6))
marker('marker_hide_chair', (DX + 0.5, DY - 0.55, 0), (0.3, -1))
marker('marker_hide_dresser', (HALF - 0.75, -2.15, 0), (-1, 0.2))
# standing places
marker('marker_stand_window', (-.02, 1.9, 0), (-.3, 1))
marker('marker_stand_shelf', (-2.3, .3, 0), (-1, 0))
marker('marker_stand_center', (0.1, -0.4, 0), (0, -1))
marker('marker_stand_front', (0.9, -1.9, 0), (0, -1))
marker('marker_stand_guitar', (HALF - 0.85, -0.45, 0), (1, 0.1))

# walkable floor: the room minus the furniture's footprints, merged into rectangles
OBST = [  # x0, y0, x1, y1
    (DX-.95, DY-.42, DX+.98, DY+.42),  # desk
    (DX+.91, DY-.2, DX+1.25, DY+.36),  # PC
    (DX-.35, DY-1.15, DX+.45, DY-.4),  # chair
    (N.location.x-.24, N.location.y-.21, N.location.x+.24, N.location.y+.21),
    (B.location.x-BW/2-.08, B.location.y-BL/2-.08, 3, BACK),
    (-3, -.28, -2.6, .98),        # bookshelf
    (-2.85, -.7, -2.5, -.28),     # snake plant
    (.14, 2.02, .76, 2.68),       # monstera
    (-2.05, -1.75, -0.98, -0.72),  # beanbag
    (-1.2, -2.0, -0.64, -1.44),   # side table
    (-2.4, -2.2, -1.86, -1.7),    # floor lamp base
    (HALF - .5, -2.05, 3, -.85),  # dresser
    (HALF - .62, -.72, 3, -.12),   # guitar and basket
    (0.48, -1.22, 1.02, -0.68),   # floor cushion
    (1.80, -.04, 2.10, .49),      # slippers
    (1.17, -.10, 1.73, .46),      # sweater on the floor
    (-2.87, .77, -2.37, 1.12),    # carton
]
CELL = 0.1
n = int(round(HALF * 2 / CELL))
ny = int(round((3.5 - FRONT) / CELL))
free = [[True] * n for _ in range(ny)]
for j in range(ny):
    for i in range(n):
        x0, y0 = -HALF + i * CELL, FRONT + j * CELL
        xmin, xmax = floor_limits(y0 + CELL)
        if x0 < xmin - 1e-6 or x0 + CELL > xmax + 1e-6:
            free[j][i] = False
            continue
        for ox0, oy0, ox1, oy1 in OBST:
            if x0 + CELL > ox0 + 1e-6 and x0 < ox1 - 1e-6 and y0 + CELL > oy0 + 1e-6 and y0 < oy1 - 1e-6:
                free[j][i] = False
                break
# runs per row, then merge equal runs of neighbouring rows
rects, open_runs = [], {}
for j in range(ny + 1):
    runs = set()
    if j < ny:
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
    xa, xb, ya, yb = -HALF + i0 * CELL, -HALF + i1 * CELL, FRONT + j0 * CELL, FRONT + j1 * CELL
    bm.faces.new([bm.verts.new(p) for p in ((xa, ya, 0), (xb, ya, 0), (xb, yb, 0), (xa, yb, 0))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
o = bm_object('navmesh_floor', bm, mat('navmesh', '#33ff88', 1.0, alpha=0.3), C, smooth=False)
o.hide_render = True
o.display_type = 'WIRE'
print('meta done: rects', len(rects), 'markers', len([x for x in C.objects if x.type == 'EMPTY']))
